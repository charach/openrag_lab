"""SQLite migration runner — schema creation, idempotency, FK enforcement."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from openrag_lab.infra.db.migrations import (
    CURRENT_SCHEMA_VERSION,
    apply_migrations,
    current_version,
)
from openrag_lab.infra.db.sqlite import connect, open_db

# Tables expected after the v1 migration.
EXPECTED_TABLES = frozenset(
    {
        "schema_version",
        "workspace",
        "document",
        "chunk",
        "experiment",
        "golden_set",
        "golden_pair",
        "indexing_checkpoint",
    }
)


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    ).fetchall()
    return {r[0] for r in rows}


def test_connect_creates_schema_on_fresh_file(tmp_path: Path) -> None:
    db_path = tmp_path / "fresh.sqlite"
    with open_db(db_path) as conn:
        assert current_version(conn) == CURRENT_SCHEMA_VERSION
        assert EXPECTED_TABLES.issubset(_table_names(conn))


def test_connect_creates_parent_directories(tmp_path: Path) -> None:
    db_path = tmp_path / "nested" / "dir" / "x.sqlite"
    with open_db(db_path):
        assert db_path.exists()


def test_apply_migrations_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "idem.sqlite"
    with open_db(db_path) as conn:
        first = apply_migrations(conn)
        second = apply_migrations(conn)
    assert first == second == CURRENT_SCHEMA_VERSION

    # And re-opening from disk does not append a duplicate version row.
    with open_db(db_path) as conn:
        rows = conn.execute("SELECT version FROM schema_version").fetchall()
    assert [r["version"] for r in rows] == [CURRENT_SCHEMA_VERSION]


def test_workspace_insert_and_lookup_round_trip(tmp_path: Path) -> None:
    with open_db(tmp_path / "ws.sqlite") as conn:
        conn.execute(
            "INSERT INTO workspace (id, name, created_at) VALUES (?, ?, ?)",
            ("ws_test", "내 자료실", datetime.now(UTC).isoformat()),
        )
        conn.commit()
        row = conn.execute("SELECT name FROM workspace WHERE id = ?", ("ws_test",)).fetchone()
    assert row["name"] == "내 자료실"


def test_document_unique_constraint_on_workspace_and_hash(tmp_path: Path) -> None:
    with open_db(tmp_path / "uniq.sqlite") as conn:
        conn.execute(
            "INSERT INTO workspace (id, name, created_at) VALUES (?, ?, ?)",
            ("ws_a", "ws", datetime.now(UTC).isoformat()),
        )
        conn.execute(
            "INSERT INTO document "
            "(id, workspace_id, source_path, content_hash, format, size_bytes, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("doc_a", "ws_a", "/x.pdf", "h" * 64, "pdf", 1, datetime.now(UTC).isoformat()),
        )
        conn.commit()
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            conn.execute(
                "INSERT INTO document "
                "(id, workspace_id, source_path, content_hash, format, size_bytes, added_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    "doc_b",
                    "ws_a",
                    "/y.pdf",
                    "h" * 64,
                    "pdf",
                    2,
                    datetime.now(UTC).isoformat(),
                ),
            )
            conn.commit()


def test_foreign_key_cascade_delete_removes_documents(tmp_path: Path) -> None:
    with open_db(tmp_path / "cascade.sqlite") as conn:
        conn.execute(
            "INSERT INTO workspace (id, name, created_at) VALUES (?, ?, ?)",
            ("ws_c", "ws", datetime.now(UTC).isoformat()),
        )
        conn.execute(
            "INSERT INTO document "
            "(id, workspace_id, source_path, content_hash, format, size_bytes, added_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("doc_c", "ws_c", "/z.pdf", "0" * 64, "pdf", 1, datetime.now(UTC).isoformat()),
        )
        conn.commit()

        conn.execute("DELETE FROM workspace WHERE id = ?", ("ws_c",))
        conn.commit()

        rows = conn.execute("SELECT 1 FROM document WHERE id = ?", ("doc_c",)).fetchall()
    assert rows == []


def test_in_memory_db_works_without_filesystem() -> None:
    conn = connect(Path(":memory:"))
    try:
        assert current_version(conn) == CURRENT_SCHEMA_VERSION
    finally:
        conn.close()
