"""
LTmap — Database & Services Control Dashboard
"""

import time
import math
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .. import database
from ..config import settings
from ..services import ais_db, ais_stream, digitraffic_ais
from .dashboard_html import DASHBOARD_HTML

logger = logging.getLogger("ltmap.dashboard")

router = APIRouter(tags=["dashboard"])


# ── Administrative API Endpoints ───────────────────────────────────────────────

@router.get("/api/admin/status")
async def get_services_status():
    """Return live status of all background streaming & ingestion services."""
    db_status = await database.status()
    now = time.time()
    in_mem_count = ais_stream.ship_count()
    stream_stats = ais_stream.get_stream_stats()

    return {
        "timestamp": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
        "database": {
            "status": db_status,
            "host": settings.DATABASE_HOST or "SQLite (Local)",
            "port": settings.DATABASE_PORT,
            "name": settings.DATABASE_NAME or "sat_map.sqlite3",
            "required": settings.DATABASE_REQUIRED,
        },
        "services": {
            "ais_stream": {
                "name": "AISStream (Global Maritime)",
                "status": "RUNNING" if ais_stream._running else "STOPPED",
                "vessels_in_memory": in_mem_count,
                "api_key_configured": bool(settings.AIS_API_KEY),
                "total_packets": stream_stats.get("total_packets", 0),
                "rate_per_sec": stream_stats.get("rate_per_sec", 0.0),
            },
            "digitraffic": {
                "name": "Digitraffic (Baltic / Finnish Waters)",
                "status": "CONNECTED" if digitraffic_ais._client and digitraffic_ais._client.is_connected() else "STANDBY",
                "protocol": "MQTT over WebSocket TLS",
            },
            "ais_db_worker": {
                "name": "MySQL Batch Persistence Worker",
                "status": "RUNNING" if ais_db._running else "STOPPED",
                "pending_queue_size": len(getattr(ais_db, "_pending", {})),
                "flush_interval_seconds": ais_db.BATCH_FLUSH_INTERVAL,
                "retention_hours": ais_db.TRACK_RETENTION_HOURS,
            },
        },
        "stream_vessels_total": in_mem_count,
    }


@router.get("/api/admin/db/stats")
async def get_database_stats():
    """Return comparative telemetry counts between live buffer and MySQL database."""
    pool = database._pool
    sqlite = database._sqlite

    vessel_count = 0
    track_count = 0
    filter_count = 0
    type_counts = {}
    min_time = None
    max_time = None

    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT COUNT(*) FROM ais_vessels")
                (vessel_count,) = await cur.fetchone()

                await cur.execute("SELECT COUNT(*) FROM ais_track_points")
                (track_count,) = await cur.fetchone()

                await cur.execute("SELECT COUNT(*) FROM ais_filter_mmsi WHERE active = 1")
                (filter_count,) = await cur.fetchone()

                await cur.execute("SELECT ship_type, COUNT(*) FROM ais_vessels GROUP BY ship_type")
                type_rows = await cur.fetchall()
                type_counts = {r[0]: r[1] for r in type_rows}

                await cur.execute("SELECT MIN(last_seen_at), MAX(last_seen_at) FROM ais_vessels")
                min_time, max_time = await cur.fetchone()

    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute("SELECT COUNT(*) FROM ais_vessels")
        vessel_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM ais_track_points")
        track_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM ais_filter_mmsi WHERE active = 1")
        filter_count = cur.fetchone()[0]
        cur.execute("SELECT ship_type, COUNT(*) FROM ais_vessels GROUP BY ship_type")
        type_counts = dict(cur.fetchall())
        cur.execute("SELECT MIN(last_seen_at), MAX(last_seen_at) FROM ais_vessels")
        min_time, max_time = cur.fetchone()
    else:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    def _fmt(ts):
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None

    in_mem = ais_stream.ship_count()
    return {
        "vessels_count": vessel_count,
        "track_points_count": track_count,
        "filtered_mmsis_count": filter_count,
        "category_breakdown": type_counts,
        "oldest_record": _fmt(min_time),
        "newest_record": _fmt(max_time),
        "incoming_stream_count": in_mem,
        "sync_diff": abs(in_mem - vessel_count),
    }


