"""
LTmap — AIS WebSocket Stream Manager

Maintains a persistent WebSocket connection to aisstream.io for live ship
tracking data. Ported from the frontend's maritime/route.ts WebSocket logic.

Ship records are kept in an in-memory dict and persisted to MySQL via ais_db.
On startup, the in-memory dict is restored from the database.
The connection auto-reconnects on drop.
"""

import asyncio
import collections
import json
import logging
import time
import math
from datetime import datetime, timezone
from typing import Any

import websockets

from ..config import settings
from ..urls import AISSTREAM_WEBSOCKET
from . import ais_db

logger = logging.getLogger("ltmap.ais")

# ── Ship Storage ────────────────────────────────────────────────────────────────

_ships: dict[int, dict[str, Any]] = {}
_ship_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
_lock = asyncio.Lock()
_ws_task: asyncio.Task | None = None
_running = False
MAX_SHIPS = 20_000
MAX_TRACK_POINTS = 500

# ── Live Incoming Stream Packet Feed ──────────────────────────────────────────
_recent_incoming_packets: collections.deque[dict[str, Any]] = collections.deque(maxlen=100)
_total_packets_received: int = 0
_start_time: float = time.time()


def _distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two AIS positions."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 6371.0088 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))


def _record_position(existing: dict[str, Any], lat: float, lng: float, seen_at: float) -> None:
    """Append a valid, non-duplicate position and update observed journey stats."""
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
        return
    track = existing.setdefault("track", [])
    if track and seen_at - float(track[-1].get("timestamp", 0)) < 1:
        track[-1] = {"lat": lat, "lng": lng, "timestamp": seen_at, "speed": existing.get("speed")}
        existing["lat"], existing["lng"] = lat, lng
        existing["lastSeenAt"] = seen_at
        return
    if track:
        previous = track[-1]
        segment = _distance_km(float(previous["lat"]), float(previous["lng"]), lat, lng)
        # Drop obvious bad jumps; they must not inflate reported vessel travel.
        elapsed_hours = max((seen_at - float(previous["timestamp"])) / 3600, 1 / 3600)
        if segment <= 1000 and segment / elapsed_hours <= 90:
            existing["trackDistanceKm"] = float(existing.get("trackDistanceKm", 0)) + segment
        else:
            segment = 0
    else:
        existing["trackStartLat"] = lat
        existing["trackStartLng"] = lng
        existing["trackStartAt"] = seen_at
        existing["trackDistanceKm"] = 0.0
    track.append({"lat": lat, "lng": lng, "timestamp": seen_at, "speed": existing.get("speed")})
    if len(track) > MAX_TRACK_POINTS:
        del track[:-MAX_TRACK_POINTS]
    existing["lat"], existing["lng"] = lat, lng
    existing["lastSeenAt"] = seen_at
    existing["trackPointCount"] = int(existing.get("trackPointCount", 0)) + 1


def _get_ship_type(type_code: int) -> str:
    """Map AIS type code to LTmap ship category."""
    if not type_code:
        return "cargo"
    if 80 <= type_code <= 89:
        return "tanker"
    if 70 <= type_code <= 79:
        return "cargo"
    if type_code in (35, 55, 50, 51):
        return "military"
    return "cargo"


def _size_class(length: Any, ais_type_code: Any = None) -> tuple[str, str]:
    """Classify vessel size from AIS LOA, with an explicitly marked type fallback."""
    try:
        length_m = float(length)
    except (TypeError, ValueError):
        length_m = 0
    if length_m > 0:
        if length_m < 50:
            return "small", "ais_dimensions"
        if length_m < 120:
            return "medium", "ais_dimensions"
        if length_m < 250:
            return "large", "ais_dimensions"
        return "very_large", "ais_dimensions"
    try:
        code = int(ais_type_code or 0)
    except (TypeError, ValueError):
        code = 0
    if 30 <= code <= 39 or 50 <= code <= 59:
        return "small", "ais_type_estimate"
    if 60 <= code <= 69:
        return "medium", "ais_type_estimate"
    if 70 <= code <= 89:
        return "large", "ais_type_estimate"
    return "unknown", "unreported"


