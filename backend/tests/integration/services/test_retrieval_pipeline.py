"""RetrievalService + RAGPipeline + EvaluationService integration."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from openrag_lab.adapters.chunkers.fixed import FixedChunker
from openrag_lab.adapters.embedders.fake import FakeEmbedder
from openrag_lab.adapters.evaluators.llm_judge import LLMJudge
from openrag_lab.adapters.llms.null import EchoLLM, NullLLM
from openrag_lab.adapters.parsers.txt import TxtParser
from openrag_lab.adapters.vector_stores.in_memory import InMemoryVectorStore
from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import (
    ChunkingStrategy,
    DocumentFormat,
    RetrievalStrategy,
)
from openrag_lab.domain.models.experiment import ExperimentConfig
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id
from openrag_lab.domain.models.retrieval import Query
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.domain.services.evaluation import EvaluationService, GoldenPairInput
from openrag_lab.domain.services.indexing import IndexingService
from openrag_lab.domain.services.pipeline import RAGPipeline
from openrag_lab.domain.services.retrieval import RetrievalService
from openrag_lab.infra.db.repositories.checkpoint_repo import IndexingCheckpointRepository
from openrag_lab.infra.db.repositories.chunk_repo import ChunkRepository
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _seed_workspace(conn: sqlite3.Connection):  # type: ignore[no-untyped-def]
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ws"),
        created_at=datetime.now(UTC),
    )
    WorkspaceRepository(conn).add(ws)
    return ws


async def _index_corpus(
    conn: sqlite3.Connection, tmp_path: Path
) -> tuple[Workspace, ExperimentConfig, FakeEmbedder, InMemoryVectorStore, ChunkRepository]:
    ws = _seed_workspace(conn)
    embedder = FakeEmbedder(dim=24)
    vstore = InMemoryVectorStore()

    docs = []
    for i, text in enumerate(["alpha story " * 30, "beta tutorial " * 30, "gamma reference " * 30]):
        p = tmp_path / f"d{i}.txt"
        p.write_text(text, encoding="utf-8")
        doc = Document(
            id=new_document_id(),
            workspace_id=ws.id,
            source_path=p,
            content_hash=str(i) * 64,
            format=DocumentFormat.TXT,
            size_bytes=p.stat().st_size,
            added_at=datetime.now(UTC),
        )
        DocumentRepository(conn).add(doc)
        docs.append(doc)

    chunk_repo = ChunkRepository(conn)
    config = ExperimentConfig(
        embedder_id="fake-embedder",
        chunking=ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=32, chunk_overlap=0),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=3,
    )
    svc = IndexingService(
        parsers=[TxtParser()],
        chunkers=[FixedChunker()],
        embedder=embedder,
        vector_store=vstore,
        chunk_repo=chunk_repo,
        checkpoint_repo=IndexingCheckpointRepository(conn),
    )
    await svc.run(
        workspace_id=ws.id,
        documents=docs,
        config=config,
        chunking=config.chunking,
    )
    return ws, config, embedder, vstore, chunk_repo


async def test_retrieval_returns_ranked_chunks(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ws, cfg, embedder, vstore, chunk_repo = await _index_corpus(conn, tmp_path)
    # Hydrate the in-memory chunk lookup from the DB.
    all_chunks = []
    for doc_row in DocumentRepository(conn).list_for_workspace(ws.id):
        all_chunks.extend(chunk_repo.list_for_document(doc_row.id, cfg.chunking.cache_key()))

    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks(all_chunks)
    result = await retrieval.retrieve(Query(text="alpha story", top_k=3))
    assert len(result.retrieved) <= 3
    assert all(rc.score is not None for rc in result.retrieved)
    # Ranks are dense and start at 0.
    assert [rc.rank for rc in result.retrieved] == list(range(len(result.retrieved)))


async def test_retrieval_only_pipeline_returns_no_answer(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    ws, cfg, embedder, vstore, chunk_repo = await _index_corpus(conn, tmp_path)
    all_chunks = []
    for doc_row in DocumentRepository(conn).list_for_workspace(ws.id):
        all_chunks.extend(chunk_repo.list_for_document(doc_row.id, cfg.chunking.cache_key()))

    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks(all_chunks)
    pipeline = RAGPipeline(retrieval=retrieval, llm=NullLLM(), config=cfg)
    out = await pipeline.answer("anything")
    assert out.answer is None
    assert out.retrieval is not None


async def test_pipeline_with_llm_returns_answer(conn: sqlite3.Connection, tmp_path: Path) -> None:
    ws, base_cfg, embedder, vstore, chunk_repo = await _index_corpus(conn, tmp_path)
    all_chunks = []
    for doc_row in DocumentRepository(conn).list_for_workspace(ws.id):
        all_chunks.extend(chunk_repo.list_for_document(doc_row.id, base_cfg.chunking.cache_key()))

    cfg_with_llm = base_cfg.model_copy(update={"llm_id": "echo"})
    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks(all_chunks)
    pipeline = RAGPipeline(retrieval=retrieval, llm=EchoLLM(), config=cfg_with_llm)
    out = await pipeline.answer("what is alpha?")
    assert out.answer is not None
    assert out.answer.startswith("echo[")  # EchoLLM truncates the prompt at 200 chars


async def test_evaluation_in_retrieval_only_skips_llm_metrics(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    ws, cfg, embedder, vstore, chunk_repo = await _index_corpus(conn, tmp_path)
    all_chunks = []
    for doc_row in DocumentRepository(conn).list_for_workspace(ws.id):
        all_chunks.extend(chunk_repo.list_for_document(doc_row.id, cfg.chunking.cache_key()))

    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks(all_chunks)
    pipeline = RAGPipeline(retrieval=retrieval, llm=NullLLM(), config=cfg)
    judge = LLMJudge(EchoLLM())
    eval_svc = EvaluationService(pipeline=pipeline, judge=judge, config=cfg)

    scores = await eval_svc.evaluate(
        [
            GoldenPairInput(question="what is alpha?", expected_answer="a story"),
            GoldenPairInput(question="what is beta?", expected_answer="a tutorial"),
        ]
    )
    # Retrieval-only ⇒ faithfulness/answer_relevance are None;
    # context_precision is computed; context_recall is computed when expected_answer is given.
    assert scores.faithfulness is None
    assert scores.answer_relevance is None
    assert scores.context_precision is not None
    assert scores.context_recall is not None


async def test_evaluation_with_llm_populates_all_metrics(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    ws, base_cfg, embedder, vstore, chunk_repo = await _index_corpus(conn, tmp_path)
    all_chunks = []
    for doc_row in DocumentRepository(conn).list_for_workspace(ws.id):
        all_chunks.extend(chunk_repo.list_for_document(doc_row.id, base_cfg.chunking.cache_key()))

    cfg_with_llm = base_cfg.model_copy(update={"llm_id": "echo"})
    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks(all_chunks)
    pipeline = RAGPipeline(retrieval=retrieval, llm=EchoLLM(), config=cfg_with_llm)
    judge = LLMJudge(EchoLLM())
    eval_svc = EvaluationService(pipeline=pipeline, judge=judge, config=cfg_with_llm)

    scores = await eval_svc.evaluate(
        [GoldenPairInput(question="what is alpha?", expected_answer="alpha story")]
    )
    assert scores.context_precision is not None
    assert scores.context_recall is not None
    # EchoLLM returns unparseable judge output, so judges fall back to 0 — but they ARE populated.
    assert scores.faithfulness is not None
    assert scores.answer_relevance is not None


async def test_pipeline_retrieval_only_with_no_llm() -> None:
    """RAGPipeline without an LLM at all (no NullLLM stub) still returns no answer."""
    # tiny in-memory setup
    embedder = FakeEmbedder(dim=8)
    vstore = InMemoryVectorStore()
    cfg = ExperimentConfig(
        embedder_id="fake-embedder",
        chunking=ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=32, chunk_overlap=0),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=2,
    )
    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks([])
    await vstore.create_collection(
        "vectors_fake-embedder_8",
        dim=8,
        metric=__import__(
            "openrag_lab.domain.models.enums", fromlist=["DistanceMetric"]
        ).DistanceMetric.COSINE,
    )
    pipeline = RAGPipeline(retrieval=retrieval, llm=None, config=cfg)
    out = await pipeline.answer("anything")
    assert out.answer is None


async def test_null_llm_in_non_retrieval_mode_raises_when_used() -> None:
    """If misconfigured (llm_id set but NullLLM passed in), generate raises."""
    cfg = ExperimentConfig(
        embedder_id="x",
        chunking=ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=32, chunk_overlap=0),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=1,
        llm_id="something",  # forces non-retrieval-only
    )
    embedder = FakeEmbedder(dim=8)
    vstore = InMemoryVectorStore()
    await vstore.create_collection(
        "vectors_fake-embedder_8",
        dim=8,
        metric=__import__(
            "openrag_lab.domain.models.enums", fromlist=["DistanceMetric"]
        ).DistanceMetric.COSINE,
    )
    retrieval = RetrievalService(embedder=embedder, vector_store=vstore)
    retrieval.register_chunks([])
    pipeline = RAGPipeline(retrieval=retrieval, llm=NullLLM(), config=cfg)
    with pytest.raises(ConfigurationError):
        await pipeline.answer("q")