@router.get("/api/admin/db/tables")
async def get_database_tables():
    """Return list of all database tables with live row counts and storage footprint."""
    pool = database._pool
    sqlite = database._sqlite

    tables = []

    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT 
                        table_name,
                        ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mb,
                        ROUND(data_length / 1024, 1) AS data_kb,
                        ROUND(index_length / 1024, 1) AS index_kb,
                        engine,
                        update_time
                    FROM information_schema.tables
                    WHERE table_schema = DATABASE()
                    ORDER BY (data_length + index_length) DESC
                    """
                )
                meta_rows = await cur.fetchall()

                for row in meta_rows:
                    t_name, total_mb, data_kb, index_kb, engine, update_time = row
                    try:
                        await cur.execute(f"SELECT COUNT(*) FROM `{t_name}`")
                        (exact_count,) = await cur.fetchone()
                    except Exception:
                        exact_count = 0

                    desc = ""
                    if t_name == "ais_vessels":
                        desc = "Latest live AIS vessel telemetry fixes (MMSI, position, speed, metadata)"
                    elif t_name == "ais_track_points":
                        desc = "Historical GPS breadcrumbs & journey trails (lat, lng, speed, timestamp)"
                    elif t_name == "ais_filter_mmsi":
                        desc = "MMSI allow-list filter — only vessels on this list are persisted to DB"
                    elif t_name == "api_snapshots":
                        desc = "Serialized JSON payload cache (satellites, flights, OSINT feeds)"

                    tables.append({
                        "name": t_name,
                        "rows": exact_count,
                        "total_mb": float(total_mb or 0.0),
                        "data_kb": float(data_kb or 0.0),
                        "index_kb": float(index_kb or 0.0),
                        "engine": engine or "InnoDB",
                        "description": desc,
                        "updated_at": update_time.isoformat() if update_time else "Live",
                    })

    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        t_rows = cur.fetchall()
        for (t_name,) in t_rows:
            cur.execute(f"SELECT COUNT(*) FROM '{t_name}'")
            count = cur.fetchone()[0]
            desc = ""
            if t_name == "ais_vessels":
                desc = "Latest live AIS vessel telemetry fixes"
            elif t_name == "ais_track_points":
                desc = "Historical GPS breadcrumbs & trails"
            elif t_name == "ais_filter_mmsi":
                desc = "MMSI allow-list filter — only listed vessels persisted"
            elif t_name == "api_snapshots":
                desc = "JSON snapshots cache"
            tables.append({
                "name": t_name,
                "rows": count,
                "total_mb": 0.0,
                "data_kb": 0.0,
                "index_kb": 0.0,
                "engine": "SQLite",
                "description": desc,
                "updated_at": "Live",
            })
    else:
        raise HTTPException(status_code=503, detail="Database unavailable")

    return {"total_tables": len(tables), "tables": tables}


@router.get("/api/admin/db/tables/{table_name}/schema")
async def get_table_schema(table_name: str):
    """Return the columns and schema definitions of a specific database table."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    columns = []
    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
                    (table_name,)
                )
                if not await cur.fetchone():
                    raise HTTPException(status_code=404, detail=f"Table '{table_name}' does not exist")

                await cur.execute(
                    """
                    SELECT 
                        ordinal_position,
                        column_name,
                        data_type,
                        column_type,
                        is_nullable,
                        column_key,
                        column_default,
                        extra
                    FROM information_schema.columns
                    WHERE table_schema = DATABASE() AND table_name = %s
                    ORDER BY ordinal_position ASC
                    """,
                    (table_name,)
                )
                for r in await cur.fetchall():
                    columns.append({
                        "ordinal": r[0],
                        "name": r[1],
                        "data_type": r[2],
                        "column_type": r[3],
                        "nullable": r[4] == "YES",
                        "key": r[5] or "",
                        "default": str(r[6]) if r[6] is not None else None,
                        "extra": r[7] or "",
                    })
    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute(f"PRAGMA table_info('{table_name}')")
        rows = cur.fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail=f"Table '{table_name}' does not exist")
        for r in rows:
            columns.append({
                "ordinal": r[0] + 1,
                "name": r[1],
                "data_type": r[2].lower(),
                "column_type": r[2],
                "nullable": not bool(r[3]),
                "key": "PRI" if r[5] else "",
                "default": str(r[4]) if r[4] is not None else None,
                "extra": "",
            })

    return {
        "table": table_name,
        "total_columns": len(columns),
        "columns": columns,
    }


