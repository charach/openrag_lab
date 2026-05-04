"""ChromaDB-backed ``VectorStore`` adapter.

ChromaDB is the production vector store for the MVP (PLATFORM.md §3.4).
Collections are created with the metric-mapped HNSW space; the metric
mapping mirrors the chromadb defaults:

  COSINE         -> "cosine"
  L2             -> "l2"
  INNER_PRODUCT  -> "ip"

The ``persist_directory`` path lives under the per-workspace cache root
(see ``WorkspacePaths.vectors_dir`` in ``infra/fs/workspace_layout``).
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np

from openrag_lab.domain.errors import OpenRagError
from openrag_lab.domain.models.enums import DistanceMetric
from openrag_lab.domain.models.ids import ChunkId
from openrag_lab.domain.ports.vector_store import (
    CollectionStats,
    VectorHit,
    VectorItem,
)

try:  # heavy dep
    import chromadb
    from chromadb.config import Settings

    _HAS_CHROMA = True
except ImportError:  # pragma: no cover
    _HAS_CHROMA = False


_METRIC_TO_CHROMA = {
    DistanceMetric.COSINE: "cosine",
    DistanceMetric.L2: "l2",
    DistanceMetric.INNER_PRODUCT: "ip",
}


class ChromaVectorStore:
    """Thin async wrapper over ``chromadb.PersistentClient``.

    All Chroma calls run via ``asyncio.to_thread`` so we don't block the
    event loop on disk I/O.
    """

    def __init__(self, persist_directory: Path) -> None:
        if not _HAS_CHROMA:
            raise OpenRagError(
                "chromadb is not installed.",
                code="VECTOR_BACKEND_UNAVAILABLE",
                recoverable=False,
            )
        persist_directory.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=str(persist_directory),
            settings=Settings(anonymized_telemetry=False, allow_reset=False),
        )
        self._metric_cache: dict[str, DistanceMetric] = {}

    async def create_collection(self, name: str, dim: int, metric: DistanceMetric) -> None:
        chroma_space = _METRIC_TO_CHROMA[metric]

        def _create() -> None:
            existing = self._client.list_collections()
            if any(c.name == name for c in existing):
                return
            self._client.create_collection(
                name=name,
                metadata={"hnsw:space": chroma_space, "openrag_dim": dim},
            )

        await asyncio.to_thread(_create)

    async def upsert(self, collection: str, items: list[VectorItem]) -> None:
        if not items:
            return
        col = await asyncio.to_thread(self._client.get_collection, collection)
        ids = [str(item.chunk_id) for item in items]
        embeddings: list[list[float]] = [item.vector.astype("float32").tolist() for item in items]
        # Chroma rejects empty dicts — fall back to a sentinel so upserts of
        # bare vectors still go through.
        metadatas: list[dict[str, Any]] = [
            _safe_metadata(item.metadata) or {"_": ""} for item in items
        ]
        await asyncio.to_thread(
            _chroma_upsert,
            col,
            ids,
            embeddings,
            metadatas,
        )

    async def search(
        self,
        collection: str,
        query_vector: np.ndarray,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorHit]:
        col = await asyncio.to_thread(self._client.get_collection, collection)
        metric = self._metric_for(collection, col)
        result = await asyncio.to_thread(
            col.query,
            query_embeddings=[query_vector.astype("float32").tolist()],
            n_results=top_k,
            where=filters or None,
        )
        ids_outer = result.get("ids") or [[]]
        ids = ids_outer[0]
        distances_outer = result.get("distances") or [[]]
        distances = distances_outer[0]
        metadatas_outer = result.get("metadatas") or [[{}] * len(ids)]
        metadatas = metadatas_outer[0] if metadatas_outer else [{}] * len(ids)
        out: list[VectorHit] = []
        for cid, dist, meta in zip(ids, distances, metadatas, strict=False):
            score = _distance_to_score(dist, metric)
            out.append(
                VectorHit(
                    chunk_id=ChunkId(cid),
                    score=score,
                    metadata=dict(meta or {}),
                )
            )
        return out

    def _metric_for(self, collection: str, col: Any) -> DistanceMetric:
        cached = self._metric_cache.get(collection)
        if cached is not None:
            return cached
        meta = col.metadata or {}
        space = meta.get("hnsw:space", "cosine")
        metric = _CHROMA_TO_METRIC.get(space, DistanceMetric.COSINE)
        self._metric_cache[collection] = metric
        return metric

    async def delete(self, collection: str, ids: list[ChunkId]) -> None:
        if not ids:
            return
        col = await asyncio.to_thread(self._client.get_collection, collection)
        await asyncio.to_thread(col.delete, ids=[str(c) for c in ids])

    async def stats(self, collection: str) -> CollectionStats:
        col = await asyncio.to_thread(self._client.get_collection, collection)
        count = await asyncio.to_thread(col.count)
        meta = col.metadata or {}
        space = meta.get("hnsw:space", "cosine")
        dim = int(meta.get("openrag_dim", 0))
        metric = _CHROMA_TO_METRIC.get(space, DistanceMetric.COSINE)
        return CollectionStats(name=collection, dim=dim, count=int(count), metric=metric)


_CHROMA_TO_METRIC = {v: k for k, v in _METRIC_TO_CHROMA.items()}


def _distance_to_score(dist: float | None, metric: DistanceMetric) -> float:
    """Map Chroma's distance to a "higher is better" score.

    Chroma always reports a distance (smaller = closer), but the conversion
    back to a similarity that fits the [0, 1]-ish range expected by the UI
    depends on the metric:

    * COSINE: dist = 1 - cos_sim, so the similarity is ``1 - dist``
      (typically ∈ [0, 1] when both vectors share orientation).
    * L2 / IP: there is no natural [0, 1] mapping, so we keep ``-dist``
      which preserves ranking but is non-positive.
    """
    if dist is None:
        return 0.0
    if metric is DistanceMetric.COSINE:
        return float(1.0 - dist)
    return float(-dist)


def _chroma_upsert(
    collection: Any,
    ids: list[str],
    embeddings: list[list[float]],
    metadatas: list[dict[str, Any]],
) -> None:
    """Trampoline around ``Collection.upsert`` so the type-checker isn't
    troubled by chromadb's huge metadata union type."""
    collection.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas)


def _safe_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    """Chroma rejects nested values — flatten by stringifying complex types."""
    out: dict[str, Any] = {}
    for k, v in metadata.items():
        if isinstance(v, str | int | float | bool) or v is None:
            out[k] = v
        else:
            out[k] = str(v)
    return out
