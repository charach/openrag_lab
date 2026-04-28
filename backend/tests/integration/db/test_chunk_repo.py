"""ChunkRepository — bulk insert, config-key partition, cascade."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from openrag_lab.domain.models.chunk import Chunk, ChunkMetadata
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import (
    new_chunk_id,
    new_document_id,
    new_workspace_id,
)
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories.chunk_repo import ChunkRepository
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _seed_doc(conn: sqlite3.Connection):  # type: ignore[no-untyped-def]
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ws"),
        created_at=datetime.now(UTC),
    )
    WorkspaceRepository(conn).add(ws)
    doc = Document(
        id=new_document_id(),
        workspace_id=ws.id,
        source_path=Path("/p/sample.pdf"),
        content_hash="a" * 64,
        format=DocumentFormat.PDF,
        size_bytes=10,
        added_at=datetime.now(UTC),
    )
    DocumentRepository(conn).add(doc)
    return doc


def _make_chunks(doc_id, key: str, n: int = 3) -> list[Chunk]:  # type: ignore[no-untyped-def]
    return [
        Chunk(
            id=new_chunk_id(),
            document_id=doc_id,
            sequence=i,
            content=f"chunk {i}",
            token_count=2,
            metadata=ChunkMetadata(page_number=1, char_offset=i * 10, char_length=8),
            chunk_config_key=key,
        )
        for i in range(n)
    ]


def test_bulk_insert_persists_all_rows(conn: sqlite3.Connection) -> None:
    doc = _seed_doc(conn)
    repo = ChunkRepository(conn)
    chunks = _make_chunks(doc.id, "k" * 16, n=5)
    written = repo.add_many(chunks)
    assert written == 5
    out = repo.list_for_document(doc.id, "k" * 16)
    assert len(out) == 5
    assert [c.sequence for c in out] == [0, 1, 2, 3, 4]


def test_list_partitions_by_chunk_config_key(conn: sqlite3.Connection) -> None:
    doc = _seed_doc(conn)
    repo = ChunkRepository(conn)
    repo.add_many(_make_chunks(doc.id, "k" * 16, n=2))
    repo.add_many(_make_chunks(doc.id, "j" * 16, n=3))
    assert repo.count_for_document(doc.id, "k" * 16) == 2
    assert repo.count_for_document(doc.id, "j" * 16) == 3


def test_delete_for_document_partitioned_by_config(conn: sqlite3.Connection) -> None:
    doc = _seed_doc(conn)
    repo = ChunkRepository(conn)
    repo.add_many(_make_chunks(doc.id, "k" * 16, n=2))
    repo.add_many(_make_chunks(doc.id, "j" * 16, n=3))
    deleted = repo.delete_for_document(doc.id, chunk_config_key="k" * 16)
    assert deleted == 2
    assert repo.count_for_document(doc.id, "j" * 16) == 3


def test_delete_for_document_all_configs(conn: sqlite3.Connection) -> None:
    doc = _seed_doc(conn)
    repo = ChunkRepository(conn)
    repo.add_many(_make_chunks(doc.id, "k" * 16, n=2))
    repo.add_many(_make_chunks(doc.id, "j" * 16, n=3))
    deleted = repo.delete_for_document(doc.id)
    assert deleted == 5


def test_document_delete_cascades_to_chunks(conn: sqlite3.Connection) -> None:
    doc = _seed_doc(conn)
    repo = ChunkRepository(conn)
    repo.add_many(_make_chunks(doc.id, "k" * 16, n=4))
    DocumentRepository(conn).delete(doc.id)
    assert repo.count_for_document(doc.id, "k" * 16) == 0


def test_chunk_metadata_round_trips(conn: sqlite3.Connection) -> None:
    doc = _seed_doc(conn)
    repo = ChunkRepository(conn)
    chunks = _make_chunks(doc.id, "k" * 16, n=1)
    repo.add_many(chunks)
    out = repo.list_for_document(doc.id, "k" * 16)
    assert out[0].metadata.page_number == 1
    assert out[0].metadata.char_length == 8


def test_empty_add_many_is_a_noop(conn: sqlite3.Connection) -> None:
    repo = ChunkRepository(conn)
    assert repo.add_many([]) == 0
