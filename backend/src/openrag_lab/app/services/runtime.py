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

import httpx

from openrag_lab.adapters.chunkers.fixed import FixedChunker
from openrag_lab.adapters.chunkers.recursive import RecursiveChunker
from openrag_lab.adapters.parsers.markdown import MarkdownParser
from openrag_lab.adapters.parsers.txt import TxtParser
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.config.settings import ExternalSettings
from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.external import (
    ExternalProvider,
    is_external_llm_id,
    parse_external_llm_id,
)
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
from openrag_lab.infra.external.keystore import Keystore

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


def _build_external_llm(
    ref_provider: ExternalProvider,
    *,
    model: str,
    api_key: str,
    client: httpx.AsyncClient,
) -> LLM:
    if ref_provider is ExternalProvider.OPENAI:
        from openrag_lab.adapters.llms.openai import OpenAILLM

        return OpenAILLM(model=model, api_key=api_key, client=client)
    if ref_provider is ExternalProvider.ANTHROPIC:
        from openrag_lab.adapters.llms.anthropic import AnthropicLLM

        return AnthropicLLM(model=model, api_key=api_key, client=client)
    if ref_provider is ExternalProvider.GEMINI:
        from openrag_lab.adapters.llms.gemini import GeminiLLM

        return GeminiLLM(model=model, api_key=api_key, client=client)
    if ref_provider is ExternalProvider.OPENROUTER:
        from openrag_lab.adapters.llms.openrouter import OpenRouterLLM

        return OpenRouterLLM(model=model, api_key=api_key, client=client)
    raise ConfigurationError(
        f"지원하지 않는 외부 제공자입니다: {ref_provider!r}.",
        code="EXTERNAL_PROVIDER_UNKNOWN",
        recoverable=False,
        details={"provider_id": str(ref_provider)},
    )


def make_external_llm_factory(
    *,
    keystore: Keystore,
    external_settings: ExternalSettings,
    http_client: httpx.AsyncClient,
) -> LLMFactory:
    """Build an LLM factory that routes ``external:<provider>:<model>`` ids.

    Non-external ids fall back to ``NullLLM`` (retrieval-only mode), so the
    factory remains a drop-in replacement for ``_default_llm_factory``.
    """
    from openrag_lab.adapters.llms.null import NullLLM

    def factory(llm_id: str) -> LLM:
        if not llm_id or not is_external_llm_id(llm_id):
            return NullLLM()
        ref = parse_external_llm_id(llm_id)
        if not external_settings.allow_llm_api:
            raise ConfigurationError(
                "외부 LLM API 사용이 비활성화되어 있습니다.",
                code="EXTERNAL_API_NOT_ENABLED",
                recoverable=True,
                details={"attempted_llm_id": llm_id},
            )
        if ref.provider.value not in external_settings.allowed_providers:
            raise ConfigurationError(
                f"외부 제공자 '{ref.provider.value}'가 허용 목록에 없습니다.",
                code="EXTERNAL_PROVIDER_NOT_ALLOWED",
                recoverable=True,
                details={
                    "provider": ref.provider.value,
                    "allowed": list(external_settings.allowed_providers),
                },
            )
        api_key = keystore.require(ref.provider)
        return _build_external_llm(
            ref.provider, model=ref.model, api_key=api_key, client=http_client
        )

    return factory


def make_default_factories(
    *,
    keystore: Keystore,
    external_settings: ExternalSettings,
    http_client: httpx.AsyncClient,
) -> RuntimeFactories:
    """Production factories: external-LLM aware ``llm`` and ``judge``."""
    from openrag_lab.adapters.evaluators.llm_judge import LLMJudge

    llm_factory = make_external_llm_factory(
        keystore=keystore,
        external_settings=external_settings,
        http_client=http_client,
    )

    def judge_factory(judge_llm_id: str) -> EvaluatorJudge:
        return LLMJudge(llm_factory(judge_llm_id))

    return RuntimeFactories(
        embedder=_default_embedder_factory,
        vector_store=_default_vector_store_factory,
        llm=llm_factory,
        judge=judge_factory,
    )


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
