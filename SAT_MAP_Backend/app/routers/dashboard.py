"""
LTmap — Database & Services Control Dashboard

Provides a real-time web UI and administrative API to:
1. Inspect live incoming AIS telemetry stream data ("what data is coming")
2. Inspect database columns and schema definitions ("columns list")
3. Explore database rows with dynamic columns and server-side pagination ("rows")
4. Monitor background ingestion workers (AISStream, Digitraffic Baltic, MySQL Batch Writer)
5. Control & maintain the database (prune stale records, wipe tables, force reconnect)

Accessible at:
  http://localhost:8569/dashboard
  http://localhost:8569/admin
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


# ── Web UI Dashboard ────────────────────────────────────────────────────────────

_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LTmap — Mission Control & Database Center</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛰️</text></svg>">
  <style>
    :root {
      --bg: #070d18;
      --card-bg: #0d1829;
      --card-border: #1e293b;
      --cyan: #00e5ff;
      --cyan-glow: rgba(0, 229, 255, 0.18);
      --emerald: #10b981;
      --amber: #f59e0b;
      --rose: #f43f5e;
      --purple: #a855f7;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      padding: 20px;
      line-height: 1.5;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; color: #fff; }
    .brand span { color: var(--cyan); font-family: monospace; font-size: 13px; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 9999px; font-size: 12px;
      font-weight: 600; text-transform: uppercase; font-family: monospace;
    }
    .pill-green { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .pill-cyan { background: var(--cyan-glow); color: var(--cyan); border: 1px solid rgba(0, 229, 255, 0.4); }
    .pill-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .pulse { animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.85); } }

    /* Top Comparison Banner */
    .compare-banner {
      background: linear-gradient(90deg, #0d1b30 0%, #0c2338 50%, #0d1b30 100%);
      border: 1px solid #1e3a5f;
      border-radius: 12px;
      padding: 16px 22px;
      margin-bottom: 24px;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 20px;
    }
    .compare-side { display: flex; flex-direction: column; gap: 4px; }
    .compare-side.right { text-align: right; }
    .compare-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); font-family: monospace; font-weight: 700; }
    .compare-value { font-size: 30px; font-weight: 900; font-family: monospace; }
    .compare-meta { font-size: 12px; color: #94a3b8; font-family: monospace; }
    .compare-middle { text-align: center; }
    .sync-badge { background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; font-family: monospace; }

    /* Navigation Tabs */
    .tabs-nav {
      display: flex; gap: 8px; border-bottom: 1px solid var(--card-border);
      margin-bottom: 20px; padding-bottom: 8px; flex-wrap: wrap;
    }
    .tab-btn {
      background: transparent; border: none; color: var(--text-muted);
      padding: 8px 18px; border-radius: 8px; cursor: pointer;
      font-size: 13px; font-weight: 700; font-family: monospace;
      transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 8px;
    }
    .tab-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active { background: var(--cyan-glow); color: var(--cyan); border: 1px solid rgba(0, 229, 255, 0.4); }

    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 12px; padding: 18px; position: relative;
    }
    .card-title { font-size: 12px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; margin-bottom: 8px; font-family: monospace; }
    .card-value { font-size: 26px; font-weight: 800; font-family: monospace; }
    .card-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; font-family: monospace; }

    /* Table Styles */
    .table-container {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 12px; overflow: hidden; margin-bottom: 24px;
    }
    .table-header {
      padding: 16px 20px; border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .table-header h2 { font-size: 15px; font-weight: 700; color: #fff; font-family: monospace; display: flex; align-items: center; gap: 8px; }
    
    .toolbar-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    input[type="text"], select {
      background: #070d18; border: 1px solid var(--card-border);
      color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-family: monospace;
      outline: none;
    }
    input[type="text"]:focus, select:focus { border-color: var(--cyan); }
    
    .btn-group { display: flex; gap: 4px; }
    button {
      background: #1e293b; color: #f1f5f9; border: 1px solid #334155;
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: all 0.15s ease; font-family: monospace;
      display: inline-flex; align-items: center; gap: 6px;
    }
    button:hover { background: #334155; }
    button.primary { background: var(--cyan); color: #070d18; border-color: var(--cyan); font-weight: 700; }
    button.primary:hover { background: #22d3ee; }
    button.danger { background: rgba(244, 63, 94, 0.15); color: #fb7185; border-color: rgba(244, 63, 94, 0.3); }
    button.danger:hover { background: rgba(244, 63, 94, 0.25); }

    table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
    th {
      background: #091322; color: var(--text-muted); font-weight: 700;
      padding: 12px 16px; border-bottom: 1px solid var(--card-border);
      text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; font-family: monospace;
      white-space: nowrap;
    }
    td {
      padding: 12px 16px; border-bottom: 1px solid #132238; font-family: monospace;
      color: #cbd5e1; vertical-align: middle; white-space: nowrap;
    }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 10px; font-weight: 700; text-transform: uppercase; font-family: monospace;
    }
    .badge-cargo { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .badge-tanker { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-military { background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }
    .badge-pri { background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid #f59e0b; font-weight: 900; }
    .badge-mul { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #38bdf8; }
    .badge-uni { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #34d399; }
    .badge-source-ais { background: rgba(0, 229, 255, 0.15); color: var(--cyan); border: 1px solid rgba(0, 229, 255, 0.4); }
    .badge-source-digi { background: rgba(168, 85, 247, 0.15); color: var(--purple); border: 1px solid rgba(168, 85, 247, 0.4); }

    /* Pagination Footer */
    .pagination-bar {
      padding: 12px 20px; background: #091322; border-top: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .pagination-info { font-size: 12px; color: var(--text-muted); font-family: monospace; }
    .pagination-controls { display: flex; align-items: center; gap: 8px; }

    /* Modal */
    .modal-backdrop {
      display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 1000;
      align-items: center; justify-content: center;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      background: #0d1829; border: 1px solid var(--cyan); border-radius: 12px;
      width: 90%; max-width: 800px; max-height: 85vh; display: flex; flex-direction: column;
      box-shadow: 0 0 30px rgba(0, 229, 255, 0.2);
    }
    .modal-header {
      padding: 16px 20px; border-bottom: 1px solid var(--card-border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .modal-header h3 { font-size: 15px; color: var(--cyan); font-family: monospace; }
    .modal-body {
      padding: 20px; overflow-y: auto; font-family: monospace; font-size: 12px;
      background: #070d18; color: #a5f3fc;
    }
    .modal-footer {
      padding: 12px 20px; border-top: 1px solid var(--card-border);
      display: flex; justify-content: flex-end; gap: 10px;
    }
  </style>
</head>
<body>

  <!-- Top Navigation & System Status -->
  <header>
    <div class="brand">
      <span style="font-size: 24px;">🛰️</span>
      <div>
        <h1>LTMAP MISSION CONTROL</h1>
        <span>DATABASE INSPECTOR & REAL-TIME AIS TELEMETRY</span>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <div id="ws-indicator" class="pill pill-green">
        <span class="pill-dot pulse"></span>
        <span id="ws-status-text">WS LIVE (STREAMING)</span>
      </div>
      <button class="primary" onclick="refreshAllViews()">🔄 Refresh All</button>
    </div>
  </header>

  <!-- Comparative Ingestion Banner -->
  <div class="compare-banner">
    <div class="compare-side">
      <span class="compare-label">Incoming Stream Telemetry (Live Memory Cache)</span>
      <span id="comp-incoming" class="compare-value" style="color: var(--cyan);">0 vessels</span>
      <span class="compare-meta">Rate: <span id="comp-rate">0 pkts/s</span> | Provider: AISStream + Digitraffic</span>
    </div>
    <div class="compare-middle">
      <div class="sync-badge">⇄ PERSISTING CONTINUOUSLY</div>
      <div id="comp-sync-meta" style="font-size: 11px; color: #94a3b8; font-family: monospace; margin-top: 6px;">Queue: 0 pending | Flush: 2.0s</div>
    </div>
    <div class="compare-side right">
      <span class="compare-label">MySQL Stored Records (Database Table)</span>
      <span id="comp-database" class="compare-value" style="color: #34d399;">0 vessels</span>
      <span class="compare-meta">Total Track Points: <span id="comp-tracks">0</span> breadcrumbs</span>
    </div>
  </div>

  <!-- Main Navigation Tabs -->
  <div class="tabs-nav">
    <button id="tab-btn-incoming" class="tab-btn active" onclick="switchTab('incoming')">
      📡 1. Live Incoming Data ("what data coming")
    </button>
    <button id="tab-btn-schema" class="tab-btn" onclick="switchTab('schema')">
      📋 2. Columns & Schema Inspector ("columns list")
    </button>
    <button id="tab-btn-rows" class="tab-btn" onclick="switchTab('rows')">
      💾 3. Database Rows Explorer ("rows")
    </button>
    <button id="tab-btn-tables" class="tab-btn" onclick="switchTab('tables')">
      🗄️ 4. Tables & Storage Directory
    </button>
    <button id="tab-btn-controls" class="tab-btn" onclick="switchTab('controls')">
      ⚙️ 5. Background Services & DB Controls
    </button>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 1: WHAT DATA IS COMING (LIVE STREAM PACKET INSPECTOR)     -->
  <!-- ============================================================== -->
  <div id="tab-content-incoming">
    <div class="grid-4">
      <div class="card">
        <div class="card-title">Live Ingestion Rate</div>
        <div id="stat-rate" class="card-value" style="color: var(--cyan);">0 pkts/s</div>
        <div class="card-sub">Throughput across active feeds</div>
      </div>
      <div class="card">
        <div class="card-title">Total Packets Received</div>
        <div id="stat-total-pkts" class="card-value" style="color: #38bdf8;">0</div>
        <div class="card-sub">Since ingestion worker started</div>
      </div>
      <div class="card">
        <div class="card-title">Active Vessels in Cache</div>
        <div id="stat-in-cache" class="card-value" style="color: #34d399;">0</div>
        <div class="card-sub">Real-time deduplicated vessels</div>
      </div>
      <div class="card">
        <div class="card-title">Stream Feed Status</div>
        <div id="stat-stream-status" class="card-value" style="color: #a78bfa;">LIVE STREAM</div>
        <div class="card-sub" id="stat-stream-uptime">Auto-refresh: 2.0s</div>
      </div>
    </div>

    <div class="table-container">
      <div class="table-header">
        <h2>
          <span>📡</span> Live Incoming Data Stream (Packets As They Arrive)
          <span id="incoming-live-tag" class="pill pill-green" style="font-size: 10px;">● STREAMING</span>
        </h2>
        <div class="toolbar-actions">
          <input type="text" id="incoming-search" placeholder="Filter by MMSI or Name..." oninput="handleIncomingSearch()">
          <select id="incoming-source" onchange="handleIncomingFilter()">
            <option value="all">All Sources</option>
            <option value="aisstream.io">aisstream.io</option>
            <option value="digitraffic.fi">digitraffic.fi</option>
          </select>
          <button id="btn-stream-pause" onclick="toggleStreamPause()">⏸ Pause Feed</button>
          <button onclick="fetchIncomingPackets()">🔄 Force Pull</button>
        </div>
      </div>
      <div style="overflow-x: auto; max-height: 560px;">
        <table>
          <thead>
            <tr>
              <th># ID</th>
              <th>Arrival Time</th>
              <th>Source</th>
              <th>Message Type</th>
              <th>MMSI</th>
              <th>Vessel Name</th>
              <th>Category</th>
              <th>Position (Lat, Lng)</th>
              <th>Speed (kts)</th>
              <th>Heading</th>
              <th>Destination</th>
              <th>Raw Payload</th>
            </tr>
          </thead>
          <tbody id="incoming-tbody">
            <tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">Connecting to real-time incoming stream...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 2: COLUMNS & SCHEMA INSPECTOR ("columns list")            -->
  <!-- ============================================================== -->
  <div id="tab-content-schema" style="display: none;">
    <div class="table-container">
      <div class="table-header">
        <h2>
          <span>📋</span> Database Schema & Columns List
        </h2>
        <div class="toolbar-actions">
          <label style="font-size: 12px; color: var(--text-muted); font-family: monospace;">Select Table:</label>
          <select id="schema-table-select" onchange="onSchemaTableChange()">
            <option value="ais_vessels">ais_vessels</option>
            <option value="ais_track_points">ais_track_points</option>
            <option value="api_snapshots">api_snapshots</option>
          </select>
          <button onclick="loadTableSchema()">🔄 Refresh Columns</button>
        </div>
      </div>

      <div style="padding: 16px 20px; background: #091322; border-bottom: 1px solid var(--card-border); display: flex; gap: 24px; flex-wrap: wrap;">
        <div><span style="color: var(--text-muted); font-size: 11px;">SELECTED TABLE:</span> <strong id="schema-meta-table" style="color: var(--cyan); font-family: monospace;">ais_vessels</strong></div>
        <div><span style="color: var(--text-muted); font-size: 11px;">TOTAL COLUMNS:</span> <strong id="schema-meta-cols" style="color: #34d399; font-family: monospace;">0</strong></div>
        <div><span style="color: var(--text-muted); font-size: 11px;">TOTAL ROWS:</span> <strong id="schema-meta-rows" style="color: #38bdf8; font-family: monospace;">0</strong></div>
        <div><span style="color: var(--text-muted); font-size: 11px;">STORAGE FOOTPRINT:</span> <strong id="schema-meta-size" style="color: #f59e0b; font-family: monospace;">0 MB</strong></div>
      </div>

      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th style="width: 50px;"># Ord</th>
              <th>Column Name</th>
              <th>Data Type</th>
              <th>Full Column Type</th>
              <th>Nullable</th>
              <th>Key / Index</th>
              <th>Default Value</th>
              <th>Extra Attributes</th>
            </tr>
          </thead>
          <tbody id="schema-tbody">
            <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">Loading column schema...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 3: DATABASE ROWS EXPLORER ("rows")                         -->
  <!-- ============================================================== -->
  <div id="tab-content-rows" style="display: none;">
    <div class="table-container">
      <div class="table-header">
        <h2>
          <span>💾</span> Generic Table Rows Explorer (Server-Side Paginated)
        </h2>
        <div class="toolbar-actions">
          <label style="font-size: 12px; color: var(--text-muted); font-family: monospace;">Table:</label>
          <select id="rows-table-select" onchange="onRowsTableChange()">
            <option value="ais_vessels">ais_vessels</option>
            <option value="ais_track_points">ais_track_points</option>
            <option value="api_snapshots">api_snapshots</option>
          </select>
          <input type="text" id="rows-search" placeholder="Search in table..." oninput="handleRowsSearch()">
          <select id="rows-page-size" onchange="changeRowsPageSize()">
            <option value="15">15 rows/page</option>
            <option value="25" selected>25 rows/page</option>
            <option value="50">50 rows/page</option>
            <option value="100">100 rows/page</option>
          </select>
          <button onclick="fetchRowsPage(rowsCurrentPage)">🔄 Reload Rows</button>
        </div>
      </div>

      <div style="overflow-x: auto; max-height: 580px;">
        <table>
          <thead id="rows-thead">
            <tr><th>Loading columns...</th></tr>
          </thead>
          <tbody id="rows-tbody">
            <tr><td style="text-align: center; color: var(--text-muted); padding: 30px;">Fetching records...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination Toolbar -->
      <div class="pagination-bar">
        <div class="pagination-info">
          Showing <span id="rows-page-start" style="color: #fff; font-weight: 700;">0</span> to 
          <span id="rows-page-end" style="color: #fff; font-weight: 700;">0</span> of 
          <span id="rows-page-total" style="color: var(--cyan); font-weight: 800;">0</span> records
        </div>
        <div class="pagination-controls">
          <button onclick="changeRowsPage('first')">« First</button>
          <button onclick="changeRowsPage('prev')">‹ Prev</button>
          <span id="rows-page-display" style="font-size: 12px; font-weight: 700; color: #fff; font-family: monospace; padding: 0 8px;">Page 1 of 1</span>
          <button onclick="changeRowsPage('next')">Next ›</button>
          <button onclick="changeRowsPage('last')">Last »</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 4: TABLES & STORAGE DIRECTORY                              -->
  <!-- ============================================================== -->
  <div id="tab-content-tables" style="display: none;">
    <div class="table-container">
      <div class="table-header">
        <h2><span>🗄️</span> MySQL Database Tables & Disk Storage Footprint</h2>
        <div class="toolbar-actions">
          <button onclick="fetchTablesList()">🔄 Refresh Storage Stats</button>
        </div>
      </div>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Table Name</th>
              <th>Live Row Count</th>
              <th>Data Size</th>
              <th>Index Size</th>
              <th>Total Disk</th>
              <th>Engine</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="tables-tbody">
            <tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">Loading tables...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ============================================================== -->
  <!-- TAB 5: SERVICES & DATABASE CONTROLS                            -->
  <!-- ============================================================== -->
  <div id="tab-content-controls" style="display: none;">
    <div class="grid-4">
      <div class="card">
        <div class="card-title">AISStream Worker</div>
        <div id="svc-ais" class="card-value" style="color: #34d399;">RUNNING</div>
        <div class="card-sub">Global Maritime WebSocket feed</div>
      </div>
      <div class="card">
        <div class="card-title">Digitraffic Worker</div>
        <div id="svc-digi" class="card-value" style="color: #38bdf8;">CONNECTED</div>
        <div class="card-sub">Finnish Baltic MQTT over TLS</div>
      </div>
      <div class="card">
        <div class="card-title">MySQL Batch Writer</div>
        <div id="svc-worker" class="card-value" style="color: #a78bfa;">RUNNING</div>
        <div class="card-sub">Batched 2.0s UPSERT queue</div>
      </div>
      <div class="card">
        <div class="card-title">Database Engine</div>
        <div id="svc-engine" class="card-value" style="color: #f59e0b;">MySQL 8.4</div>
        <div class="card-sub">Host: mysql:3306</div>
      </div>
    </div>

    <div class="table-container" style="padding: 24px;">
      <h2 style="font-size: 16px; font-weight: 700; color: #fff; font-family: monospace; margin-bottom: 16px;">
        ⚙️ Database Maintenance & Operations
      </h2>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px;">
        Execute routine hygiene operations or reset telemetry records directly on the live database.
      </p>
      <div style="display: flex; gap: 16px; flex-wrap: wrap;">
        <button class="primary" style="padding: 10px 20px; font-size: 13px;" onclick="pruneDatabase()">
          🧹 Prune Stale Telemetry (&gt;24h)
        </button>
        <button class="danger" style="padding: 10px 20px; font-size: 13px;" onclick="clearDatabase()">
          ⚠️ Wipe All AIS Telemetry
        </button>
      </div>
    </div>
  </div>

  <!-- Raw Payload Modal -->
  <div id="json-modal" class="modal-backdrop">
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="modal-title">Raw Incoming Data Packet</h3>
        <button onclick="closeModal()">✕</button>
      </div>
      <div id="modal-content" class="modal-body">
        <pre id="modal-pre"></pre>
      </div>
      <div class="modal-footer">
        <button onclick="copyModalJson()">📋 Copy JSON</button>
        <button class="primary" onclick="closeModal()">Close</button>
      </div>
    </div>
  </div>

  <script>
    // Global State
    let activeTab = 'incoming';
    let streamPaused = false;
    let streamPollInterval = null;
    let tablesDirectory = [];

    // ==========================================
    // TAB SWITCHING
    // ==========================================
    function switchTab(tabId) {
      activeTab = tabId;
      ['incoming', 'schema', 'rows', 'tables', 'controls'].forEach(id => {
        const btn = document.getElementById(`tab-btn-${id}`);
        const content = document.getElementById(`tab-content-${id}`);
        if (btn) btn.className = (id === tabId) ? 'tab-btn active' : 'tab-btn';
        if (content) content.style.display = (id === tabId) ? 'block' : 'none';
      });

      if (tabId === 'schema') loadTableSchema();
      if (tabId === 'rows') fetchRowsPage(1);
      if (tabId === 'tables') fetchTablesList();
    }

    function refreshAllViews() {
      fetchGlobalMetrics();
      if (activeTab === 'incoming') fetchIncomingPackets();
      if (activeTab === 'schema') loadTableSchema();
      if (activeTab === 'rows') fetchRowsPage(rowsCurrentPage);
      if (activeTab === 'tables') fetchTablesList();
    }

    // ==========================================
    // TAB 1: LIVE INCOMING DATA ("what data coming")
    // ==========================================
    let incomingPackets = [];
    let incomingFiltered = [];
    let incomingSearchTerm = '';
    let incomingSourceFilter = 'all';

    async function fetchIncomingPackets() {
      if (streamPaused && activeTab === 'incoming') return;
      try {
        const res = await fetch('/api/admin/stream/packets?limit=50');
        if (!res.ok) return;
        const data = await res.json();

        // Update stats
        if (data.stats) {
          document.getElementById('stat-rate').innerText = `${data.stats.rate_per_sec} pkts/s`;
          document.getElementById('stat-total-pkts').innerText = data.stats.total_packets.toLocaleString();
          document.getElementById('stat-in-cache').innerText = data.stats.vessels_in_cache.toLocaleString();
          document.getElementById('comp-rate').innerText = `${data.stats.rate_per_sec} pkts/s`;
        }

        incomingPackets = data.packets || [];
        applyIncomingFilter();
      } catch (e) {
        console.error("Failed to fetch incoming packets", e);
      }
    }

    function toggleStreamPause() {
      streamPaused = !streamPaused;
      const btn = document.getElementById('btn-stream-pause');
      const tag = document.getElementById('incoming-live-tag');
      if (streamPaused) {
        btn.innerText = '▶ Resume Feed';
        btn.className = 'primary';
        tag.className = 'pill pill-cyan';
        tag.innerText = '⏸ PAUSED';
      } else {
        btn.innerText = '⏸ Pause Feed';
        btn.className = '';
        tag.className = 'pill pill-green';
        tag.innerText = '● STREAMING';
        fetchIncomingPackets();
      }
    }

    function handleIncomingSearch() {
      incomingSearchTerm = document.getElementById('incoming-search').value.trim().toLowerCase();
      applyIncomingFilter();
    }

    function handleIncomingFilter() {
      incomingSourceFilter = document.getElementById('incoming-source').value;
      applyIncomingFilter();
    }

    function applyIncomingFilter() {
      let filtered = incomingPackets;
      if (incomingSourceFilter !== 'all') {
        filtered = filtered.filter(p => p.source === incomingSourceFilter);
      }
      if (incomingSearchTerm) {
        filtered = filtered.filter(p => 
          String(p.mmsi).includes(incomingSearchTerm) || 
          (p.name || '').toLowerCase().includes(incomingSearchTerm)
        );
      }
      incomingFiltered = filtered;
      renderIncomingTable();
    }

    function renderIncomingTable() {
      const tbody = document.getElementById('incoming-tbody');
      if (!incomingFiltered || incomingFiltered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">No incoming stream packets matching filter.</td></tr>';
        return;
      }

      tbody.innerHTML = incomingFiltered.map((p, idx) => {
        const srcClass = p.source === 'aisstream.io' ? 'badge-source-ais' : 'badge-source-digi';
        const typeClass = (p.type === 'tanker') ? 'badge-tanker' : (p.type === 'military') ? 'badge-military' : 'badge-cargo';
        const latStr = p.lat != null ? p.lat.toFixed(4) + '°' : '—';
        const lngStr = p.lng != null ? p.lng.toFixed(4) + '°' : '—';
        const speedStr = p.speed != null ? Number(p.speed).toFixed(1) + ' kts' : '0.0 kts';
        const headStr = p.heading != null ? Math.round(p.heading) + '°' : '—';
        
        // Escape json payload for modal inspection
        const jsonSafe = encodeURIComponent(JSON.stringify(p.raw_payload || p, null, 2));

        return `
          <tr>
            <td style="color: #64748b;">#${p.id || (idx + 1)}</td>
            <td style="color: #38bdf8; font-weight: 700;">${p.time}</td>
            <td><span class="badge ${srcClass}">${p.source}</span></td>
            <td><span class="badge" style="background: rgba(255,255,255,0.08); color: #fff;">${p.msg_type}</span></td>
            <td style="color: var(--cyan); font-weight: 700;">${p.mmsi}</td>
            <td style="color: #fff; font-weight: 600;">${p.name || 'UNKNOWN'}</td>
            <td><span class="badge ${typeClass}">${p.type || 'cargo'}</span></td>
            <td>${latStr}, ${lngStr}</td>
            <td style="color: #34d399;">${speedStr}</td>
            <td>${headStr}</td>
            <td style="color: #94a3b8; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.destination || '—'}</td>
            <td>
              <button onclick="viewRawPayload('Packet #${p.id} (MMSI ${p.mmsi})', '${jsonSafe}')" style="padding: 3px 8px; font-size: 11px;">
                { } Inspect
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // ==========================================
    // TAB 2: COLUMNS & SCHEMA INSPECTOR ("columns list")
    // ==========================================
    async function loadTableSchema() {
      const select = document.getElementById('schema-table-select');
      const tableName = select.value;
      document.getElementById('schema-meta-table').innerText = tableName;

      // Update row count & disk size from tables directory
      const found = tablesDirectory.find(t => t.name === tableName);
      if (found) {
        document.getElementById('schema-meta-rows').innerText = found.rows.toLocaleString();
        document.getElementById('schema-meta-size').innerText = `${found.total_mb} MB (${found.data_kb.toLocaleString()} KB data)`;
      }

      try {
        const res = await fetch(`/api/admin/db/tables/${tableName}/schema`);
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('schema-meta-cols').innerText = data.total_columns;

        const tbody = document.getElementById('schema-tbody');
        tbody.innerHTML = data.columns.map(c => {
          let keyBadge = '—';
          if (c.key === 'PRI') keyBadge = '<span class="badge badge-pri">PRI KEY</span>';
          else if (c.key === 'MUL') keyBadge = '<span class="badge badge-mul">INDEX</span>';
          else if (c.key === 'UNI') keyBadge = '<span class="badge badge-uni">UNIQUE</span>';

          const nullBadge = c.nullable 
            ? '<span style="color: #94a3b8;">YES</span>' 
            : '<strong style="color: #fb7185;">NO</strong>';

          return `
            <tr>
              <td style="color: #64748b;">${c.ordinal}</td>
              <td style="color: var(--cyan); font-weight: 700; font-size: 13px;">${c.name}</td>
              <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">${c.data_type}</span></td>
              <td style="color: #cbd5e1;">${c.column_type}</td>
              <td>${nullBadge}</td>
              <td>${keyBadge}</td>
              <td style="color: #a78bfa;">${c.default != null ? c.default : '<span style="color: #64748b;">NULL</span>'}</td>
              <td style="color: #f59e0b;">${c.extra || '—'}</td>
            </tr>
          `;
        }).join('');
      } catch (e) {
        console.error("Failed to load schema", e);
      }
    }

    function onSchemaTableChange() {
      loadTableSchema();
    }

    // ==========================================
    // TAB 3: DATABASE ROWS EXPLORER ("rows")
    // ==========================================
    let rowsCurrentPage = 1;
    let rowsPageSize = 25;
    let rowsSearchQuery = '';
    let rowsSearchTimeout = null;

    function onRowsTableChange() {
      rowsCurrentPage = 1;
      fetchRowsPage(1);
    }

    function handleRowsSearch() {
      clearTimeout(rowsSearchTimeout);
      rowsSearchTimeout = setTimeout(() => {
        rowsSearchQuery = document.getElementById('rows-search').value.trim();
        fetchRowsPage(1);
      }, 300);
    }

    function changeRowsPageSize() {
      rowsPageSize = parseInt(document.getElementById('rows-page-size').value, 10);
      fetchRowsPage(1);
    }

    async function fetchRowsPage(page) {
      rowsCurrentPage = page;
      const tableName = document.getElementById('rows-table-select').value;
      const params = new URLSearchParams({
        page: String(rowsCurrentPage),
        page_size: String(rowsPageSize),
      });
      if (rowsSearchQuery) params.set('search', rowsSearchQuery);

      try {
        const res = await fetch(`/api/admin/db/tables/${tableName}/rows?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();

        // 1. Render dynamic table headers
        const thead = document.getElementById('rows-thead');
        thead.innerHTML = `<tr>${data.columns.map(col => `<th>${col}</th>`).join('')}</tr>`;

        // 2. Render dynamic table rows
        const tbody = document.getElementById('rows-tbody');
        if (!data.rows || data.rows.length === 0) {
          tbody.innerHTML = `<tr><td colspan="${data.columns.length}" style="text-align: center; color: var(--text-muted); padding: 30px;">No rows found in table '${tableName}'.</td></tr>`;
        } else {
          tbody.innerHTML = data.rows.map(row => {
            return `<tr>${data.columns.map(col => {
              const val = row[col];
              if (val === null) return '<td style="color: #64748b;">NULL</td>';
              
              // If value is long text or JSON (like snapshots)
              if (typeof val === 'string' && val.length > 55) {
                const encoded = encodeURIComponent(val);
                return `<td><button onclick="viewRawPayload('Column: ${col}', '${encoded}')" style="padding: 2px 6px; font-size: 10px;">{ } View (${val.length} chars)</button></td>`;
              }
              if (col === data.primary_key || col === 'mmsi' || col === 'id') {
                return `<td style="color: var(--cyan); font-weight: 700;">${val}</td>`;
              }
              if (typeof val === 'number') {
                return `<td style="color: #34d399;">${val}</td>`;
              }
              return `<td>${val}</td>`;
            }).join('')}</tr>`;
          }).join('');
        }

        // 3. Update pagination indicators
        const startIdx = (data.page - 1) * data.page_size;
        const endIdx = Math.min(data.total, startIdx + data.rows.length);
        document.getElementById('rows-page-start').innerText = data.total > 0 ? (startIdx + 1).toLocaleString() : '0';
        document.getElementById('rows-page-end').innerText = endIdx.toLocaleString();
        document.getElementById('rows-page-total').innerText = data.total.toLocaleString();
        document.getElementById('rows-page-display').innerText = `Page ${data.page} of ${data.total_pages}`;
      } catch (e) {
        console.error("Failed to load rows", e);
      }
    }

    function changeRowsPage(action) {
      if (action === 'first') fetchRowsPage(1);
      else if (action === 'prev') fetchRowsPage(Math.max(1, rowsCurrentPage - 1));
      else if (action === 'next') fetchRowsPage(rowsCurrentPage + 1);
      else if (action === 'last') fetchRowsPage(99999);
    }

    // ==========================================
    // TAB 4: TABLES DIRECTORY
    // ==========================================
    async function fetchTablesList() {
      try {
        const res = await fetch('/api/admin/db/tables');
        if (!res.ok) return;
        const data = await res.json();
        tablesDirectory = data.tables || [];

        // Populate table selectors in Tab 2 and Tab 3
        const schemaSelect = document.getElementById('schema-table-select');
        const rowsSelect = document.getElementById('rows-table-select');
        
        const currentSchemaVal = schemaSelect.value;
        const currentRowsVal = rowsSelect.value;

        schemaSelect.innerHTML = tablesDirectory.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
        rowsSelect.innerHTML = tablesDirectory.map(t => `<option value="${t.name}">${t.name}</option>`).join('');

        if (currentSchemaVal) schemaSelect.value = currentSchemaVal;
        if (currentRowsVal) rowsSelect.value = currentRowsVal;

        const tbody = document.getElementById('tables-tbody');
        tbody.innerHTML = tablesDirectory.map(t => `
          <tr>
            <td style="color: var(--cyan); font-weight: 800; font-size: 13px;">${t.name}</td>
            <td style="color: #34d399; font-weight: 700; font-size: 13px;">${t.rows.toLocaleString()} rows</td>
            <td>${t.data_kb.toLocaleString()} KB</td>
            <td>${t.index_kb.toLocaleString()} KB</td>
            <td style="color: #fff; font-weight: 700;">${t.total_mb} MB</td>
            <td><span class="badge" style="background: rgba(255,255,255,0.1); color: #fff;">${t.engine}</span></td>
            <td style="color: #94a3b8; font-size: 11px;">${t.description}</td>
            <td>
              <div class="btn-group">
                <button onclick="jumpToSchema('${t.name}')" style="padding: 3px 8px; font-size: 11px;">📋 Columns</button>
                <button class="primary" onclick="jumpToRows('${t.name}')" style="padding: 3px 8px; font-size: 11px;">💾 Rows</button>
              </div>
            </td>
          </tr>
        `).join('');
      } catch (e) {
        console.error("Failed to load tables", e);
      }
    }

    function jumpToSchema(tableName) {
      document.getElementById('schema-table-select').value = tableName;
      switchTab('schema');
    }

    function jumpToRows(tableName) {
      document.getElementById('rows-table-select').value = tableName;
      switchTab('rows');
    }

    // ==========================================
    // GLOBAL METRICS & AUTO-SYNC
    // ==========================================
    async function fetchGlobalMetrics() {
      try {
        const [statsRes, statusRes] = await Promise.all([
          fetch('/api/admin/db/stats'),
          fetch('/api/admin/status')
        ]);

        if (statsRes.ok) {
          const stats = await statsRes.json();
          document.getElementById('comp-database').innerText = `${stats.vessels_count.toLocaleString()} vessels`;
          document.getElementById('comp-incoming').innerText = `${stats.incoming_stream_count.toLocaleString()} vessels`;
          document.getElementById('comp-tracks').innerText = stats.track_points_count.toLocaleString();
        }

        if (statusRes.ok) {
          const status = await statusRes.json();
          document.getElementById('comp-sync-meta').innerText = 
            `Queue: ${status.services.ais_db_worker.pending_queue_size} pending | Flush: 2.0s`;
          document.getElementById('svc-ais').innerText = status.services.ais_stream.status;
          document.getElementById('svc-digi').innerText = status.services.digitraffic.status;
          document.getElementById('svc-worker').innerText = status.services.ais_db_worker.status;
        }
      } catch (e) {}
    }

    // ==========================================
    // RAW PAYLOAD MODAL
    // ==========================================
    function viewRawPayload(title, encodedJson) {
      const decoded = decodeURIComponent(encodedJson);
      document.getElementById('modal-title').innerText = title;
      try {
        const obj = JSON.parse(decoded);
        document.getElementById('modal-pre').innerText = JSON.stringify(obj, null, 2);
      } catch (e) {
        document.getElementById('modal-pre').innerText = decoded;
      }
      document.getElementById('json-modal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('json-modal').classList.remove('open');
    }

    function copyModalJson() {
      const text = document.getElementById('modal-pre').innerText;
      navigator.clipboard.writeText(text).then(() => {
        alert("Copied to clipboard!");
      });
    }

    // ==========================================
    // DATABASE CONTROLS (PRUNE & CLEAR)
    // ==========================================
    async function pruneDatabase() {
      if (!confirm("Delete vessels older than 1 hour and track points older than 24 hours?")) return;
      try {
        const res = await fetch('/api/admin/db/prune', { method: 'POST' });
        const data = await res.json();
        alert(`Prune Complete: Removed ${data.deleted_stale_vessels} stale vessels and ${data.deleted_old_tracks} old tracks.`);
        fetchGlobalMetrics();
        if (activeTab === 'rows') fetchRowsPage(1);
      } catch (e) {
        alert("Prune failed: " + e.message);
      }
    }

    async function clearDatabase() {
      if (!confirm("WARNING: Are you sure you want to wipe all stored AIS vessels and track points?")) return;
      try {
        const res = await fetch('/api/admin/db/clear', { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        fetchGlobalMetrics();
        if (activeTab === 'rows') fetchRowsPage(1);
      } catch (e) {
        alert("Clear failed: " + e.message);
      }
    }

    // ==========================================
    // STARTUP TIMERS & WEBSOCKET
    // ==========================================
    fetchTablesList();
    fetchGlobalMetrics();
    fetchIncomingPackets();

    // Auto-update timers
    setInterval(fetchGlobalMetrics, 3000);
    setInterval(fetchIncomingPackets, 2000); // Polls live incoming packets every 2s
  </script>
</body>
</html>
"""


@router.get("/dashboard", response_class=HTMLResponse)
@router.get("/admin", response_class=HTMLResponse)
async def serve_dashboard():
    """Serve the Mission Control and Database UI."""
    return HTMLResponse(content=_DASHBOARD_HTML, status_code=200)
