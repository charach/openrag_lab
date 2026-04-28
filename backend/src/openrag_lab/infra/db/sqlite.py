"""SQLite connection helper.

Thin wrapper around ``sqlite3.connect`` that:
  * opens the DB with ``foreign_keys = ON`` and WAL journal mode,
  * applies pending migrations on first connect,
  * exposes Row factory so callers index columns by name.

Repositories live in ``infra/db/repositories/`` and are added per-feature.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from openrag_lab.infra.db.migrations import apply_migrations


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a connection, ensure parent dir exists, and apply migrations.

    Pass ``Path(":memory:")`` to get a transient in-memory DB (tests).
    """
    if str(db_path) != ":memory:":
        db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(
        str(db_path),
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    apply_migrations(conn)
    return conn


@contextmanager
def open_db(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Context-managed variant for short-lived scripts and tests."""
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()
