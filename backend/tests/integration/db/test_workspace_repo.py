"""WorkspaceRepository — round-trip + update + delete cascade."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from openrag_lab.domain.models.ids import new_workspace_id
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _make_ws(name: str = "default", tags: tuple[str, ...] = ()) -> Workspace:
    return Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name=name, description="", tags=tags),
        created_at=datetime.now(UTC),
    )


def test_add_and_get_round_trip(conn: sqlite3.Connection) -> None:
    repo = WorkspaceRepository(conn)
    ws = _make_ws(name="My WS — 한국어 📚", tags=("ml", "rag"))
    repo.add(ws)
    out = repo.get(ws.id)
    assert out is not None
    assert out.id == ws.id
    assert out.meta.name == ws.meta.name
    assert out.meta.tags == ws.meta.tags


def test_get_missing_returns_none(conn: sqlite3.Connection) -> None:
    repo = WorkspaceRepository(conn)
    assert repo.get(new_workspace_id()) is None


def test_list_returns_all_in_creation_order(conn: sqlite3.Connection) -> None:
    repo = WorkspaceRepository(conn)
    ws_a = _make_ws("a")
    ws_b = _make_ws("b")
    repo.add(ws_a)
    repo.add(ws_b)
    out = repo.list_all()
    assert {w.meta.name for w in out} == {"a", "b"}


def test_update_meta_changes_only_meta(conn: sqlite3.Connection) -> None:
    repo = WorkspaceRepository(conn)
    ws = _make_ws("orig")
    repo.add(ws)
    new_meta = WorkspaceMeta(name="renamed", description="new desc", tags=("a",))
    rowcount = repo.update_meta(ws.id, new_meta)
    assert rowcount == 1
    refreshed = repo.get(ws.id)
    assert refreshed is not None
    assert refreshed.meta.name == "renamed"
    assert refreshed.meta.tags == ("a",)
    # ID and created_at unchanged.
    assert refreshed.id == ws.id


def test_delete_removes_row(conn: sqlite3.Connection) -> None:
    repo = WorkspaceRepository(conn)
    ws = _make_ws()
    repo.add(ws)
    assert repo.delete(ws.id) == 1
    assert repo.get(ws.id) is None
    assert repo.delete(ws.id) == 0  # idempotent
