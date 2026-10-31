"""
LTmap — AIS Database Persistence

Continuously stores AIS vessel data received from aisstream.io into MySQL (or SQLite).
On startup, restores the in-memory ship dict from the database so vessels
survive backend restarts.

Tables created automatically:
  ais_vessels        — latest state per MMSI (upserted on every position update)
  ais_track_points   — historical breadcrumb trail (append-only, auto-pruned)
"""

import asyncio
import json
import logging
import time
import warnings
from typing import Any

# Suppress harmless MySQL "Table already exists" notices from CREATE TABLE IF NOT EXISTS
warnings.filterwarnings("ignore", message=".*already exists.*")

from .. import database
from ..config import settings

logger = logging.getLogger("ltmap.ais_db")

# ── Configuration ───────────────────────────────────────────────────────────────
BATCH_FLUSH_INTERVAL = 2.0      # seconds between DB writes (batched)
TRACK_RETENTION_HOURS = 24      # auto-prune track points older than this
TRACK_PRUNE_INTERVAL = 600      # seconds between prune runs (10 min)
MAX_BATCH_SIZE = 500            # max vessels per batch upsert

# ── Internal state ──────────────────────────────────────────────────────────────
_pending: dict[int, dict[str, Any]] = {}   # mmsi → ship dict awaiting flush
_pending_tracks: list[tuple] = []          # (mmsi, lat, lng, speed, heading, timestamp) rows
_lock = asyncio.Lock()
_flush_task: asyncio.Task | None = None
_prune_task: asyncio.Task | None = None
_running = False


# ── Table DDL ───────────────────────────────────────────────────────────────────

_CREATE_VESSELS_TABLE = """
CREATE TABLE IF NOT EXISTS ais_vessels (
    mmsi           BIGINT         PRIMARY KEY,
    name           VARCHAR(255)   DEFAULT NULL,
    ship_type      VARCHAR(50)    DEFAULT 'cargo',
    lat            DOUBLE         NOT NULL,
    lng            DOUBLE         NOT NULL,
    speed          DOUBLE         DEFAULT NULL,
    heading        DOUBLE         DEFAULT NULL,
    destination    VARCHAR(255)   DEFAULT NULL,
    ais_type_code  INT            DEFAULT NULL,
    length_m       DOUBLE         DEFAULT NULL,
    width_m        DOUBLE         DEFAULT NULL,
    draught        DOUBLE         DEFAULT NULL,
    size_class     VARCHAR(20)    DEFAULT 'unknown',
    size_source    VARCHAR(30)    DEFAULT 'unreported',
    first_seen_lat DOUBLE         DEFAULT NULL,
    first_seen_lng DOUBLE         DEFAULT NULL,
    first_seen_at  DOUBLE         DEFAULT NULL,
    last_seen_at   DOUBLE         NOT NULL,
    track_distance_km  DOUBLE     DEFAULT 0,
    track_point_count  INT        DEFAULT 0,
    extra_json     TEXT           DEFAULT NULL,
    updated_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (ship_type),
    INDEX idx_updated (updated_at),
    INDEX idx_position (lat, lng)
) ENGINE=InnoDB CHARACTER SET utf8mb4
"""

_CREATE_TRACKS_TABLE = """
CREATE TABLE IF NOT EXISTS ais_track_points (
    id         BIGINT       AUTO_INCREMENT PRIMARY KEY,
    mmsi       BIGINT       NOT NULL,
    lat        DOUBLE       NOT NULL,
    lng        DOUBLE       NOT NULL,
    speed      DOUBLE       DEFAULT NULL,
    heading    DOUBLE       DEFAULT NULL,
    recorded_at DOUBLE      NOT NULL,
    INDEX idx_mmsi_time (mmsi, recorded_at),
    INDEX idx_recorded (recorded_at)
) ENGINE=InnoDB
"""

