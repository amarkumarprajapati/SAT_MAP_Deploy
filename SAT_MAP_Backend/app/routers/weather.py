"""Cached global wind data for the 2D map."""

import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from .. import database

logger = logging.getLogger("ltmap.weather")
router = APIRouter(prefix="/api/weather", tags=["weather"])

SNAPSHOT_KEY = "weather.wind.global"
REFRESH_SECONDS = 60 * 60
BATCH_SIZE = 48
MAX_ATTEMPTS = 3

# The wind-field renderer expects a 15-degree global grid. Forecast points at
# the poles are unreliable, so fetch -75..75 and extend the edge rows to ±90.
_provider_locations = [
    {"lat": lat, "lon": lon}
    for lat in range(-75, 76, 15)
    for lon in range(-180, 180, 15)
]
_memory_snapshot: dict[str, Any] | None = None
_refresh_lock = asyncio.Lock()
_refresh_task: asyncio.Task[dict[str, Any] | None] | None = None


async def _fetch_batch(client: httpx.AsyncClient, batch: list[dict[str, int]]) -> list[dict[str, float]]:
    params = {
        "latitude": ",".join(str(point["lat"]) for point in batch),
        "longitude": ",".join(str(point["lon"]) for point in batch),
        "current": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "ms",
        "cell_selection": "nearest",
    }
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            response.raise_for_status()
            body = response.json()
            values = body if isinstance(body, list) else [body]
            if len(values) != len(batch):
                raise ValueError(f"provider returned {len(values)} locations for {len(batch)} requested")
            points = []
            for location, value in zip(batch, values):
                current = value.get("current") or {}
                speed = current.get("wind_speed_10m")
                direction = current.get("wind_direction_10m")
                if not isinstance(speed, (int, float)) or not math.isfinite(speed):
                    raise ValueError("provider returned invalid wind speed")
                if not isinstance(direction, (int, float)) or not math.isfinite(direction):
                    raise ValueError("provider returned invalid wind direction")
                points.append({**location, "speed": float(speed), "direction": float(direction)})
            return points
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            if attempt + 1 == MAX_ATTEMPTS:
                raise RuntimeError(f"Open-Meteo wind request failed: {exc}") from exc
            await asyncio.sleep(0.5 * (attempt + 1))
    raise RuntimeError("Open-Meteo wind request failed")


async def refresh_wind_snapshot() -> dict[str, Any] | None:
    """Fetch live wind, persist it, and retain the prior snapshot on failure."""
    global _memory_snapshot
    async with _refresh_lock:
        batches = [
            _provider_locations[index:index + BATCH_SIZE]
            for index in range(0, len(_provider_locations), BATCH_SIZE)
        ]
        try:
            timeout = httpx.Timeout(45.0, connect=8.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                fetched = await asyncio.gather(*(_fetch_batch(client, batch) for batch in batches))
            by_key = {(point["lat"], point["lon"]): point for batch in fetched for point in batch}
            points = []
            for lat in range(-90, 91, 15):
                provider_lat = max(-75, min(75, lat))
                for lon in range(-180, 180, 15):
                    source = by_key[(provider_lat, lon)]
                    points.append({"lat": lat, "lon": lon, "speed": source["speed"], "direction": source["direction"]})
            snapshot = {
                "points": points,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "source": "Open-Meteo",
            }
            _memory_snapshot = snapshot
            await database.save_snapshot(SNAPSHOT_KEY, snapshot)
            logger.info("Refreshed and saved global wind snapshot (%d points)", len(points))
            return snapshot
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Wind refresh failed; retaining the last saved snapshot")
            return await _load_snapshot()


async def _load_snapshot() -> dict[str, Any] | None:
    global _memory_snapshot
    saved = await database.load_snapshot(SNAPSHOT_KEY)
    if isinstance(saved, dict) and isinstance(saved.get("points"), list):
        _memory_snapshot = saved
        return saved
    return _memory_snapshot


def _snapshot_age_seconds(snapshot: dict[str, Any]) -> float:
    try:
        updated = datetime.fromisoformat(str(snapshot["updated_at"]).replace("Z", "+00:00"))
        return max(0.0, (datetime.now(timezone.utc) - updated).total_seconds())
    except (KeyError, TypeError, ValueError):
        return float("inf")


def schedule_wind_refresh() -> asyncio.Task[dict[str, Any] | None]:
    global _refresh_task
    if _refresh_task is None or _refresh_task.done():
        _refresh_task = asyncio.create_task(refresh_wind_snapshot(), name="wind-snapshot-refresh")
    return _refresh_task


@router.get("/wind-data")
async def get_wind_data() -> JSONResponse:
    snapshot = await _load_snapshot()
    if snapshot is not None:
        stale = _snapshot_age_seconds(snapshot) >= REFRESH_SECONDS
        if stale:
            schedule_wind_refresh()
        return JSONResponse(
            content={**snapshot, "stale": stale},
            headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=3600"},
        )

    schedule_wind_refresh()
    raise HTTPException(status_code=503, detail="Wind data is being initialized from the weather provider")
