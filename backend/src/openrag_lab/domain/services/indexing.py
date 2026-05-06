"""IndexingService — orchestrate parse → chunk → embed → upsert.

Reference: docs/ARCHITECTURE_v3.md §6.1.

Behaviours:

* **Per-document checkpointing.** Each document's progress is tracked
  through ``PARSED → CHUNKED → EMBEDDED``; resuming a partially
  completed run skips already-finished stages.
* **Partial failure isolation.** If one document raises ``ParseError``
  the run continues for the rest, and the failure is recorded in the
  returned ``IndexingReport``.
* **Cooperative cancellation.** A ``CancellationToken`` is checked
  before every document and between stages; cancellation preserves
  the checkpoints so a later run can resume.

The service is *strictly* domain logic — it depends only on ports and
domain repositories. The application layer wires concrete adapters in.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from openrag_lab.domain.errors import OpenRagError, ParseError
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DistanceMetric, IndexingStage
from openrag_lab.domain.models.experiment import ExperimentConfig
from openrag_lab.domain.models.ids import DocumentId, WorkspaceId
from openrag_lab.domain.ports.chunker import Chunker
from openrag_lab.domain.ports.embedder import Embedder
from openrag_lab.domain.ports.parser import DocumentParser
from openrag_lab.domain.ports.vector_store import VectorItem, VectorStore
from openrag_lab.domain.services.cancellation import CancellationToken
from openrag_lab.domain.services.progress import (
    NullProgressReporter,
    ProgressReporter,
)


@dataclass
class IndexingReport:
    """Outcome of a single ``IndexingService.run`` call."""

    workspace_id: WorkspaceId
    config_fingerprint: str
    indexed: list[DocumentId] = field(default_factory=list)
    skipped: list[DocumentId] = field(default_factory=list)
    failed: list[tuple[DocumentId, str]] = field(default_factory=list)
    chunks_written: int = 0
    cancelled: bool = False


class IndexingCheckpointPort(Protocol):
    """Minimal slice of ``IndexingCheckpointRepository`` we need."""

    def upsert(
        self,
        *,
        workspace_id: WorkspaceId,
        document_id: DocumentId,
        config_fingerprint: str,
        status: IndexingStage,
        updated_at: datetime | None = None,
    ) -> None: ...

    def get(
        self,
        *,
        workspace_id: WorkspaceId,
        document_id: DocumentId,
        config_fingerprint: str,
    ) -> tuple[IndexingStage, datetime] | None: ...


class ChunkSink(Protocol):
    """Slice of ``ChunkRepository`` used by indexing."""

    def add_many(self, chunks: Sequence[object]) -> int: ...

    def list_for_document(self, document_id: DocumentId, chunk_config_key: str) -> list[object]: ...

    def count_for_document(self, document_id: DocumentId, chunk_config_key: str) -> int: ...


def collection_name(embedder_id: str, dim: int) -> str:
    """``vectors_<short>_<dim>``  — partitioned by embedder dim (ARCH §13-4)."""
    short = "".join(c for c in embedder_id if c.isalnum() or c in "-_")[:16] or "model"
    return f"vectors_{short}_{dim}"


class IndexingService:
    def __init__(
        self,
        *,
        parsers: list[DocumentParser],
        chunkers: list[Chunker],
        embedder: Embedder,
        vector_store: VectorStore,
        chunk_repo: ChunkSink,
        checkpoint_repo: IndexingCheckpointPort,
        metric: DistanceMetric = DistanceMetric.COSINE,
    ) -> None:
        self._parsers = parsers
        self._chunkers = chunkers
        self._embedder = embedder
        self._vector_store = vector_store
        self._chunk_repo = chunk_repo
        self._checkpoint_repo = checkpoint_repo
        self._metric = metric

    async def run(
        self,
        *,
        workspace_id: WorkspaceId,
        documents: list[Document],
        config: ExperimentConfig,
        chunking: ChunkingConfig,
        token: CancellationToken | None = None,
        progress: ProgressReporter | None = None,
        topic: str = "",
    ) -> IndexingReport:
        token = token or CancellationToken()
        progress = progress or NullProgressReporter()
        chunker = self._pick_chunker(chunking)

        fp = config.fingerprint()
        collection = collection_name(self._embedder.model_id, self._embedder.dim)
        await self._vector_store.create_collection(
            collection, dim=self._embedder.dim, metric=self._metric
        )

        report = IndexingReport(workspace_id=workspace_id, config_fingerprint=fp)
        total = len(documents)
        for i, doc in enumerate(documents):
            try:
                token.raise_if_cancelled(stage="document")
            except OpenRagError:
                report.cancelled = True
                break

            current = self._checkpoint_repo.get(
                workspace_id=workspace_id, document_id=doc.id, config_fingerprint=fp
            )
            if current is not None and current[0] is IndexingStage.EMBEDDED:
                report.skipped.append(doc.id)
                chunks = self._chunk_repo.count_for_document(doc.id, chunking.cache_key())
                await progress.emit(
                    topic=topic, stage="skip", ratio=(i + 1) / total, message=str(doc.id)
                )
                await progress.emit_file(
                    topic=topic,
                    file_id=str(doc.id),
                    file_name=doc.source_path.name,
                    file_stage="skipped",
                    ratio=1.0,
                    chunks=chunks,
                )
                continue

            try:
                chunks_written = await self._index_one(
                    workspace_id=workspace_id,
                    doc=doc,
                    config_fingerprint=fp,
                    chunking=chunking,
                    chunker=chunker,
                    collection=collection,
                    token=token,
                    progress=progress,
                    topic=topic,
                )
            except ParseError as e:
                report.failed.append((doc.id, e.code))
                await progress.emit(
                    topic=topic, stage="failed", ratio=(i + 1) / total, message=e.code
                )
                await progress.emit_file(
                    topic=topic,
                    file_id=str(doc.id),
                    file_name=doc.source_path.name,
                    file_stage="failed",
                    ratio=1.0,
                    message=e.code,
                )
                continue
            except OpenRagError:
                report.cancelled = True
                break
            else:
                report.indexed.append(doc.id)
                report.chunks_written += chunks_written
                await progress.emit(
                    topic=topic, stage="indexed", ratio=(i + 1) / total, message=str(doc.id)
                )
                await progress.emit_file(
                    topic=topic,
                    file_id=str(doc.id),
                    file_name=doc.source_path.name,
                    file_stage="embedded",
                    ratio=1.0,
                    chunks=chunks_written,
                )

        return report

    def _pick_chunker(self, cfg: ChunkingConfig) -> Chunker:
        for ch in self._chunkers:
            if ch.strategy is cfg.strategy:
                return ch
        raise OpenRagError(
            f"no chunker registered for strategy={cfg.strategy.value}",
            code="CONFIG_VALIDATION_FAILED",
        )

    def _pick_parser(self, doc: Document) -> DocumentParser:
        for p in self._parsers:
            if p.supports(doc.format):
                return p
        raise ParseError(
            f"no parser supports format={doc.format.value}",
            code="PARSE_UNSUPPORTED_FORMAT",
            details={"format": doc.format.value},
        )

    async def _index_one(
        self,
        *,
        workspace_id: WorkspaceId,
        doc: Document,
        config_fingerprint: str,
        chunking: ChunkingConfig,
        chunker: Chunker,
        collection: str,
        token: CancellationToken,
        progress: ProgressReporter,
        topic: str,
    ) -> int:
        file_name = doc.source_path.name
        file_id = str(doc.id)

        # 1. parse
        await progress.emit_file(
            topic=topic, file_id=file_id, file_name=file_name, file_stage="parsing", ratio=0.0
        )
        parser = self._pick_parser(doc)
        parsed = await parser.parse(doc)
        token.raise_if_cancelled(stage="parsed")
        self._checkpoint_repo.upsert(
            workspace_id=workspace_id,
            document_id=doc.id,
            config_fingerprint=config_fingerprint,
            status=IndexingStage.PARSED,
            updated_at=datetime.now(UTC),
        )

        # 2. chunk (skip persistence if already chunked at this config)
        await progress.emit_file(
            topic=topic, file_id=file_id, file_name=file_name, file_stage="chunking", ratio=0.33
        )
        cfg_key = chunking.cache_key()
        existing = self._chunk_repo.list_for_document(doc.id, cfg_key)
        if existing:
            chunks = existing
        else:
            chunks = list(await chunker.chunk(parsed, chunking))
            self._chunk_repo.add_many(chunks)
        token.raise_if_cancelled(stage="chunked")
        self._checkpoint_repo.upsert(
            workspace_id=workspace_id,
            document_id=doc.id,
            config_fingerprint=config_fingerprint,
            status=IndexingStage.CHUNKED,
            updated_at=datetime.now(UTC),
        )

        # 3. embed
        await progress.emit_file(
            topic=topic,
            file_id=file_id,
            file_name=file_name,
            file_stage="embedding",
            ratio=0.66,
            chunks=len(chunks),
        )
        texts = [c.content for c in chunks]  # type: ignore[attr-defined]
        vectors = await self._embedder.embed_documents(texts)
        token.raise_if_cancelled(stage="embedded")

        # 4. upsert
        items = [
            VectorItem(
                chunk_id=c.id,  # type: ignore[attr-defined]
                vector=v,
                metadata={
                    "document_id": str(doc.id),
                    "page": getattr(c.metadata, "page_number", None),  # type: ignore[attr-defined]
                    "sequence": c.sequence,  # type: ignore[attr-defined]
                },
            )
            for c, v in zip(chunks, vectors, strict=True)
        ]
        await self._vector_store.upsert(collection, items)
        self._checkpoint_repo.upsert(
            workspace_id=workspace_id,
            document_id=doc.id,
            config_fingerprint=config_fingerprint,
            status=IndexingStage.EMBEDDED,
            updated_at=datetime.now(UTC),
        )
        return len(chunks)