_SQLITE_VESSELS_TABLE = """
CREATE TABLE IF NOT EXISTS ais_vessels (
    mmsi           INTEGER PRIMARY KEY,
    name           TEXT,
    ship_type      TEXT DEFAULT 'cargo',
    lat            REAL NOT NULL,
    lng            REAL NOT NULL,
    speed          REAL,
    heading        REAL,
    destination    TEXT,
    ais_type_code  INTEGER,
    length_m       REAL,
    width_m        REAL,
    draught        REAL,
    size_class     TEXT DEFAULT 'unknown',
    size_source    TEXT DEFAULT 'unreported',
    first_seen_lat REAL,
    first_seen_lng REAL,
    first_seen_at  REAL,
    last_seen_at   REAL NOT NULL,
    track_distance_km REAL DEFAULT 0,
    track_point_count INTEGER DEFAULT 0,
    extra_json     TEXT,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

_SQLITE_TRACKS_TABLE = """
CREATE TABLE IF NOT EXISTS ais_track_points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mmsi        INTEGER NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    speed       REAL,
    heading     REAL,
    recorded_at REAL NOT NULL
)
"""


# ── Startup / Shutdown ──────────────────────────────────────────────────────────

async def init_tables() -> None:
    """Create AIS tables if they don't exist (called during app startup)."""
    pool = database._pool
    sqlite = database._sqlite

    if pool is not None:
        try:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(_CREATE_VESSELS_TABLE)
                    await cur.execute(_CREATE_TRACKS_TABLE)
                await conn.commit()
            logger.info("AIS MySQL database tables ready")
        except Exception:
            logger.exception("Failed to create AIS MySQL tables")
    elif sqlite is not None:
        try:
            sqlite.execute(_SQLITE_VESSELS_TABLE)
            sqlite.execute(_SQLITE_TRACKS_TABLE)
            sqlite.commit()
            logger.info("AIS SQLite tables ready")
        except Exception:
            logger.exception("Failed to create AIS SQLite tables")
    else:
        logger.warning("No database connected — AIS DB persistence disabled")


async def start() -> None:
    """Start the background flush and prune loops."""
    global _flush_task, _prune_task, _running
    if database._pool is None and database._sqlite is None:
        return
    _running = True
    if _flush_task is None or _flush_task.done():
        _flush_task = asyncio.create_task(_flush_loop(), name="ais-db-flush")
    if _prune_task is None or _prune_task.done():
        _prune_task = asyncio.create_task(_prune_loop(), name="ais-db-prune")
    logger.info("AIS DB persistence background tasks started")


