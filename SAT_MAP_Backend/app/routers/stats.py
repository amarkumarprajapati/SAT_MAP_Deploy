"""
LTmap — Platform Summary Stats Router

Aggregates counts of active satellites and maritime vessels directly from
in-process caches and services without calling external proxies.
Ported from stats/route.ts.
"""

import time
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..services import ais_stream, tle_cache

logger = logging.getLogger("ltmap.stats")

router = APIRouter(prefix="/api/stats", tags=["stats"])

TTL_SECONDS = 30.0
_snapshot: dict | None = None
_snapshot_time: float = 0


async def _compute_stats() -> dict[str, int]:
    
    sat_count = tle_cache.catalogue_size()
    maritime_count = ais_stream.ship_count()

    return {"sats": sat_count, "maritime": maritime_count}


@router.get("")
async def get_stats():
    """
    Platform summary statistics for satellites and AIS maritime vessels.
    """
    global _snapshot, _snapshot_time

    now = time.time()
    if _snapshot and now - _snapshot_time < TTL_SECONDS:
        return JSONResponse(
            content=_snapshot,
            headers={"Cache-Control": "public, s-maxage=30, stale-while-revalidate=60"},
        )

    try:
        stats = await _compute_stats()
        _snapshot = {
            "stats": stats,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        _snapshot_time = now

        return JSONResponse(
            content=_snapshot,
            headers={"Cache-Control": "public, s-maxage=30, stale-while-revalidate=60"},
        )
    except Exception as exc:
        logger.error("Stats aggregation failed: %s", exc)
        return JSONResponse(
            content={"error": "Failed to compute stats"},
            status_code=500,
        )
