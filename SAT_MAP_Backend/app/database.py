"""MySQL snapshot store with SQLite support for local desktop runs and migration."""

import asyncio
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

import aiomysql

from .config import settings

logger = logging.getLogger("ltmap.database")
_pool: aiomysql.Pool | None = None
_sqlite: sqlite3.Connection | None = None
_lock = asyncio.Lock()


def _mysql_configured() -> bool:
    return all((settings.DATABASE_HOST, settings.DATABASE_NAME, settings.DATABASE_USER, settings.DATABASE_PASSWORD))


async def connect() -> None:
    """Connect to MySQL, or use local SQLite when no MySQL server is configured."""
    global _pool, _sqlite

    if _mysql_configured():
        pool = None
        try:
            pool = await aiomysql.create_pool(
                host=settings.DATABASE_HOST,
                port=settings.DATABASE_PORT,
                db=settings.DATABASE_NAME,
                user=settings.DATABASE_USER,
                password=settings.DATABASE_PASSWORD,
                minsize=1,
                maxsize=settings.DATABASE_POOL_SIZE,
                autocommit=False,
                connect_timeout=settings.DATABASE_COMMAND_TIMEOUT,
            )
            async with pool.acquire() as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS api_snapshots (
                            snapshot_key VARCHAR(255) PRIMARY KEY,
                            payload LONGTEXT NOT NULL,
                            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP
                        ) CHARACTER SET utf8mb4
                        """
                    )
                    await cursor.execute("SELECT COUNT(*) FROM api_snapshots")
                    (snapshot_count,) = await cursor.fetchone()
            _pool = pool
            if snapshot_count == 0:
                await _import_legacy_sqlite()
            logger.info("MySQL snapshot store connected")
            return
        except Exception:
            if pool is not None:
                pool.close()
                await pool.wait_closed()
            _pool = None
            if settings.DATABASE_REQUIRED:
                raise
            logger.exception("MySQL unavailable; continuing without persistent snapshots")
            return

    if settings.DATABASE_REQUIRED:
        raise RuntimeError("Complete DATABASE_* settings are required")

    legacy_path = Path(settings.LEGACY_DATABASE_PATH)
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    _sqlite = sqlite3.connect(legacy_path, check_same_thread=False)
    _sqlite.execute(
        """
        CREATE TABLE IF NOT EXISTS api_snapshots (
            snapshot_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    _sqlite.commit()
    logger.info("Local SQLite snapshot store connected")


async def _import_legacy_sqlite() -> None:
    legacy_path = Path(settings.LEGACY_DATABASE_PATH)
    if _pool is None or not legacy_path.is_file():
        return
    try:
        with sqlite3.connect(legacy_path) as legacy:
            rows = legacy.execute(
                "SELECT snapshot_key, payload FROM api_snapshots"
            ).fetchall()
        if not rows:
            return
        async with _pool.acquire() as connection:
            async with connection.cursor() as cursor:
                await cursor.executemany(
                    "INSERT INTO api_snapshots (snapshot_key, payload) VALUES (%s, %s)",
                    rows,
                )
            await connection.commit()
        logger.info("Imported %d snapshots from the previous SQLite store", len(rows))
    except sqlite3.OperationalError:
        # The legacy volume may exist without a database from the previous setup.
        logger.info("No existing SQLite snapshots found to import")


async def close() -> None:
    global _pool, _sqlite
    async with _lock:
        if _pool is not None:
            _pool.close()
            await _pool.wait_closed()
            _pool = None
        if _sqlite is not None:
            _sqlite.close()
            _sqlite = None


async def save_snapshot(key: str, payload: Any) -> None:
    serialized = json.dumps(payload, separators=(",", ":"))
    try:
        async with _lock:
            if _pool is not None:
                async with _pool.acquire() as connection:
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            """
                            INSERT INTO api_snapshots (snapshot_key, payload)
                            VALUES (%s, %s)
                            ON DUPLICATE KEY UPDATE payload = VALUES(payload)
                            """,
                            (key, serialized),
                        )
                    await connection.commit()
            elif _sqlite is not None:
                _sqlite.execute(
                    """
                    INSERT INTO api_snapshots (snapshot_key, payload, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT (snapshot_key) DO UPDATE
                    SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
                    """,
                    (key, serialized),
                )
                _sqlite.commit()
    except Exception:
        logger.exception("Could not persist %s snapshot", key)


async def load_snapshot(key: str) -> Any | None:
    try:
        async with _lock:
            if _pool is not None:
                async with _pool.acquire() as connection:
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            "SELECT payload FROM api_snapshots WHERE snapshot_key = %s", (key,)
                        )
                        row = await cursor.fetchone()
            elif _sqlite is not None:
                row = _sqlite.execute(
                    "SELECT payload FROM api_snapshots WHERE snapshot_key = ?", (key,)
                ).fetchone()
            else:
                return None
        return json.loads(row[0]) if row else None
    except Exception:
        logger.exception("Could not load %s snapshot", key)
        return None


async def status() -> str:
    if _pool is None and _sqlite is None:
        configured = _mysql_configured()
        return "disconnected" if configured else "not_configured"
    try:
        async with _lock:
            if _pool is not None:
                async with _pool.acquire() as connection:
                    async with connection.cursor() as cursor:
                        await cursor.execute("SELECT 1")
                        await cursor.fetchone()
            else:
                _sqlite.execute("SELECT 1").fetchone()
        return "connected"
    except Exception:
        return "disconnected"