def _normalize_ship_size(ship: dict[str, Any]) -> None:
    """Read common AIS dimension variants and attach display-ready size metadata."""
    dimension = ship.get("dimension") or ship.get("Dimension") or {}
    if not isinstance(dimension, dict):
        dimension = {}
    def number(*values: Any) -> float:
        for value in values:
            try:
                parsed = float(value)
                if parsed > 0:
                    return parsed
            except (TypeError, ValueError):
                continue
        return 0.0
    length = number(ship.get("length"), ship.get("length_m"))
    width = number(ship.get("width"), ship.get("width_m"))
    if not length:
        length = number(dimension.get("A")) + number(dimension.get("B"))
    if not width:
        width = number(dimension.get("C")) + number(dimension.get("D"))
    if length:
        ship["length"] = length
    if width:
        ship["width"] = width
    if not ship.get("draught") and ship.get("MaximumStaticDraught") is not None:
        ship["draught"] = ship.get("MaximumStaticDraught")
    size_class, source = _size_class(length, ship.get("aisTypeCode"))
    ship["sizeClass"] = size_class
    if length and ship.get("sizeSource") != "vesselfinder_masterdata":
        ship["sizeSource"] = "ais_dimensions"
    elif not length:
        ship["sizeSource"] = source


async def _handle_message(raw: str | bytes) -> None:
    """Process one AIS message from the WebSocket stream."""
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        parsed = json.loads(raw)
    except Exception as e:
        logger.debug("Failed to decode AIS message: %s", e)
        return

    # AISStream sends subscription/authentication errors as JSON messages
    # without MetaData.MMSI. Log them instead of silently discarding them as
    # malformed vessel updates, which made a dead feed look like an empty sea.
    if parsed.get("error"):
        logger.error("AIS provider rejected the stream: %s", parsed.get("error"))
        return

    mmsi = parsed.get("MetaData", {}).get("MMSI")
    if not mmsi:
        return

    async with _lock:
        existing = _ships.get(mmsi, {"id": mmsi, "mmsi": mmsi, "type": "cargo", "timestamp": time.time(), "track": [], "trackPointCount": 0, "trackDistanceKm": 0.0})

        meta = parsed.get("MetaData", {})
        if meta.get("ShipName"):
            existing["name"] = meta["ShipName"].strip()

        # MetaData frequently carries real-time latitude & longitude
        meta_lat = meta.get("latitude")
        meta_lng = meta.get("longitude")
        if meta_lat is not None and meta_lng is not None and (meta_lat != 0 or meta_lng != 0) and existing.get("lat") is None:
            if existing.get("firstSeenLat") is None or existing.get("firstSeenLng") is None:
                existing["firstSeenLat"] = meta_lat
                existing["firstSeenLng"] = meta_lng
                existing["firstSeenAt"] = time.time()
            _record_position(existing, float(meta_lat), float(meta_lng), time.time())

        msg_type = parsed.get("MessageType", "")

        if msg_type == "PositionReport":
            report = parsed.get("Message", {}).get("PositionReport", {})
            if report:
                lat = report.get("Latitude")
                lng = report.get("Longitude")
                if lat is not None and lng is not None and (lat != 0 or lng != 0):
                    if existing.get("firstSeenLat") is None or existing.get("firstSeenLng") is None:
                        existing["firstSeenLat"] = lat
                        existing["firstSeenLng"] = lng
                        existing["firstSeenAt"] = time.time()
                existing["speed"] = report.get("Sog")
                if lat is not None and lng is not None:
                    _record_position(existing, float(lat), float(lng), time.time())
                true_heading = report.get("TrueHeading")
                course = report.get("Cog")
                existing["heading"] = true_heading if true_heading is not None and 0 <= true_heading < 360 else course
                existing["timestamp"] = time.time()

        elif msg_type == "ShipStaticData":
            static = parsed.get("Message", {}).get("ShipStaticData", {})
            if static:
                if static.get("Name"):
                    existing["name"] = static["Name"].strip()
                if static.get("Destination"):
                    existing["destination"] = static["Destination"].strip()
                ais_type_code = static.get("Type") or static.get("ShipType") or 0
                try:
                    ais_type_code = int(ais_type_code)
                except (TypeError, ValueError):
                    ais_type_code = 0
                existing["aisTypeCode"] = ais_type_code
                existing["type"] = _get_ship_type(ais_type_code)
                # AIS static dimensions use four reference offsets (metres).
                # Sum bow/stern and port/starboard offsets into overall size.
                dimension = static.get("Dimension") or {}
                try:
                    length = float(dimension.get("A", 0)) + float(dimension.get("B", 0))
                    width = float(dimension.get("C", 0)) + float(dimension.get("D", 0))
                    if length > 0:
                        existing["length"] = length
                    if width > 0:
                        existing["width"] = width
                except (TypeError, ValueError, AttributeError):
                    pass
                draught_value = static.get("MaximumStaticDraught", static.get("Draught"))
                if draught_value is not None:
                    try:
                        draught = float(draught_value)
                        if draught > 0:
                            existing["draught"] = draught
                    except (TypeError, ValueError):
                        pass

        # Only store if we have a position
        if existing.get("lat") is not None and existing.get("lng") is not None:
            _normalize_ship_size(existing)
            _ships[mmsi] = existing
            # Persist to database
            asyncio.ensure_future(ais_db.queue_ship_update(mmsi, existing.copy()))
            update = existing.copy()
            for queue in tuple(_ship_subscribers):
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                try:
                    queue.put_nowait(update)
                except asyncio.QueueFull:
                    pass

        # Record incoming packet for real-time live monitor
        global _total_packets_received
        _total_packets_received += 1
        pkt = {
            "id": _total_packets_received,
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3],
            "source": "aisstream.io",
            "msg_type": msg_type or "Unknown",
            "mmsi": mmsi,
            "name": meta.get("ShipName", "").strip() or existing.get("name", "Unknown"),
            "lat": round(float(existing["lat"]), 4) if existing.get("lat") is not None else None,
            "lng": round(float(existing["lng"]), 4) if existing.get("lng") is not None else None,
            "speed": round(float(existing["speed"]), 1) if existing.get("speed") is not None else 0.0,
            "heading": round(float(existing["heading"]), 0) if existing.get("heading") is not None else None,
            "destination": existing.get("destination", ""),
            "type": existing.get("type", "cargo"),
            "raw_payload": parsed,
        }
        _recent_incoming_packets.appendleft(pkt)

        # Evict oldest if too many
        if len(_ships) > MAX_SHIPS:
            oldest = next(iter(_ships))
            _ships.pop(oldest, None)


