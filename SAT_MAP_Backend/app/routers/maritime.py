"""
LTmap maritime router.

The full AIS snapshot is streamed over a viewport-filtered WebSocket. Focused
vessel tracking and MMSI filter streaming use separate WebSocket endpoints.
"""

import asyncio
import math
import time
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..services import ais_stream, ais_db

logger = logging.getLogger("ltmap.maritime")

router = APIRouter(prefix="/api/maritime", tags=["maritime"])


# In-memory photo URL cache to make ship detail queries instant (<1ms)
_photo_cache: dict[int, dict[str, str | None]] = {}


async def _resolve_vessel_photo(mmsi: int) -> dict[str, str | None]:
    """Fetch vessel photo asynchronously without blocking the event loop or queueing other requests."""
    if mmsi in _photo_cache:
        return _photo_cache[mmsi]

    def _fetch_sync():
        try:
            import urllib.request, re
            vf_url = f"https://www.vesselfinder.com/vessels/details/{mmsi}"
            vf_req = urllib.request.Request(
                vf_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            )
            with urllib.request.urlopen(vf_req, timeout=1.8) as vf_res:
                html = vf_res.read().decode("utf-8", errors="ignore")
                match = re.search(r'src="(https://static\.vesselfinder\.net/ship-photo/[^"]+)"', html)
                if match:
                    return {
                        "photoUrl": match.group(1),
                        "photoAuthor": "VesselFinder contributor",
                    }
        except Exception as e:
            logger.debug("VesselFinder photo lookup failed for %s: %s", mmsi, e)
        return {"photoUrl": None, "photoAuthor": None}

    try:
        # Run in worker thread with timeout so the main FastAPI async loop never blocks
        result = await asyncio.wait_for(asyncio.to_thread(_fetch_sync), timeout=1.9)
    except Exception:
        result = {"photoUrl": None, "photoAuthor": None}

    _photo_cache[mmsi] = result
    return result


@router.get("/ships/{mmsi}")
async def vessel_details(mmsi: int):
    """Return complete current AIS metadata and recent stored route fixes for one vessel."""
    ship = await ais_stream.get_ship(mmsi)
    stored = await ais_db.get_ship_from_db(mmsi)
    if not ship and not stored:
        raise HTTPException(status_code=404, detail="Vessel not found")
    # Prefer fresh AIS fields while taking the durable route history from the DB.
    details = {**(stored or {}), **(ship or {})}
    if stored and len(stored.get("track", [])) > len(details.get("track", [])):
        details["track"] = stored["track"]
    details["trackPointCount"] = max(
        int(details.get("trackPointCount") or 0), len(details.get("track", []))
    )
    details["dataSource"] = "AIS live cache + stored AIS history" if ship and stored else "AIS live cache" if ship else "AIS database"
    details["shipId"] = details.get("id") or mmsi
    details["aisName"] = details.get("name") or f"VESSEL-{mmsi}"
    details["subtype"] = details.get("subtype") or (
        "Chemical Tanker" if str(details.get("type", "")).lower() == "tanker"
        else "Container Ship" if str(details.get("type", "")).lower() == "cargo"
        else f"{str(details.get('type', 'Vessel')).title()}"
    )
    dest = details.get("destination")
    origin = details.get("origin")
    details["departurePort"] = str(origin).strip() if origin and str(origin).strip() and str(origin).strip().upper() != "PORT OF DEPARTURE" else None
    details["destinationPort"] = str(dest).strip() if dest and str(dest).strip() else None
    first_seen = details.get("firstSeenAt") or details.get("trackStartAt")
    last_seen = details.get("lastSeenAt") or details.get("timestamp") or time.time()
    details["atd"] = first_seen
    details["eta"] = details.get("eta") or (float(last_seen) + 3600 * 6)

    # Fetch vessel photo non-blocking with memory cache
    if not details.get("photoUrl") and mmsi:
        photo_info = await _resolve_vessel_photo(int(mmsi))
        if photo_info.get("photoUrl"):
            details["photoUrl"] = photo_info["photoUrl"]
            details["photoAuthor"] = photo_info["photoAuthor"]

    return details


@router.get("/ships/{mmsi}/general")
async def vessel_general(mmsi: int):
    """Return MarineTraffic-style general vessel metadata for the selected ship card."""
    return await vessel_details(mmsi)


