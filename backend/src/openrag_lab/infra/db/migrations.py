"""Tiny migration runner.

We avoid Alembic for the MVP — a single embedded SQLite file with a handful
of tables does not benefit from heavy machinery. Each migration is a list of
SQL statements bound to an integer version. The runner applies any pending
versions in order, recording each in the ``schema_version`` table.

Future migrations: append a new entry to ``MIGRATIONS`` keyed by an
incrementing int. Never edit a past entry once shipped.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from importlib import resources
from typing import Final

CURRENT_SCHEMA_VERSION: Final[int] = 1

_PACKAGE = "openrag_lab.infra.db"


def _initial_schema_sql() -> str:
    """Read the v1 schema bundled alongside this module."""
    return resources.files(_PACKAGE).joinpath("schema.sql").read_text(encoding="utf-8")


# version -> SQL script that brings the DB from (version - 1) to version.
MIGRATIONS: Final[dict[int, str]] = {
    1: _initial_schema_sql(),
}


def current_version(conn: sqlite3.Connection) -> int:
    """Return the highest applied schema version, or 0 for a fresh DB."""
    # Use sqlite_master rather than catching exceptions — clearer and faster.
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
    ).fetchone()
    if row is None:
        return 0
    row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def apply_migrations(conn: sqlite3.Connection) -> int:
    """Bring ``conn`` up to ``CURRENT_SCHEMA_VERSION``. Idempotent.

    Returns the version the DB is at after the call.
    """
    here = current_version(conn)
    if here >= CURRENT_SCHEMA_VERSION:
        return here

    for version in sorted(MIGRATIONS):
        if version <= here:
            continue
        script = MIGRATIONS[version]
        with conn:  # transaction
            conn.executescript(script)
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (version, datetime.now(UTC).isoformat()),
            )

    return CURRENT_SCHEMA_VERSION