async def ingest_external_ship(mmsi: int, fields: dict[str, Any]) -> None:
    """Merge a position or metadata update from a secondary AIS provider."""
    async with _lock:
        existing = _ships.get(mmsi, {"id": mmsi, "mmsi": mmsi, "timestamp": time.time(), "track": [], "trackPointCount": 0, "trackDistanceKm": 0.0})
        lat, lng = fields.get("lat"), fields.get("lng")
        existing.update({key: value for key, value in fields.items() if value is not None})
        if lat is not None and lng is not None:
            _record_position(existing, float(lat), float(lng), time.time())
        if existing.get("lat") is not None and existing.get("lng") is not None:
            _normalize_ship_size(existing)
            existing["timestamp"] = time.time()
            _ships[mmsi] = existing
            asyncio.ensure_future(ais_db.queue_ship_update(mmsi, existing.copy()))
            update = existing.copy()
            for queue in tuple(_ship_subscribers):
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                try:
                    queue.put_nowait(update)
                except asyncio.QueueFull:
                    pass

        # Record incoming packet for real-time live monitor
        global _total_packets_received
        _total_packets_received += 1
        pkt = {
            "id": _total_packets_received,
            "time": datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3],
            "source": "digitraffic.fi",
            "msg_type": "LocationUpdate" if fields.get("lat") is not None else "MetadataUpdate",
            "mmsi": mmsi,
            "name": fields.get("name") or existing.get("name", "Unknown"),
            "lat": round(float(existing["lat"]), 4) if existing.get("lat") is not None else None,
            "lng": round(float(existing["lng"]), 4) if existing.get("lng") is not None else None,
            "speed": round(float(existing["speed"]), 1) if existing.get("speed") is not None else 0.0,
            "heading": round(float(existing["heading"]), 0) if existing.get("heading") is not None else None,
            "destination": existing.get("destination", ""),
            "type": existing.get("type", "cargo"),
            "raw_payload": fields,
        }
        _recent_incoming_packets.appendleft(pkt)


