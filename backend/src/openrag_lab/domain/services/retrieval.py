"""RetrievalService — query → ranked chunks (Dense only for P0).

Reference: docs/ARCHITECTURE_v3.md §6.2. Sparse and Hybrid are P1.
"""

from __future__ import annotations

import time
from typing import Protocol

from openrag_lab.domain.errors import OpenRagError
from openrag_lab.domain.models.chunk import Chunk
from openrag_lab.domain.models.enums import RetrievalStrategy
from openrag_lab.domain.models.ids import ChunkId, DocumentId
from openrag_lab.domain.models.retrieval import (
    Query,
    RetrievalResult,
    RetrievedChunk,
)
from openrag_lab.domain.ports.embedder import Embedder
from openrag_lab.domain.ports.vector_store import VectorStore
from openrag_lab.domain.services.indexing import collection_name


class ChunkLookup(Protocol):
    """Slice of ``ChunkRepository`` we need."""

    def list_for_document(self, document_id: DocumentId, chunk_config_key: str) -> list[Chunk]: ...


class RetrievalService:
    """Dense retrieval — embed query, ANN-search, hydrate ``Chunk``s."""

    def __init__(
        self,
        *,
        embedder: Embedder,
        vector_store: VectorStore,
        chunk_lookup_by_id: dict[ChunkId, Chunk] | None = None,
    ) -> None:
        self._embedder = embedder
        self._vector_store = vector_store
        # Optional cache: tests can pre-populate to avoid a real DB.
        self._lookup = dict(chunk_lookup_by_id) if chunk_lookup_by_id else None

    def register_chunks(self, chunks: list[Chunk]) -> None:
        """Add ``chunks`` to the in-memory hydration map."""
        if self._lookup is None:
            self._lookup = {}
        for c in chunks:
            self._lookup[c.id] = c

    async def retrieve(self, query: Query) -> RetrievalResult:
        if self._lookup is None:
            raise OpenRagError(
                "RetrievalService has no chunk lookup configured",
                code="CONFIG_VALIDATION_FAILED",
            )
        t0 = time.perf_counter()
        qv = await self._embedder.embed_query(query.text)
        collection = collection_name(self._embedder.model_id, self._embedder.dim)
        hits = await self._vector_store.search(
            collection=collection,
            query_vector=qv,
            top_k=query.top_k,
            filters=query.filters or None,
        )
        retrieved: list[RetrievedChunk] = []
        for rank, hit in enumerate(hits):
            chunk = self._lookup.get(hit.chunk_id)
            if chunk is None:
                # Drift between vector store and chunk repo — skip rather than crash.
                continue
            retrieved.append(RetrievedChunk(chunk=chunk, score=hit.score, rank=rank))
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return RetrievalResult(
            query=query,
            retrieved=tuple(retrieved),
            strategy=RetrievalStrategy.DENSE,
            latency_ms=latency_ms,
        )