async def stop() -> None:
    """Stop background tasks and flush remaining data."""
    global _running, _flush_task, _prune_task
    _running = False
    await _flush_pending()
    for task in (_flush_task, _prune_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    _flush_task = None
    _prune_task = None
    logger.info("AIS DB persistence stopped")


# ── Public API: queue ship updates ──────────────────────────────────────────────

async def queue_ship_update(mmsi: int, ship: dict[str, Any]) -> None:
    """Queue a ship record for batch DB upsert. Called from ais_stream on every update."""
    if database._pool is None and database._sqlite is None:
        return
    async with _lock:
        _pending[mmsi] = ship
        lat, lng = ship.get("lat"), ship.get("lng")
        if lat is not None and lng is not None:
            _pending_tracks.append((
                mmsi,
                float(lat),
                float(lng),
                ship.get("speed"),
                ship.get("heading"),
                time.time(),
            ))


def pending_count() -> int:
    """Return the number of vessel records currently queued for database flush."""
    return len(_pending)


async def load_ships_from_db() -> dict[int, dict[str, Any]]:
    """Load all vessels from the database (called on startup to restore state)."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        return {}

    ships: dict[int, dict[str, Any]] = {}
    cutoff = time.time() - 3600  # only vessels seen within the last 60 minutes
    query = (
        "SELECT mmsi, name, ship_type, lat, lng, speed, heading, destination, "
        "ais_type_code, length_m, width_m, draught, size_class, size_source, "
        "first_seen_lat, first_seen_lng, first_seen_at, last_seen_at, "
        "track_distance_km, track_point_count, extra_json "
        "FROM ais_vessels WHERE last_seen_at > %s"
    )

    try:
        rows = []
        if pool is not None:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(query, (cutoff,))
                    rows = await cur.fetchall()
        elif sqlite is not None:
            cur = sqlite.cursor()
            cur.execute(query.replace("%s", "?"), (cutoff,))
            rows = cur.fetchall()

        for row in rows:
            (mmsi, name, ship_type, lat, lng, speed, heading, destination,
             ais_type_code, length_m, width_m, draught, size_class, size_source,
             first_seen_lat, first_seen_lng, first_seen_at, last_seen_at,
             track_distance_km, track_point_count, extra_json) = row

            ship: dict[str, Any] = {
                "id": mmsi,
                "mmsi": mmsi,
                "name": name,
                "type": ship_type or "cargo",
                "lat": lat,
                "lng": lng,
                "speed": speed,
                "heading": heading,
                "destination": destination,
                "aisTypeCode": ais_type_code,
                "length": length_m,
                "width": width_m,
                "draught": draught,
                "sizeClass": size_class or "unknown",
                "sizeSource": size_source or "unreported",
                "firstSeenLat": first_seen_lat,
                "firstSeenLng": first_seen_lng,
                "firstSeenAt": first_seen_at,
                "lastSeenAt": last_seen_at,
                "timestamp": last_seen_at,
                "trackDistanceKm": track_distance_km or 0.0,
                "trackPointCount": track_point_count or 0,
                "track": [],
            }

            if extra_json:
                try:
                    extra = json.loads(extra_json) if isinstance(extra_json, str) else extra_json
                    ship.update({k: v for k, v in extra.items() if k not in ship})
                except Exception:
                    pass

            ships[mmsi] = ship

        # Load recent track points
        if ships:
            track_query = (
                "SELECT mmsi, lat, lng, speed, recorded_at "
                "FROM ais_track_points WHERE recorded_at > %s "
                "ORDER BY mmsi, recorded_at"
            )
            track_rows = []
            if pool is not None:
                async with pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute(track_query, (cutoff,))
                        track_rows = await cur.fetchall()
            elif sqlite is not None:
                cur = sqlite.cursor()
                cur.execute(track_query.replace("%s", "?"), (cutoff,))
                track_rows = cur.fetchall()

            for mmsi_val, t_lat, t_lng, t_speed, t_time in track_rows:
                if mmsi_val in ships:
                    ships[mmsi_val]["track"].append({
                        "lat": t_lat,
                        "lng": t_lng,
                        "speed": t_speed,
                        "timestamp": t_time,
                    })

        logger.info("Restored %d vessels from database", len(ships))
    except Exception:
        logger.exception("Failed to load vessels from database")
    return ships


# ── Background loops ────────────────────────────────────────────────────────────

async def _flush_loop() -> None:
    """Periodically flush pending ship updates to MySQL."""
    while _running:
        try:
            await asyncio.sleep(BATCH_FLUSH_INTERVAL)
            await _flush_pending()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("AIS DB flush error")
            await asyncio.sleep(5)


def _prepare_vessel_rows(vessels: list[dict[str, Any]]) -> list[tuple]:
    vessel_rows = []
    for s in vessels:
        extra = {}
        for key in ("trackStartLat", "trackStartLng", "trackStartAt"):
            if s.get(key) is not None:
                extra[key] = s[key]

        name = str(s.get("name") or "")[:255] if s.get("name") else None
        destination = str(s.get("destination") or "")[:255] if s.get("destination") else None
        ship_type = str(s.get("type") or "cargo")[:50]
        size_class = str(s.get("sizeClass") or "unknown")[:20]
        size_source = str(s.get("sizeSource") or "unreported")[:30]

        vessel_rows.append((
            int(s.get("mmsi") or s.get("id", 0)),
            name,
            ship_type,
            float(s.get("lat", 0)),
            float(s.get("lng", 0)),
            s.get("speed"),
            s.get("heading"),
            destination,
            s.get("aisTypeCode"),
            s.get("length"),
            s.get("width"),
            s.get("draught"),
            size_class,
            size_source,
            s.get("firstSeenLat"),
            s.get("firstSeenLng"),
            s.get("firstSeenAt"),
            s.get("lastSeenAt") or s.get("timestamp") or time.time(),
            s.get("trackDistanceKm", 0),
            s.get("trackPointCount", 0),
            json.dumps(extra) if extra else None,
        ))
    return vessel_rows


async def _flush_pending() -> None:
    """Batch upsert all pending vessel records and track points."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        return

    async with _lock:
        if not _pending and not _pending_tracks:
            return
        vessels = list(_pending.values())[:MAX_BATCH_SIZE]
        flushed_keys = list(_pending.keys())[:MAX_BATCH_SIZE]
        for k in flushed_keys:
            _pending.pop(k, None)
        tracks = _pending_tracks[:]
        _pending_tracks.clear()

    if not vessels and not tracks:
        return

    vessel_rows = _prepare_vessel_rows(vessels) if vessels else []

    try:
        if pool is not None:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    if vessel_rows:
                        await cur.executemany(
                            """
                            INSERT INTO ais_vessels
                                (mmsi, name, ship_type, lat, lng, speed, heading, destination,
                                 ais_type_code, length_m, width_m, draught, size_class, size_source,
                                 first_seen_lat, first_seen_lng, first_seen_at, last_seen_at,
                                 track_distance_km, track_point_count, extra_json)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) AS new_row
                            ON DUPLICATE KEY UPDATE
                                name = new_row.name,
                                ship_type = new_row.ship_type,
                                lat = new_row.lat,
                                lng = new_row.lng,
                                speed = new_row.speed,
                                heading = new_row.heading,
                                destination = new_row.destination,
                                ais_type_code = new_row.ais_type_code,
                                length_m = new_row.length_m,
                                width_m = new_row.width_m,
                                draught = new_row.draught,
                                size_class = new_row.size_class,
                                size_source = new_row.size_source,
                                first_seen_lat = COALESCE(ais_vessels.first_seen_lat, new_row.first_seen_lat),
                                first_seen_lng = COALESCE(ais_vessels.first_seen_lng, new_row.first_seen_lng),
                                first_seen_at = COALESCE(ais_vessels.first_seen_at, new_row.first_seen_at),
                                last_seen_at = new_row.last_seen_at,
                                track_distance_km = new_row.track_distance_km,
                                track_point_count = new_row.track_point_count,
                                extra_json = new_row.extra_json
                            """,
                            vessel_rows,
                        )

                    if tracks:
                        await cur.executemany(
                            "INSERT INTO ais_track_points (mmsi, lat, lng, speed, heading, recorded_at) "
                            "VALUES (%s, %s, %s, %s, %s, %s)",
                            tracks,
                        )
                await conn.commit()

        elif sqlite is not None:
            cur = sqlite.cursor()
            if vessel_rows:
                cur.executemany(
                    """
                    INSERT INTO ais_vessels
                        (mmsi, name, ship_type, lat, lng, speed, heading, destination,
                         ais_type_code, length_m, width_m, draught, size_class, size_source,
                         first_seen_lat, first_seen_lng, first_seen_at, last_seen_at,
                         track_distance_km, track_point_count, extra_json)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(mmsi) DO UPDATE SET
                        name = excluded.name,
                        ship_type = excluded.ship_type,
                        lat = excluded.lat,
                        lng = excluded.lng,
                        speed = excluded.speed,
                        heading = excluded.heading,
                        destination = excluded.destination,
                        ais_type_code = excluded.ais_type_code,
                        length_m = excluded.length_m,
                        width_m = excluded.width_m,
                        draught = excluded.draught,
                        size_class = excluded.size_class,
                        size_source = excluded.size_source,
                        last_seen_at = excluded.last_seen_at,
                        track_distance_km = excluded.track_distance_km,
                        track_point_count = excluded.track_point_count,
                        extra_json = excluded.extra_json,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    vessel_rows,
                )
            if tracks:
                cur.executemany(
                    "INSERT INTO ais_track_points (mmsi, lat, lng, speed, heading, recorded_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    tracks,
                )
            sqlite.commit()

        if vessel_rows:
            logger.debug("Flushed %d vessels and %d track points to DB", len(vessel_rows), len(tracks))

    except Exception:
        logger.exception("AIS DB batch flush failed (%d vessels, %d tracks)", len(vessel_rows), len(tracks))


async def _prune_loop() -> None:
    """Periodically remove stale vessels and old track points from the database."""
    while _running:
        try:
            await asyncio.sleep(TRACK_PRUNE_INTERVAL)
            await _prune_old_data()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("AIS DB prune error")
            await asyncio.sleep(60)


async def _prune_old_data() -> None:
    """Delete vessels not seen in 60 min and track points older than retention window."""
    pool = database._pool
    sqlite = database._sqlite
    if pool is None and sqlite is None:
        return
    try:
        now = time.time()
        vessel_cutoff = now - 3600                              # 60 min
        track_cutoff = now - (TRACK_RETENTION_HOURS * 3600)     # 24 h

        if pool is not None:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("DELETE FROM ais_vessels WHERE last_seen_at < %s", (vessel_cutoff,))
                    stale_vessels = cur.rowcount
                    await cur.execute("DELETE FROM ais_track_points WHERE recorded_at < %s", (track_cutoff,))
                    stale_tracks = cur.rowcount
                await conn.commit()
        elif sqlite is not None:
            cur = sqlite.cursor()
            cur.execute("DELETE FROM ais_vessels WHERE last_seen_at < ?", (vessel_cutoff,))
            stale_vessels = cur.rowcount
            cur.execute("DELETE FROM ais_track_points WHERE recorded_at < ?", (track_cutoff,))
            stale_tracks = cur.rowcount
            sqlite.commit()
        else:
            stale_vessels = 0
            stale_tracks = 0

        if stale_vessels or stale_tracks:
            logger.info("Pruned %d stale vessels and %d old track points", stale_vessels, stale_tracks)
    except Exception:
        logger.exception("AIS DB prune failed")


# ── CLI & Standalone Runner ─────────────────────────────────────────────────────

async def print_status() -> None:
    """Print current counts from the database."""
    await database.connect()
    await init_tables()
    pool = database._pool
    sqlite = database._sqlite

    if pool is not None:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT COUNT(*) FROM ais_vessels")
                (vessel_count,) = await cur.fetchone()
                await cur.execute("SELECT COUNT(*) FROM ais_track_points")
                (track_count,) = await cur.fetchone()
                await cur.execute(
                    "SELECT ship_type, COUNT(*) FROM ais_vessels GROUP BY ship_type"
                )
                type_counts = dict(await cur.fetchall())
                await cur.execute(
                    "SELECT mmsi, name, ship_type, lat, lng, speed, updated_at "
                    "FROM ais_vessels ORDER BY updated_at DESC LIMIT 5"
                )
                recent = await cur.fetchall()

        print("\n=== AIS Database Status (MySQL) ===")
        print(f"Total Vessels in DB:      {vessel_count}")
        print(f"Total Track Points in DB: {track_count}")
        print(f"Category Breakdown:       {type_counts}")
        print("\nMost Recently Updated Vessels:")
        for r in recent:
            print(f"  MMSI {r[0]}: {r[1] or 'Unknown'} ({r[2]}) @ {r[3]:.4f}, {r[4]:.4f} | {r[5] or 0} kts | {r[6]}")
        print("===================================\n")

    elif sqlite is not None:
        cur = sqlite.cursor()
        cur.execute("SELECT COUNT(*) FROM ais_vessels")
        vessel_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM ais_track_points")
        track_count = cur.fetchone()[0]
        print(f"\n=== AIS Database Status (SQLite) ===")
        print(f"Total Vessels in DB:      {vessel_count}")
        print(f"Total Track Points in DB: {track_count}")
        print("===================================\n")
    else:
        print("[ERROR] Database connection failed. Check your DATABASE_* settings in .env")

    await database.close()


async def run_recorder() -> None:
    """Main continuous recording loop."""
    import signal
    from . import ais_stream, digitraffic_ais

    logger.info("Initializing AIS Database Recorder...")
    logger.info(f"Target Database: {settings.DATABASE_HOST or 'Local SQLite'}:{settings.DATABASE_PORT}")
    logger.info(f"AISStream API Key configured: {'YES' if settings.AIS_API_KEY else 'NO (Set AIS_API_KEY in .env)'}")

    # 1. Connect to Database & prepare tables
    await database.connect()
    await init_tables()
    await start()

    # 2. Start AIS Stream & Digitraffic
    await ais_stream.start()
    await digitraffic_ais.start()

    logger.info("Continuous AIS recording is running. Press Ctrl+C to stop.")

    # 3. Monitor and report stats periodically
    stop_event = asyncio.Event()

    def _signal_handler():
        logger.info("Shutdown signal received...")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _signal_handler)
        except (NotImplementedError, RuntimeError):
            pass

    start_time = time.time()
    try:
        while not stop_event.is_set():
            await asyncio.sleep(15)
            elapsed = int(time.time() - start_time)
            vessels_in_mem = ais_stream.ship_count()
            logger.info(
                f"[AIS Recorder Stats] Runtime: {elapsed}s | "
                f"Live in-memory vessels: {vessels_in_mem} | "
                f"Pending DB writes: {len(_pending)}"
            )
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        logger.info("Shutting down AIS recorder...")
        await digitraffic_ais.stop()
        await ais_stream.stop()
        await stop()
        await database.close()
        logger.info("AIS recorder shut down cleanly.")


def main():
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        stream=sys.stdout,
        force=True,
    )
    if "--status" in sys.argv:
        asyncio.run(print_status())
    elif "--prune" in sys.argv:
        async def _prune():
            await database.connect()
            await _prune_old_data()
            await database.close()
            print("Prune completed.")
        asyncio.run(_prune())
    else:
        try:
            asyncio.run(run_recorder())
        except KeyboardInterrupt:
            print("\nExited.")


if __name__ == "__main__":
    import sys
    from pathlib import Path
    root_dir = str(Path(__file__).resolve().parents[2])
    if root_dir not in sys.path:
        sys.path.insert(0, root_dir)
    main()

