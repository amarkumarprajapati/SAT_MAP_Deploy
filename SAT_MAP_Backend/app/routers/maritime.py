"""
LTmap — Maritime Router

Serves live AIS ship positions (from the ais_stream service). Port and
chokepoint overlays remain empty until a live geographic data source is added.

WebSocket endpoints:
  /api/maritime/ws      — Full AIS snapshot broadcast (replaces GET polling)
  /api/maritime/stream  — Focused single-vessel tracking by MMSI
"""

import asyncio
import math
import time
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services import ais_stream, ais_db

logger = logging.getLogger("ltmap.maritime")

router = APIRouter(prefix="/api/maritime", tags=["maritime"])

# ── Broadcast interval for the full-snapshot WebSocket ──────────────────────────
WS_BROADCAST_INTERVAL = 5.0  # seconds between pushes


# ── Helper: apply type + bounds filtering ───────────────────────────────────────

def _filter_ships(
    ships: list[dict],
    requested_types: set[str] | None = None,
    single_type: str | None = None,
    include_ships: bool = True,
    bounds: dict | None = None,
) -> list[dict]:
    """Filter a ship list by type and optional bounding box."""
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
        filtered = ships if include_ships else []

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

    return filtered


def _category_counts(ships: list[dict]) -> dict:
    return {
        "cargo": sum(1 for s in ships if s.get("type") in ("cargo", "container")),
        "tanker": sum(1 for s in ships if s.get("type") == "tanker"),
        "military": sum(1 for s in ships if s.get("type") == "military"),
    }


# ── WebSocket: full AIS snapshot broadcast ──────────────────────────────────────

@router.websocket("/ws")
async def maritime_ws(websocket: WebSocket):
    """
    Full AIS data over WebSocket — replaces GET /api/maritime polling.

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
        "include_ships": True,
        "include_ports": True,
    }

    async def _incoming_listener():
        """Listen for filter-change messages from the client."""
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                    if "types" in msg:
                        raw_types = msg["types"]
                        filter_state["types"] = (
                            {t.strip().lower() for t in raw_types if t.strip()}
                            if isinstance(raw_types, list) else set()
                        )
                    if "bounds" in msg:
                        b = msg["bounds"]
                        if isinstance(b, dict) and all(k in b for k in ("west", "south", "east", "north")):
                            filter_state["bounds"] = {
                                "west": float(b["west"]),
                                "south": float(b["south"]),
                                "east": float(b["east"]),
                                "north": float(b["north"]),
                            }
                        else:
                            filter_state["bounds"] = None
                    if "include_ships" in msg:
                        filter_state["include_ships"] = bool(msg["include_ships"])
                    if "include_ports" in msg:
                        filter_state["include_ports"] = bool(msg["include_ports"])
                except Exception:
                    pass
        except Exception:
            pass

    listener_task = asyncio.create_task(_incoming_listener())

    try:
        while True:
            # Build snapshot
            snapshot = await _build_snapshot(include_ports=filter_state["include_ports"])

            # Apply filters
            filtered_ships = _filter_ships(
                snapshot["ships"],
                requested_types=filter_state["types"] or None,
                include_ships=filter_state["include_ships"],
                bounds=filter_state["bounds"],
            )

            include_ports = filter_state["include_ports"]
            payload = {
                "type": "maritime_snapshot",
                "ships": filtered_ships,
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
            await asyncio.sleep(WS_BROADCAST_INTERVAL)

    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception as exc:
        logger.warning("Maritime WebSocket error: %s", exc)
    finally:
        listener_task.cancel()
        logger.info("Maritime WebSocket client disconnected")


# ── WebSocket: focused single-vessel tracking ──────────────────────────────────

@router.websocket("/stream")
async def maritime_stream(websocket: WebSocket, mmsi: str | None = None):
    """
    Focused AIS stream.
    Supports on-demand vessel tracking so client is not overloaded with 20,000 ships.
    Clients can send {"action": "track", "mmsi": ...} or {"action": "untrack"}.
    """
    await websocket.accept()
    queue = ais_stream.subscribe_ships()
    tracked_mmsi: str | None = str(mmsi) if mmsi else None

    # If MMSI was requested on connect, send its current snapshot immediately
    if tracked_mmsi:
        current = await ais_stream.get_ship(tracked_mmsi)
        if current:
            await websocket.send_json({"type": "ship_update", "ship": current})

    async def incoming_listener():
        nonlocal tracked_mmsi
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    msg = json.loads(data)
                    action = msg.get("action")
                    if action == "track":
                        target = msg.get("mmsi")
                        if target:
                            tracked_mmsi = str(target)
                            current = await ais_stream.get_ship(tracked_mmsi)
                            if current:
                                await websocket.send_json({"type": "ship_update", "ship": current})
                    elif action == "untrack":
                        tracked_mmsi = None
                except Exception:
                    pass
        except Exception:
            pass

    listener_task = asyncio.create_task(incoming_listener())

    try:
        while True:
            ship = await queue.get()
            # Only broadcast if this ship matches the tracked MMSI
            if tracked_mmsi:
                ship_mmsi = str(ship.get("mmsi") or ship.get("id") or "")
                if ship_mmsi == tracked_mmsi:
                    await websocket.send_json({"type": "ship_update", "ship": ship})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        listener_task.cancel()
        ais_stream.unsubscribe_ships(queue)


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