async def _connect_loop() -> None:
    """Persistent WebSocket connection with auto-reconnect."""
    global _running

    api_key = settings.AIS_API_KEY
    if not api_key:
        logger.warning("AIS_API_KEY not set — maritime ship stream disabled")
        return

    _running = True
    while _running:
        try:
            logger.info("Connecting to aisstream.io...")
            async with websockets.connect(
                AISSTREAM_WEBSOCKET,
                ping_interval=30,
                ping_timeout=10,
                close_timeout=5,
            ) as ws:
                # Global bounding box for worldwide maritime visibility
                sub = {
                    "APIKey": api_key,
                    "BoundingBoxes": [[[-90.0, -180.0], [90.0, 180.0]]],
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }
                await ws.send(json.dumps(sub))
                logger.info("AIS stream connected and subscribed (global coverage)")

                async for message in ws:
                    if not _running:
                        break
                    await _handle_message(message)

        except websockets.exceptions.ConnectionClosed as exc:
            logger.warning(
                "AIS WebSocket closed (code=%s, reason=%s), reconnecting in 5s...",
                exc.code,
                exc.reason or "no reason supplied",
            )
        except Exception as exc:
            logger.warning("AIS WebSocket error: %s, reconnecting in 5s...", exc)

        if _running:
            await asyncio.sleep(5)


# ── Public API ──────────────────────────────────────────────────────────────────

async def start() -> None:
    """Start the AIS stream background task (called on app startup)."""
    global _ws_task
    try:
        restored = await ais_db.load_ships_from_db()
        if restored:
            async with _lock:
                for k, v in restored.items():
                    if k not in _ships:
                        _ships[k] = v
            logger.info("Restored %d vessels from database into AIS cache", len(restored))
    except Exception as e:
        logger.warning("Could not restore AIS vessels from DB: %s", e)

    if _ws_task is None or _ws_task.done():
        _ws_task = asyncio.create_task(_connect_loop())
        logger.info("AIS stream background task started")


async def stop() -> None:
    """Gracefully stop the AIS stream (called on app shutdown)."""
    global _running, _ws_task
    _running = False
    if _ws_task and not _ws_task.done():
        _ws_task.cancel()
        try:
            await _ws_task
        except asyncio.CancelledError:
            pass
    _ws_task = None
    logger.info("AIS stream stopped")


async def get_ships() -> list[dict[str, Any]]:
    """Return a snapshot of all tracked ships, pruning stale entries."""
    now = time.time()
    stale_cutoff = now - 60 * 60  # 60 minutes

    async with _lock:
        # Prune stale
        stale_keys = [k for k, v in _ships.items() if v.get("timestamp", 0) < stale_cutoff]
        for k in stale_keys:
            del _ships[k]
        for ship in _ships.values():
            _normalize_ship_size(ship)
        return list(_ships.values())


async def get_ship(mmsi: int | str) -> dict[str, Any] | None:
    """Return a single ship record by MMSI."""
    try:
        int_mmsi = int(mmsi)
    except (ValueError, TypeError):
        int_mmsi = None

    async with _lock:
        if int_mmsi is not None and int_mmsi in _ships:
            return _ships[int_mmsi].copy()
        for k, v in _ships.items():
            if str(k) == str(mmsi) or str(v.get("id")) == str(mmsi) or str(v.get("mmsi")) == str(mmsi):
                return v.copy()
        return None


def subscribe_ships() -> asyncio.Queue[dict[str, Any]]:
    """Subscribe to incremental AIS position updates."""
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=2048)
    _ship_subscribers.add(queue)
    return queue


def unsubscribe_ships(queue: asyncio.Queue[dict[str, Any]]) -> None:
    _ship_subscribers.discard(queue)


def ship_count() -> int:
    """Number of currently tracked ships (lock-free, for stats)."""
    return len(_ships)


def get_recent_packets(limit: int = 50) -> list[dict[str, Any]]:
    """Return the most recently received raw AIS stream packets."""
    return list(_recent_incoming_packets)[:limit]


def get_stream_stats() -> dict[str, Any]:
    """Return throughput and counter statistics for the incoming feed."""
    uptime = max(time.time() - _start_time, 1)
    return {
        "total_packets": _total_packets_received,
        "rate_per_sec": round(_total_packets_received / uptime, 1),
        "vessels_in_cache": len(_ships),
        "uptime_seconds": int(uptime),
    }
