"""
LTmap — Maritime Router

Serves live AIS ship positions (from the ais_stream service). Port and
chokepoint overlays remain empty until a live geographic data source is added.
"""

import asyncio
import math
import time
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from ..services import ais_stream

logger = logging.getLogger("ltmap.maritime")

router = APIRouter(prefix="/api/maritime", tags=["maritime"])


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


# ── Snapshot Cache ──────────────────────────────────────────────────────────────
_snapshot_cache: dict[bool, dict] = {}
_snapshot_time: dict[bool, float] = {}
SNAPSHOT_TTL = 5.0  # seconds


async def _build_snapshot(include_ports: bool = True) -> dict:
    """Build a complete maritime snapshot with dynamic port/chokepoint analysis."""
    ships = await ais_stream.get_ships()
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


@router.get("")
async def get_maritime_data(
    type: str | None = None,
    types: str | None = None,
    include_ships: bool = True,
    include_ports: bool = True,
    west: float | None = Query(None, ge=-540, le=540),
    south: float | None = Query(None, ge=-90, le=90),
    east: float | None = Query(None, ge=-540, le=540),
    north: float | None = Query(None, ge=-90, le=90),
):
    """Fetch live AIS maritime data: vessels, ports, and chokepoints.
    Optionally filter ships by category: 'container' / 'cargo', 'tanker', 'military', 'all'.
    """
    global _snapshot_cache, _snapshot_time

    # Return immediately when every maritime layer is off, without polling AIS.
    if not include_ships and not include_ports:
        return Response(
            content=json.dumps({
                "ports": [], "chokepoints": [], "ships": [],
                "total_ports": 0, "total_chokepoints": 0, "total_ships": 0,
                "category_counts": {"cargo": 0, "tanker": 0, "military": 0},
                "timestamp": datetime.now(timezone.utc).isoformat(), "filter": "all",
            }),
            media_type="application/json",
            headers={"Cache-Control": "no-store"},
        )

    now = time.time()
    cache_key = bool(include_ports)
    if cache_key in _snapshot_cache and now - _snapshot_time.get(cache_key, 0) < SNAPSHOT_TTL:
        snapshot = _snapshot_cache[cache_key]
    else:
        snapshot = await _build_snapshot(include_ports=include_ports)
        _snapshot_cache[cache_key] = snapshot
        _snapshot_time[cache_key] = now

    requested_types = {
        value.strip().lower() for value in (types or "").split(",") if value.strip()
    }
    if requested_types:
        filtered_ships = [
            ship for ship in snapshot["ships"]
            if ("cargo" in requested_types and ship.get("type") in ("cargo", "container"))
            or ("tanker" in requested_types and ship.get("type") == "tanker")
            or ("military" in requested_types and ship.get("type") == "military")
        ]
    elif type and type.lower() != "all":
        req_type = type.lower()
        if req_type in ("container", "cargo"):
            filtered_ships = [s for s in snapshot["ships"] if s.get("type") in ("cargo", "container")]
        else:
            filtered_ships = [s for s in snapshot["ships"] if s.get("type") == req_type]
    else:
        filtered_ships = snapshot["ships"] if include_ships else []

    response_data = {
        **snapshot,
        "ships": filtered_ships,
        "ports": snapshot["ports"] if include_ports else [],
        "chokepoints": snapshot["chokepoints"] if include_ports else [],
        "total_ships": len(filtered_ships),
        "total_ports": len(snapshot["ports"]) if include_ports else 0,
        "total_chokepoints": len(snapshot["chokepoints"]) if include_ports else 0,
        "filter": sorted(requested_types) if requested_types else (type or "all"),
    }

    if None not in (west, south, east, north):
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
                inside_lon = west_norm <= lng <= east_norm if west_norm <= east_norm else lng >= west_norm or lng <= east_norm
            return south <= lat <= north and inside_lon

        response_data["ships"] = [s for s in response_data["ships"] if in_view(s)]
        response_data["ports"] = [p for p in response_data["ports"] if in_view(p)]
        response_data["chokepoints"] = [p for p in response_data["chokepoints"] if in_view(p)]
        response_data["total_ships"] = len(response_data["ships"])
        response_data["total_ports"] = len(response_data["ports"])
        response_data["total_chokepoints"] = len(response_data["chokepoints"])
    response_data["category_counts"] = {
        "cargo": sum(1 for ship in response_data["ships"] if ship.get("type") in ("cargo", "container")),
        "tanker": sum(1 for ship in response_data["ships"] if ship.get("type") == "tanker"),
        "military": sum(1 for ship in response_data["ships"] if ship.get("type") == "military"),
    }

    body = json.dumps(response_data)

    return Response(
        content=body,
        media_type="application/json",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )
