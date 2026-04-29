"""Per-workspace runtime — heavy adapter assembly.

Built on demand for a workspace: parsers, chunkers, embedder, vector store.
Tests inject ``embedder_factory`` / ``vector_store_factory`` to swap in
deterministic fakes so the API surface can be exercised without loading
sentence-transformers or starting a Chroma client.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from openrag_lab.adapters.chunkers.fixed import FixedChunker
from openrag_lab.adapters.chunkers.recursive import RecursiveChunker
from openrag_lab.adapters.parsers.markdown import MarkdownParser
from openrag_lab.adapters.parsers.txt import TxtParser
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.domain.models.ids import WorkspaceId
from openrag_lab.domain.ports.chunker import Chunker
from openrag_lab.domain.ports.embedder import Embedder
from openrag_lab.domain.ports.evaluator_judge import EvaluatorJudge
from openrag_lab.domain.ports.llm import LLM
from openrag_lab.domain.ports.parser import DocumentParser
from openrag_lab.domain.ports.vector_store import VectorStore
from openrag_lab.infra.db.repositories.checkpoint_repo import (
    IndexingCheckpointRepository,
)
from openrag_lab.infra.db.repositories.chunk_repo import ChunkRepository
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.db.repositories.experiment_repo import ExperimentRepository
from openrag_lab.infra.db.sqlite import connect

EmbedderFactory = Callable[[str], Embedder]
# Vector store factory receives the workspace id and the persistence dir.
VectorStoreFactory = Callable[[WorkspaceId, Path], VectorStore]
LLMFactory = Callable[[str], LLM]
JudgeFactory = Callable[[str], EvaluatorJudge]


def _default_parsers() -> list[DocumentParser]:
    parsers: list[DocumentParser] = [TxtParser(), MarkdownParser()]
    try:
        from openrag_lab.adapters.parsers.pdf_pymupdf import PDFParser

        parsers.append(PDFParser())
    except Exception:  # noqa: S110 — PyMuPDF optional in test envs
        pass
    return parsers


def _default_chunkers() -> list[Chunker]:
    return [FixedChunker(), RecursiveChunker()]


def _default_embedder_factory(embedder_id: str) -> Embedder:
    from openrag_lab.adapters.embedders.sentence_transformers_embedder import (
        SentenceTransformerEmbedder,
    )

    embedder: Embedder = SentenceTransformerEmbedder(model_id=embedder_id)
    return embedder


def _default_vector_store_factory(workspace_id: WorkspaceId, persist_dir: Path) -> VectorStore:
    # Imported lazily — chromadb pulls many transitive deps on import.
    from openrag_lab.adapters.vector_stores.chroma import ChromaVectorStore

    del workspace_id
    return ChromaVectorStore(persist_dir)


def _default_llm_factory(llm_id: str) -> LLM:
    from openrag_lab.adapters.llms.null import NullLLM

    del llm_id
    return NullLLM()


def _default_judge_factory(judge_llm_id: str) -> EvaluatorJudge:
    from openrag_lab.adapters.evaluators.llm_judge import LLMJudge

    return LLMJudge(_default_llm_factory(judge_llm_id))


@dataclass
class RuntimeFactories:
    """User-overridable factories that pick which heavy adapters to build."""

    embedder: EmbedderFactory
    vector_store: VectorStoreFactory
    llm: LLMFactory
    judge: JudgeFactory


def default_factories() -> RuntimeFactories:
    return RuntimeFactories(
        embedder=_default_embedder_factory,
        vector_store=_default_vector_store_factory,
        llm=_default_llm_factory,
        judge=_default_judge_factory,
    )


@dataclass
class WorkspaceRuntime:
    """Assembled adapters + repositories for a single workspace."""

    workspace_id: WorkspaceId
    conn: sqlite3.Connection
    parsers: list[DocumentParser]
    chunkers: list[Chunker]
    embedder: Embedder
    vector_store: VectorStore
    chunk_repo: ChunkRepository
    document_repo: DocumentRepository
    experiment_repo: ExperimentRepository
    checkpoint_repo: IndexingCheckpointRepository

    def close(self) -> None:
        self.conn.close()


def build_runtime(
    *,
    registry: WorkspaceRegistry,
    workspace_id: WorkspaceId,
    embedder_id: str,
    factories: RuntimeFactories,
) -> WorkspaceRuntime:
    """Open a connection + assemble all adapters for the given workspace."""
    paths = registry.paths_for(workspace_id)
    conn = connect(paths.db)
    return WorkspaceRuntime(
        workspace_id=workspace_id,
        conn=conn,
        parsers=_default_parsers(),
        chunkers=_default_chunkers(),
        embedder=factories.embedder(embedder_id),
        vector_store=factories.vector_store(workspace_id, paths.vectors_dir),
        chunk_repo=ChunkRepository(conn),
        document_repo=DocumentRepository(conn),
        experiment_repo=ExperimentRepository(conn),
        checkpoint_repo=IndexingCheckpointRepository(conn),
    )