def _format_cell(val: Any) -> Any:
    """Format any raw database value into a clean, JSON-serializable representation."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, (bytes, bytearray)):
        try:
            return val.decode("utf-8")
        except Exception:
            return f"<bytes len={len(val)}>"
    if hasattr(val, "as_tuple"):  # Decimal
        return float(val)
    if isinstance(val, float):
        return round(val, 6)
    if isinstance(val, (int, bool, str)):
        return val
    return str(val)


@router.get("/api/admin/db/tables/{table_name}/rows")
async def get_table_rows(
    table_name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100),
    search: str | None = None,
    sort_col: str | None = None,
    sort_dir: str = Query("DESC", pattern="^(?i)(ASC|DESC)$"),
):
    """Generic server-side paginated rows viewer for ANY database table."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    valid_cols = []
    text_cols = []
    primary_key = None
    total_rows = 0
    formatted_rows = []

    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
                    (table_name,)
                )
                if not await cur.fetchone():
                    raise HTTPException(status_code=404, detail=f"Table '{table_name}' does not exist")

                await cur.execute(
                    "SELECT column_name, data_type, column_key FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = %s ORDER BY ordinal_position ASC",
                    (table_name,)
                )
                col_defs = await cur.fetchall()
                for c_name, d_type, c_key in col_defs:
                    valid_cols.append(c_name)
                    if c_key == "PRI" and not primary_key:
                        primary_key = c_name
                    if d_type in ("varchar", "text", "char", "mediumtext", "longtext", "bigint", "int"):
                        text_cols.append(c_name)

                where_clauses = []
                params = []
                if search and text_cols:
                    s_term = f"%{search.strip()}%"
                    search_predicates = [f"`{c}` LIKE %s" for c in text_cols]
                    where_clauses.append(f"({' OR '.join(search_predicates)})")
                    params.extend([s_term] * len(text_cols))

                where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

                count_sql = f"SELECT COUNT(*) FROM `{table_name}`{where_sql}"
                await cur.execute(count_sql, tuple(params))
                (total_rows,) = await cur.fetchone()

                order_col = sort_col if (sort_col and sort_col in valid_cols) else (primary_key or valid_cols[0])
                order_dir = "ASC" if sort_dir.upper() == "ASC" else "DESC"

                offset = (page - 1) * page_size
                query_sql = f"SELECT * FROM `{table_name}`{where_sql} ORDER BY `{order_col}` {order_dir} LIMIT %s OFFSET %s"
                query_params = list(params) + [page_size, offset]

                await cur.execute(query_sql, tuple(query_params))
                raw_rows = await cur.fetchall()

                for r in raw_rows:
                    row_dict = {}
                    for idx, col in enumerate(valid_cols):
                        row_dict[col] = _format_cell(r[idx]) if idx < len(r) else None
                    formatted_rows.append(row_dict)

    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute(f"PRAGMA table_info('{table_name}')")
        col_defs = cur.fetchall()
        if not col_defs:
            raise HTTPException(status_code=404, detail=f"Table '{table_name}' does not exist")
        for r in col_defs:
            c_name = r[1]
            valid_cols.append(c_name)
            if r[5] and not primary_key:
                primary_key = c_name
            text_cols.append(c_name)

        where_clauses = []
        params = []
        if search and text_cols:
            s_term = f"%{search.strip()}%"
            search_predicates = [f'"{c}" LIKE ?' for c in text_cols]
            where_clauses.append(f"({' OR '.join(search_predicates)})")
            params.extend([s_term] * len(text_cols))

        where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        count_sql = f'SELECT COUNT(*) FROM "{table_name}"{where_sql}'
        cur.execute(count_sql, tuple(params))
        total_rows = cur.fetchone()[0]

        order_col = sort_col if (sort_col and sort_col in valid_cols) else (primary_key or valid_cols[0])
        order_dir = "ASC" if sort_dir.upper() == "ASC" else "DESC"

        offset = (page - 1) * page_size
        query_sql = f'SELECT * FROM "{table_name}"{where_sql} ORDER BY "{order_col}" {order_dir} LIMIT ? OFFSET ?'
        query_params = list(params) + [page_size, offset]
        cur.execute(query_sql, tuple(query_params))
        raw_rows = cur.fetchall()

        for r in raw_rows:
            row_dict = {}
            for idx, col in enumerate(valid_cols):
                row_dict[col] = _format_cell(r[idx]) if idx < len(r) else None
            formatted_rows.append(row_dict)

    total_pages = max(1, math.ceil(total_rows / page_size)) if total_rows > 0 else 1

    return {
        "table": table_name,
        "columns": valid_cols,
        "rows": formatted_rows,
        "total": total_rows,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "primary_key": primary_key,
    }