@router.get("/ships/{mmsi}/track")
async def vessel_track_history(
    mmsi: int,
    start_time: float | None = None,
    end_time: float | None = None,
    limit: int = 2000,
    format: str | None = None,
):
    """Return historical breadcrumb trail (date/time, lat, lng, speed, heading) for a vessel."""
    # 1. First attempt to fetch persisted historical points from database
    track = await ais_db.get_track_history_from_db(
        mmsi, start_time=start_time, end_time=end_time, limit=limit
    )

    # 2. If DB has no track points (or DB not connected), fall back to in-memory live track
    if not track:
        ship = await ais_stream.get_ship(mmsi)
        if not ship:
            for s in await ais_stream.get_ships():
                if s.get("mmsi") == mmsi or s.get("id") == mmsi:
                    ship = s
                    break
        if ship and isinstance(ship.get("track"), list):
            live_track = ship["track"]
            if start_time is not None or end_time is not None:
                filtered = []
                for pt in live_track:
                    ts = pt.get("timestamp")
                    if ts is None:
                        continue
                    ts_val = float(ts)
                    if start_time is not None and ts_val < start_time:
                        continue
                    if end_time is not None and ts_val > end_time:
                        continue
                    filtered.append(pt)
                track = filtered
            else:
                track = live_track

    # Always ensure chronological order
    track = sorted(track, key=lambda pt: float(pt.get("timestamp") or 0))

    # If caller requested raw array tuples (MarineTraffic format: [lng, lat, speed*10, course, heading, timeStr, ts, source, ...])
    if format == "marinetraffic" or format == "array":
        raw_tuples = []
        for pt in track:
            ts = float(pt.get("timestamp") or time.time())
            dt_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            spd = float(pt.get("speed") or 0.0)
            hdg = int(float(pt.get("heading") or 0.0))
            raw_tuples.append([
                str(pt.get("lng") or 0.0),
                str(pt.get("lat") or 0.0),
                str(int(spd * 10)),
                str(hdg),
                str(hdg),
                dt_str,
                int(ts),
                "Roaming",
                "-1",
                "", "", "", "", "", "", "", "", "", "", "", "",
                "0",
                pt.get("draught") or 0.0,
                "3",
            ])
        return raw_tuples

    return {
        "mmsi": mmsi,
        "count": len(track),
        "startTime": track[0].get("timestamp") if track else None,
        "endTime": track[-1].get("timestamp") if track else None,
        "track": track,
    }


# ── Broadcast interval for the full-snapshot WebSocket ──────────────────────────
WS_BROADCAST_INTERVAL = 5.0  # seconds between pushes


# ── Helper: apply type + bounds filtering ───────────────────────────────────────

