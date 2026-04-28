"""IndexingCheckpointRepository — upsert progression, list per-run."""

from __future__ import annotations

import sqlite3

from openrag_lab.domain.models.enums import IndexingStage
from openrag_lab.domain.models.ids import (
    new_document_id,
    new_workspace_id,
)
from openrag_lab.infra.db.repositories.checkpoint_repo import (
    IndexingCheckpointRepository,
)


def test_upsert_then_get_returns_status(conn: sqlite3.Connection) -> None:
    repo = IndexingCheckpointRepository(conn)
    ws_id = new_workspace_id()
    doc_id = new_document_id()
    fp = "f" * 16
    repo.upsert(
        workspace_id=ws_id,
        document_id=doc_id,
        config_fingerprint=fp,
        status=IndexingStage.PARSED,
    )
    out = repo.get(workspace_id=ws_id, document_id=doc_id, config_fingerprint=fp)
    assert out is not None
    assert out[0] is IndexingStage.PARSED


def test_upsert_overwrites_existing_status(conn: sqlite3.Connection) -> None:
    repo = IndexingCheckpointRepository(conn)
    ws_id = new_workspace_id()
    doc_id = new_document_id()
    fp = "f" * 16
    repo.upsert(
        workspace_id=ws_id, document_id=doc_id, config_fingerprint=fp, status=IndexingStage.PARSED
    )
    repo.upsert(
        workspace_id=ws_id,
        document_id=doc_id,
        config_fingerprint=fp,
        status=IndexingStage.EMBEDDED,
    )
    out = repo.get(workspace_id=ws_id, document_id=doc_id, config_fingerprint=fp)
    assert out is not None
    assert out[0] is IndexingStage.EMBEDDED


def test_get_missing_returns_none(conn: sqlite3.Connection) -> None:
    repo = IndexingCheckpointRepository(conn)
    assert (
        repo.get(
            workspace_id=new_workspace_id(),
            document_id=new_document_id(),
            config_fingerprint="x" * 16,
        )
        is None
    )


def test_list_for_run_aggregates_per_document(conn: sqlite3.Connection) -> None:
    repo = IndexingCheckpointRepository(conn)
    ws_id = new_workspace_id()
    fp = "f" * 16
    doc_a = new_document_id()
    doc_b = new_document_id()
    repo.upsert(
        workspace_id=ws_id, document_id=doc_a, config_fingerprint=fp, status=IndexingStage.PARSED
    )
    repo.upsert(
        workspace_id=ws_id, document_id=doc_b, config_fingerprint=fp, status=IndexingStage.CHUNKED
    )
    out = dict(repo.list_for_run(ws_id, fp))
    assert out[doc_a] is IndexingStage.PARSED
    assert out[doc_b] is IndexingStage.CHUNKED


def test_list_for_run_filters_by_fingerprint(conn: sqlite3.Connection) -> None:
    repo = IndexingCheckpointRepository(conn)
    ws_id = new_workspace_id()
    doc_id = new_document_id()
    repo.upsert(
        workspace_id=ws_id,
        document_id=doc_id,
        config_fingerprint="a" * 16,
        status=IndexingStage.PARSED,
    )
    repo.upsert(
        workspace_id=ws_id,
        document_id=doc_id,
        config_fingerprint="b" * 16,
        status=IndexingStage.EMBEDDED,
    )
    a = repo.list_for_run(ws_id, "a" * 16)
    assert len(a) == 1
    assert a[0][1] is IndexingStage.PARSED


def test_clear_for_workspace(conn: sqlite3.Connection) -> None:
    repo = IndexingCheckpointRepository(conn)
    ws_a = new_workspace_id()
    ws_b = new_workspace_id()
    repo.upsert(
        workspace_id=ws_a,
        document_id=new_document_id(),
        config_fingerprint="x" * 16,
        status=IndexingStage.PARSED,
    )
    repo.upsert(
        workspace_id=ws_b,
        document_id=new_document_id(),
        config_fingerprint="x" * 16,
        status=IndexingStage.PARSED,
    )
    deleted = repo.clear_for_workspace(ws_a)
    assert deleted == 1
    assert repo.list_for_run(ws_b, "x" * 16) != []