@router.get("/api/admin/stream/packets")
async def get_stream_packets(limit: int = Query(50, ge=5, le=100)):
    """Return the most recently received raw AIS stream packets."""
    return {
        "stats": ais_stream.get_stream_stats(),
        "packets": ais_stream.get_recent_packets(limit=limit),
    }


@router.get("/api/admin/db/vessels")
async def get_stored_vessels(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100),
    type: str | None = None,
    search: str | None = None,
):
    """Server-side paginated query for vessels stored in MySQL."""
    pool = database._pool
    sqlite = database._sqlite

    where_clauses = []
    params = []

    if type and type.lower() != "all":
        where_clauses.append("ship_type = %s")
        params.append(type.lower())

    if search:
        search_term = f"%{search.strip()}%"
        where_clauses.append("(name LIKE %s OR CAST(mmsi AS CHAR) LIKE %s)")
        params.extend([search_term, search_term])

    where_str = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    count_sql = f"SELECT COUNT(*) FROM ais_vessels{where_str}"
    total = 0
    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(count_sql, tuple(params))
                (total,) = await cur.fetchone()
    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute(count_sql.replace("%s", "?"), tuple(params))
        total = cur.fetchone()[0]

    offset = (page - 1) * page_size
    query_sql = (
        f"SELECT mmsi, name, ship_type, lat, lng, speed, heading, destination, "
        f"size_class, last_seen_at, track_point_count, track_distance_km "
        f"FROM ais_vessels{where_str} "
        f"ORDER BY last_seen_at DESC LIMIT %s OFFSET %s"
    )
    query_params = list(params) + [page_size, offset]

    rows = []
    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(query_sql, tuple(query_params))
                rows = await cur.fetchall()
    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute(query_sql.replace("%s", "?"), tuple(query_params))
        rows = cur.fetchall()

    vessels = []
    for r in rows:
        vessels.append({
            "mmsi": r[0],
            "name": r[1] or "Unknown",
            "type": r[2] or "cargo",
            "lat": round(float(r[3]), 4) if r[3] is not None else None,
            "lng": round(float(r[4]), 4) if r[4] is not None else None,
            "speed": round(float(r[5]), 1) if r[5] is not None else 0.0,
            "heading": round(float(r[6]), 0) if r[6] is not None else None,
            "destination": r[7] or "",
            "sizeClass": r[8] or "unknown",
            "lastSeenAt": datetime.fromtimestamp(r[9], tz=timezone.utc).isoformat() if r[9] else None,
            "trackPoints": r[10] or 0,
            "trackDistanceKm": round(float(r[11]), 1) if r[11] is not None else 0.0,
        })

    total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1

    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "vessels": vessels,
    }