def _filter_ships(
    ships: list[dict],
    requested_types: set[str] | None = None,
    single_type: str | None = None,
    include_ships: bool = True,
    bounds: dict | None = None,
    center: dict | None = None,
    max_ships: int = 2500,
) -> list[dict]:
    """Filter by viewport and spatially balance snapshots that exceed the client cap."""
    if not include_ships:
        return []
    # Maritime snapshots are viewport scoped. Never fall back to returning the
    # complete AIS buffer when a client has not supplied usable bounds.
    if not bounds:
        return []

    # ── type filter ──
    if requested_types:
        filtered = [
            s for s in ships
            if ("cargo" in requested_types and s.get("type") in ("cargo", "container"))
            or ("tanker" in requested_types and s.get("type") == "tanker")
            or ("military" in requested_types and s.get("type") == "military")
        ]
    elif single_type and single_type.lower() != "all":
        req = single_type.lower()
        if req in ("container", "cargo"):
            filtered = [s for s in ships if s.get("type") in ("cargo", "container")]
        else:
            filtered = [s for s in ships if s.get("type") == req]
    else:
        filtered = ships

    # ── bounding-box filter ──
    if bounds:
        west, south, east, north = bounds["west"], bounds["south"], bounds["east"], bounds["north"]

        def in_view(item: dict) -> bool:
            try:
                lat = float(item.get("lat"))
                lng = float(item.get("lng"))
            except (TypeError, ValueError):
                return False
            if abs(east - west) >= 360:
                inside_lon = True
            else:
                west_norm = ((west + 180) % 360) - 180
                east_norm = ((east + 180) % 360) - 180
                inside_lon = (
                    west_norm <= lng <= east_norm
                    if west_norm <= east_norm
                    else lng >= west_norm or lng <= east_norm
                )
            return south <= lat <= north and inside_lon

        filtered = [s for s in filtered if in_view(s)]

    # Rank ships inside each geographic cell by distance to the viewport center.
    # A global nearest-to-center cap overrepresents Europe when the world view is
    # centered there and can discard entire regions such as the Americas.
    try:
        c_lat = float(center["lat"]) if center else 0.0
        c_lng = float(center["lng"]) if center else 0.0
    except (KeyError, TypeError, ValueError):
        c_lat, c_lng = 0.0, 0.0

    def dist_sq(s: dict) -> float:
        try:
            dlat = float(s.get("lat")) - c_lat
            dlng = float(s.get("lng")) - c_lng
            # Normalize longitude delta across 180 meridian
            dlng = ((dlng + 180) % 360) - 180
            return dlat * dlat + dlng * dlng
        except (TypeError, ValueError):
            return 999999.0

    if len(filtered) > max_ships:
        grid: dict[tuple[int, int], list[dict]] = {}
        for ship in filtered:
            try:
                lat = float(ship.get("lat"))
                lng = float(ship.get("lng"))
            except (TypeError, ValueError):
                continue
            # Ten degree cells cover the globe while keeping enough ships
            # in each busy area to use the full snapshot budget.
            cell = (min(17, max(0, int((lat + 90) // 10))), min(35, max(0, int((lng + 180) // 10))))
            grid.setdefault(cell, []).append(ship)

        for cell_ships in grid.values():
            cell_ships.sort(key=dist_sq)

        balanced: list[dict] = []
        depth = 0
        cells = list(grid.values())
        while len(balanced) < max_ships:
            added_this_round = False
            for cell_ships in cells:
                if depth < len(cell_ships):
                    balanced.append(cell_ships[depth])
                    added_this_round = True
                    if len(balanced) == max_ships:
                        break
            if not added_this_round:
                break
            depth += 1
        filtered = balanced

    # Cap ships returned to prevent browser freezes
    if len(filtered) > max_ships:
        filtered = filtered[:max_ships]

    return filtered


def _compact_ship(s: dict) -> dict:
    return {
        "id": s.get("id") or s.get("mmsi"),
        "mmsi": s.get("mmsi") or s.get("id"),
        "name": s.get("name") or "",
        "type": s.get("type") or "cargo",
        "lat": s.get("lat"),
        "lng": s.get("lng"),
        "speed": s.get("speed"),
        "heading": s.get("heading"),
    }


def _category_counts(ships: list[dict]) -> dict:
    return {
        "cargo": sum(1 for s in ships if s.get("type") in ("cargo", "container")),
        "tanker": sum(1 for s in ships if s.get("type") == "tanker"),
        "military": sum(1 for s in ships if s.get("type") == "military"),
    }


# ── WebSocket: full AIS snapshot broadcast ──────────────────────────────────────

@router.websocket("")
@router.websocket("/")
@router.websocket("/ws")
async def maritime_ws(websocket: WebSocket):
    """
    Full AIS data over WebSocket — replaces GET /api/maritime polling.

    Endpoints supported:
      - /api/maritime
      - /api/maritime/
      - /api/maritime/ws (legacy)

    On connect: sends a complete snapshot immediately.
    Then pushes updated snapshots every 5 seconds.

    Clients can send JSON messages to adjust filters at any time:
      {"types": ["cargo", "tanker", "military"]}   — ship-type filter
      {"bounds": {"west": …, "south": …, "east": …, "north": …}}
      {"include_ships": true, "include_ports": true}

    Combine in one message:
      {"types": ["cargo"], "bounds": {"west": -10, "south": 30, "east": 40, "north": 60}}

    Send {} or {"types": []} to reset filters and get all ships.
    """
    await websocket.accept()
    logger.info("Maritime WebSocket client connected")

    # Mutable filter state — updated by incoming messages
    filter_state: dict = {
        "types": set(),
        "bounds": None,
        "center": None,
        "include_ships": True,
        "include_ports": True,
    }

    filter_changed_event = asyncio.Event()
    filter_initialized_event = asyncio.Event()

    async def _incoming_listener():
        """Listen for filter-change messages from the client."""
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                    changed = False
                    if "types" in msg:
                        raw_types = msg["types"]
                        new_types = (
                            {t.strip().lower() for t in raw_types if t.strip()}
                            if isinstance(raw_types, list) else set()
                        )
                        if new_types != filter_state["types"]:
                            filter_state["types"] = new_types
                            changed = True
                    if "center" in msg:
                        c = msg["center"]
                        if isinstance(c, dict) and "lat" in c and "lng" in c:
                            filter_state["center"] = {"lat": float(c["lat"]), "lng": float(c["lng"])}
                    if "bounds" in msg:
                        b = msg["bounds"]
                        if isinstance(b, dict) and all(k in b for k in ("west", "south", "east", "north")):
                            new_b = {
                                "west": float(b["west"]),
                                "south": float(b["south"]),
                                "east": float(b["east"]),
                                "north": float(b["north"]),
                            }
                        else:
                            new_b = None
                        if new_b != filter_state["bounds"]:
                            filter_state["bounds"] = new_b
                            changed = True
                    if "include_ships" in msg:
                        inc_s = bool(msg["include_ships"])
                        if inc_s != filter_state["include_ships"]:
                            filter_state["include_ships"] = inc_s
                            changed = True
                    if "include_ports" in msg:
                        inc_p = bool(msg["include_ports"])
                        if inc_p != filter_state["include_ports"]:
                            filter_state["include_ports"] = inc_p
                            changed = True
                    if changed:
                        filter_changed_event.set()
                    # Do not send the global AIS buffer before the client has
                    # supplied its initial viewport and layer filters.
                    filter_initialized_event.set()
                except Exception:
                    pass
        except Exception:
            pass

    listener_task = asyncio.create_task(_incoming_listener())

    try:
        await filter_initialized_event.wait()
        while True:
            # Build snapshot
            snapshot = await _build_snapshot(include_ports=filter_state["include_ports"])

            # Apply viewport and type filters
            filtered_ships = _filter_ships(
                snapshot["ships"],
                requested_types=filter_state["types"] or None,
                include_ships=filter_state["include_ships"],
                bounds=filter_state["bounds"],
                center=filter_state["center"],
            )
            include_ports = filter_state["include_ports"]
            payload = {
                "type": "maritime_snapshot",
                "ships": [_compact_ship(s) for s in filtered_ships],
                "ports": snapshot["ports"] if include_ports else [],
                "chokepoints": snapshot["chokepoints"] if include_ports else [],
                "total_ships": len(filtered_ships),
                "total_ports": len(snapshot["ports"]) if include_ports else 0,
                "total_chokepoints": len(snapshot["chokepoints"]) if include_ports else 0,
                "category_counts": _category_counts(filtered_ships),
                "filter": sorted(filter_state["types"]) if filter_state["types"] else "all",
                "timestamp": snapshot["timestamp"],
            }

            await websocket.send_text(json.dumps(payload))

            # Sleep until interval or wake up immediately if client sends new viewport/filters
            filter_changed_event.clear()
            try:
                await asyncio.wait_for(filter_changed_event.wait(), timeout=WS_BROADCAST_INTERVAL)
            except asyncio.TimeoutError:
                pass

    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as exc:
        logger.warning("Maritime WebSocket error: %s", exc)
    finally:
        listener_task.cancel()
        logger.info("Maritime WebSocket client disconnected")


# ── WebSocket: ais_filter_mmsi stream ──────────────────────────────────────────

@router.websocket("/filter-mmsi")
@router.websocket("/ws/filter-mmsi")
async def maritime_filter_mmsi_ws(websocket: WebSocket, interval: float = 3.0):
    """
    WebSocket endpoint streaming the ais_filter_mmsi allow-list and records.
    Sends full records immediately on connection, and continuously pushes updates
    periodically or whenever records change. Clients can also send {"action": "refresh"}
    to trigger an immediate snapshot.
    """
    await websocket.accept()
    logger.info("Maritime filter MMSI WebSocket client connected")

    async def _incoming():
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    msg = json.loads(data)
                    if msg.get("action") == "refresh":
                        recs = await ais_db.get_filter_mmsi_records()
                        await websocket.send_json({
                            "type": "filter_mmsi_snapshot",
                            "total": len(recs),
                            "records": recs,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                except Exception:
                    pass
        except Exception:
            pass

    listener_task = asyncio.create_task(_incoming())

    try:
        while True:
            records = await ais_db.get_filter_mmsi_records()
            payload = {
                "type": "filter_mmsi_update",
                "total": len(records),
                "records": records,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            await websocket.send_json(payload)
            await asyncio.sleep(max(1.0, interval))
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as exc:
        logger.warning("Maritime filter MMSI WebSocket error: %s", exc)
    finally:
        listener_task.cancel()
        logger.info("Maritime filter MMSI WebSocket client disconnected")


# ── Static Data ─────────────────────────────────────────────────────────────────

def _distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Fast approximate distance in km (equirectangular)."""
    dx = (lng1 - lng2) * math.cos(math.radians((lat1 + lat2) / 2))
    dy = lat1 - lat2
    return math.sqrt(dx * dx + dy * dy) * 111.32


# ── Snapshot Builder ─────────────────────────────────────────────────────────────


async def _build_snapshot(include_ports: bool = True) -> dict:
    """Build a complete maritime snapshot with dynamic port/chokepoint analysis."""
    ships = await ais_stream.get_ships()
    if not ships:
        db_ships = await ais_db.load_ships_from_db()
        ships = list(db_ships.values())
    now = time.time()

    # No bundled port or chokepoint catalog; these arrays populate only from a future live source.
    dynamic_ports = []
    dynamic_chokepoints = []

    cargo_count = sum(1 for s in ships if s.get("type") in ("cargo", "container") or not s.get("type"))
    tanker_count = sum(1 for s in ships if s.get("type") == "tanker")
    military_count = sum(1 for s in ships if s.get("type") == "military")

    return {
        "ports": dynamic_ports,
        "chokepoints": dynamic_chokepoints,
        "ships": ships,
        "total_ports": len(dynamic_ports),
        "total_chokepoints": len(dynamic_chokepoints),
        "total_ships": len(ships),
        "category_counts": {
            "cargo": cargo_count,
            "tanker": tanker_count,
            "military": military_count,
        },
        "timestamp": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
    }



