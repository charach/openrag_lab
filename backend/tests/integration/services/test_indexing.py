"""IndexingService — end-to-end with real fakes + real SQLite repos.

Exercises the parse → chunk → embed → upsert chain using:
  - TxtParser (pure-stdlib)
  - FixedChunker
  - FakeEmbedder (deterministic)
  - InMemoryVectorStore
  - SQLite-backed ChunkRepository + IndexingCheckpointRepository
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from openrag_lab.adapters.chunkers.fixed import FixedChunker
from openrag_lab.adapters.embedders.fake import FakeEmbedder
from openrag_lab.adapters.parsers.txt import TxtParser
from openrag_lab.adapters.vector_stores.in_memory import InMemoryVectorStore
from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import (
    ChunkingStrategy,
    DocumentFormat,
    RetrievalStrategy,
)
from openrag_lab.domain.models.experiment import ExperimentConfig
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.domain.services.cancellation import CancellationToken
from openrag_lab.domain.services.indexing import (
    IndexingService,
    collection_name,
)
from openrag_lab.domain.services.progress import CollectingProgressReporter
from openrag_lab.infra.db.repositories.checkpoint_repo import IndexingCheckpointRepository
from openrag_lab.infra.db.repositories.chunk_repo import ChunkRepository
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _make_doc(workspace_id, path: Path, content_hash: str = "a" * 64) -> Document:  # type: ignore[no-untyped-def]
    return Document(
        id=new_document_id(),
        workspace_id=workspace_id,
        source_path=path,
        content_hash=content_hash,
        format=DocumentFormat.TXT,
        size_bytes=path.stat().st_size,
        added_at=datetime.now(UTC),
    )


def _seed_workspace(conn: sqlite3.Connection):  # type: ignore[no-untyped-def]
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ws"),
        created_at=datetime.now(UTC),
    )
    WorkspaceRepository(conn).add(ws)
    return ws


def _build_service(
    conn: sqlite3.Connection,
) -> tuple[IndexingService, InMemoryVectorStore, FakeEmbedder]:
    embedder = FakeEmbedder(dim=16)
    vstore = InMemoryVectorStore()
    svc = IndexingService(
        parsers=[TxtParser()],
        chunkers=[FixedChunker()],
        embedder=embedder,
        vector_store=vstore,
        chunk_repo=ChunkRepository(conn),
        checkpoint_repo=IndexingCheckpointRepository(conn),
    )
    return svc, vstore, embedder


def _exp_config() -> ExperimentConfig:
    return ExperimentConfig(
        embedder_id="fake-embedder",
        chunking=ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=32, chunk_overlap=0),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=5,
    )


async def test_indexes_documents_end_to_end(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ws = _seed_workspace(conn)
    doc_path = tmp_path / "doc.txt"
    doc_path.write_text("alpha " * 200, encoding="utf-8")

    doc = _make_doc(ws.id, doc_path)
    DocumentRepository(conn).add(doc)
    svc, vstore, embedder = _build_service(conn)
    config = _exp_config()
    chunking = config.chunking

    report = await svc.run(
        workspace_id=ws.id,
        documents=[doc],
        config=config,
        chunking=chunking,
    )

    assert report.indexed == [doc.id]
    assert report.failed == []
    assert report.chunks_written > 0
    stats = await vstore.stats(collection_name(embedder.model_id, embedder.dim))
    assert stats.count == report.chunks_written


async def test_resumes_from_checkpoint_skipping_already_embedded(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    ws = _seed_workspace(conn)
    doc_path = tmp_path / "d.txt"
    doc_path.write_text("alpha beta gamma " * 50, encoding="utf-8")
    doc = _make_doc(ws.id, doc_path)
    DocumentRepository(conn).add(doc)
    svc, _, _ = _build_service(conn)
    cfg = _exp_config()

    first = await svc.run(workspace_id=ws.id, documents=[doc], config=cfg, chunking=cfg.chunking)
    assert first.indexed == [doc.id]

    # Run again — should skip.
    second = await svc.run(workspace_id=ws.id, documents=[doc], config=cfg, chunking=cfg.chunking)
    assert second.indexed == []
    assert second.skipped == [doc.id]


async def test_isolates_parse_failure(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ws = _seed_workspace(conn)

    bad_path = tmp_path / "broken.txt"
    bad_path.write_bytes(
        b"\xff\xfe binary garbage"
    )  # invalid utf-8 in lenient mode? still parseable
    # Force a parse failure by using an unsupported format.
    fake_path = tmp_path / "x.docx"
    fake_path.write_text("ignored", encoding="utf-8")
    bad_doc = Document(
        id=new_document_id(),
        workspace_id=ws.id,
        source_path=fake_path,
        content_hash="b" * 64,
        format=DocumentFormat.PDF,  # no PDF parser registered in this test
        size_bytes=10,
        added_at=datetime.now(UTC),
    )

    good_path = tmp_path / "good.txt"
    good_path.write_text("hello world " * 50, encoding="utf-8")
    good_doc = _make_doc(ws.id, good_path, content_hash="c" * 64)

    DocumentRepository(conn).add(bad_doc)
    DocumentRepository(conn).add(good_doc)
    svc, _, _ = _build_service(conn)
    cfg = _exp_config()

    report = await svc.run(
        workspace_id=ws.id,
        documents=[bad_doc, good_doc],
        config=cfg,
        chunking=cfg.chunking,
    )
    assert good_doc.id in report.indexed
    assert any(did == bad_doc.id for did, _ in report.failed)


async def test_cancellation_stops_run(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ws = _seed_workspace(conn)
    docs = []
    for i in range(3):
        p = tmp_path / f"d{i}.txt"
        p.write_text("alpha " * 50, encoding="utf-8")
        d = _make_doc(ws.id, p, content_hash=str(i) * 64)
        DocumentRepository(conn).add(d)
        docs.append(d)

    svc, _, _ = _build_service(conn)
    cfg = _exp_config()

    token = CancellationToken()
    token.cancel()  # immediately
    report = await svc.run(
        workspace_id=ws.id,
        documents=docs,
        config=cfg,
        chunking=cfg.chunking,
        token=token,
    )
    assert report.cancelled is True
    assert report.indexed == []


async def test_progress_reporter_receives_per_document_events(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    ws = _seed_workspace(conn)
    doc_path = tmp_path / "d.txt"
    doc_path.write_text("alpha " * 60, encoding="utf-8")
    doc = _make_doc(ws.id, doc_path)
    DocumentRepository(conn).add(doc)
    svc, _, _ = _build_service(conn)
    cfg = _exp_config()

    reporter = CollectingProgressReporter()
    await svc.run(
        workspace_id=ws.id,
        documents=[doc],
        config=cfg,
        chunking=cfg.chunking,
        progress=reporter,
        topic="exp_test",
    )
    stages = [e["stage"] for e in reporter.events]
    assert "indexed" in stages


async def test_unknown_strategy_raises(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ws = _seed_workspace(conn)
    doc_path = tmp_path / "d.txt"
    doc_path.write_text("alpha " * 50, encoding="utf-8")
    doc = _make_doc(ws.id, doc_path)
    DocumentRepository(conn).add(doc)
    svc = IndexingService(
        parsers=[TxtParser()],
        chunkers=[],  # no chunkers registered!
        embedder=FakeEmbedder(dim=8),
        vector_store=InMemoryVectorStore(),
        chunk_repo=ChunkRepository(conn),
        checkpoint_repo=IndexingCheckpointRepository(conn),
    )
    cfg = _exp_config()
    with pytest.raises(Exception):  # noqa: B017 — accept any OpenRagError
        await svc.run(
            workspace_id=ws.id,
            documents=[doc],
            config=cfg,
            chunking=cfg.chunking,
        )


def test_collection_name_format() -> None:
    assert collection_name("BAAI/bge-m3", 1024) == "vectors_BAAIbge-m3_1024"
    assert collection_name("", 8) == "vectors_model_8"


# silence unused import warning
_ = ParseError
