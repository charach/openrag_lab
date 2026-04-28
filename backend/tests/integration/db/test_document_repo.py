"""DocumentRepository — workspace scoping, content_hash uniqueness, cascade."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _make_doc(workspace_id, content_hash: str = "a" * 64) -> Document:  # type: ignore[no-untyped-def]
    return Document(
        id=new_document_id(),
        workspace_id=workspace_id,
        source_path=Path("/data/한국어 폴더/sample.pdf"),
        content_hash=content_hash,
        format=DocumentFormat.PDF,
        size_bytes=12345,
        added_at=datetime.now(UTC),
    )


def _seed_ws(conn: sqlite3.Connection):  # type: ignore[no-untyped-def]
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ws"),
        created_at=datetime.now(UTC),
    )
    WorkspaceRepository(conn).add(ws)
    return ws


def test_add_and_get_round_trip(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = DocumentRepository(conn)
    doc = _make_doc(ws.id)
    repo.add(doc)
    out = repo.get(doc.id)
    assert out is not None
    assert out.id == doc.id
    assert out.content_hash == doc.content_hash
    assert out.source_path.as_posix() == doc.source_path.as_posix()


def test_get_by_hash_scopes_by_workspace(conn: sqlite3.Connection) -> None:
    ws_a = _seed_ws(conn)
    ws_b = _seed_ws(conn)
    repo = DocumentRepository(conn)
    repo.add(_make_doc(ws_a.id, content_hash="a" * 64))
    repo.add(_make_doc(ws_b.id, content_hash="a" * 64))  # same hash, different ws
    a = repo.get_by_hash(ws_a.id, "a" * 64)
    b = repo.get_by_hash(ws_b.id, "a" * 64)
    assert a is not None and b is not None
    assert a.workspace_id == ws_a.id
    assert b.workspace_id == ws_b.id
    assert a.id != b.id


def test_unique_content_hash_per_workspace(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = DocumentRepository(conn)
    repo.add(_make_doc(ws.id, content_hash="a" * 64))
    with pytest.raises(sqlite3.IntegrityError):
        repo.add(_make_doc(ws.id, content_hash="a" * 64))


def test_list_for_workspace_only_returns_that_workspace(
    conn: sqlite3.Connection,
) -> None:
    ws_a = _seed_ws(conn)
    ws_b = _seed_ws(conn)
    repo = DocumentRepository(conn)
    repo.add(_make_doc(ws_a.id, content_hash="a" * 64))
    repo.add(_make_doc(ws_a.id, content_hash="b" * 64))
    repo.add(_make_doc(ws_b.id, content_hash="c" * 64))
    out = repo.list_for_workspace(ws_a.id)
    assert len(out) == 2
    assert all(d.workspace_id == ws_a.id for d in out)


def test_workspace_delete_cascades_to_documents(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    doc_repo = DocumentRepository(conn)
    doc = _make_doc(ws.id)
    doc_repo.add(doc)
    WorkspaceRepository(conn).delete(ws.id)
    assert doc_repo.get(doc.id) is None