@router.post("/api/admin/db/prune")
async def trigger_prune():
    """Manually trigger database cleanup of stale vessels (>1h) and tracks (>24h)."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = time.time()
    vessel_cutoff = now - 3600
    track_cutoff = now - (ais_db.TRACK_RETENTION_HOURS * 3600)

    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM ais_vessels WHERE last_seen_at < %s", (vessel_cutoff,))
                stale_vessels = cur.rowcount
                await cur.execute("DELETE FROM ais_track_points WHERE recorded_at < %s", (track_cutoff,))
                stale_tracks = cur.rowcount
            await conn.commit()
    else:
        cur = sqlite.cursor()
        cur.execute("DELETE FROM ais_vessels WHERE last_seen_at < ?", (vessel_cutoff,))
        stale_vessels = cur.rowcount
        cur.execute("DELETE FROM ais_track_points WHERE recorded_at < ?", (track_cutoff,))
        stale_tracks = cur.rowcount
        sqlite.commit()

    return {
        "status": "success",
        "deleted_stale_vessels": stale_vessels,
        "deleted_old_tracks": stale_tracks,
        "pruned_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/api/admin/db/clear")
async def clear_database_tables():
    """Wipe all stored vessels and track points (requires confirmation)."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM ais_track_points")
                await cur.execute("DELETE FROM ais_vessels")
            await conn.commit()
    else:
        cur = sqlite.cursor()
        cur.execute("DELETE FROM ais_track_points")
        cur.execute("DELETE FROM ais_vessels")
        sqlite.commit()

    async with ais_stream._lock:
        ais_stream._ships.clear()

    return {"status": "success", "message": "AIS vessels and track points cleared successfully."}


# ── Filter MMSI Allow-list API ──────────────────────────────────────────────────

@router.get("/api/admin/filter/mmsis")
async def get_filter_mmsis():
    """Return the active MMSI allow-list and full filter records from ais_filter_mmsi."""
    pool = database._pool
    sqlite = database._sqlite
    records = []
    
    if pool is not None:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT mmsi, alias, source, added_at, active, notes FROM ais_filter_mmsi ORDER BY added_at DESC"
                    )
                    rows = await cur.fetchall()
                    for r in rows:
                        records.append({
                            "mmsi": r[0],
                            "alias": r[1] or "",
                            "source": r[2] or "user",
                            "added_at": r[3],
                            "active": bool(r[4]),
                            "notes": r[5] or "",
                        })
        except Exception as e:
            logger.warning("Error reading MySQL filter records: %s", e)
    elif sqlite is not None:
        try:
            cur = sqlite.cursor()
            cur.execute("SELECT mmsi, alias, source, added_at, active, notes FROM ais_filter_mmsi ORDER BY added_at DESC")
            rows = cur.fetchall()
            for r in rows:
                records.append({
                    "mmsi": r[0],
                    "alias": r[1] or "",
                    "source": r[2] or "user",
                    "added_at": r[3],
                    "active": bool(r[4]),
                    "notes": r[5] or "",
                })
        except Exception as e:
            logger.warning("Error reading SQLite filter records: %s", e)

    mmsis = [r["mmsi"] for r in records if r["active"]] if records else await ais_db.get_filter_mmsis()
    return {"mmsis": mmsis, "records": records}


@router.post("/api/admin/filter/mmsis")
async def add_filter_mmsi_endpoint(request: Request):
    """Add (or refresh) an MMSI in the filter allow-list."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    mmsi = body.get("mmsi")
    if mmsi is None:
        raise HTTPException(status_code=400, detail="mmsi is required")
    await ais_db.add_filter_mmsi(
        mmsi=int(mmsi),
        alias=body.get("alias"),
        source=body.get("source", "user"),
        notes=body.get("notes"),
    )
    return {"status": "success", "mmsi": int(mmsi)}


@router.delete("/api/admin/filter/mmsis/{mmsi}")
async def remove_filter_mmsi_endpoint(mmsi: int):
    """Remove an MMSI from the filter allow-list."""
    await ais_db.remove_filter_mmsi(mmsi)
    return {"status": "success", "mmsi": mmsi}


@router.put("/api/admin/filter/mmsis")
async def set_filter_mmsis_endpoint(request: Request):
    """Replace the entire filter allow-list with the given MMSIs."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    mmsis = body.get("mmsis")
    if not isinstance(mmsis, list):
        raise HTTPException(status_code=400, detail="mmsis must be a list of integers")
    await ais_db.set_filter_mmsis([int(m) for m in mmsis])
    return {"status": "success", "count": len(mmsis)}


# ── Web UI Dashboard ────────────────────────────────────────────────────────────

@router.get("/dashboard", response_class=HTMLResponse)
@router.get("/admin", response_class=HTMLResponse)
async def serve_dashboard():
    """Serve the simplified 3-stage AIS Data Flow UI."""
    return HTMLResponse(content=DASHBOARD_HTML, status_code=200)
