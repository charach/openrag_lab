"""In-memory ``VectorStore`` for tests and offline development.

Uses brute-force NumPy similarity — no faiss/chromadb dependency. Same
``VectorStore`` Protocol as the production ``ChromaVectorStore``.

Distance metric semantics:
* ``COSINE``  — score = 1 - cosine_distance (higher is better)
* ``L2``      — score = -L2_distance (higher is better)
* ``IP``      — score = inner_product (higher is better)
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
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


@dataclass
class _Collection:
    name: str
    dim: int
    metric: DistanceMetric
    rows: dict[ChunkId, tuple[np.ndarray, dict[str, Any]]] = field(default_factory=dict)


class InMemoryVectorStore:
    """Thread-safe enough for tests; not designed for production load."""

    def __init__(self) -> None:
        self._collections: dict[str, _Collection] = {}

    async def create_collection(self, name: str, dim: int, metric: DistanceMetric) -> None:
        if name in self._collections:
            existing = self._collections[name]
            if existing.dim != dim or existing.metric is not metric:
                raise OpenRagError(
                    f"collection {name!r} already exists with dim={existing.dim}"
                    f" metric={existing.metric.value}",
                    code="VECTOR_COLLECTION_MISMATCH",
                )
            return
        self._collections[name] = _Collection(name=name, dim=dim, metric=metric)

    async def upsert(self, collection: str, items: list[VectorItem]) -> None:
        col = self._must_get(collection)
        for item in items:
            if item.vector.shape != (col.dim,):
                raise OpenRagError(
                    f"vector dim {item.vector.shape[0]} != collection dim {col.dim}",
                    code="VECTOR_DIM_MISMATCH",
                )
            col.rows[item.chunk_id] = (item.vector.astype("float32"), dict(item.metadata))

    async def search(
        self,
        collection: str,
        query_vector: np.ndarray,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorHit]:
        col = self._must_get(collection)
        if query_vector.shape != (col.dim,):
            raise OpenRagError(
                f"query dim {query_vector.shape[0]} != collection dim {col.dim}",
                code="VECTOR_DIM_MISMATCH",
            )
        items = list(col.rows.items())
        if filters:
            items = [(cid, (v, m)) for cid, (v, m) in items if _matches(m, filters)]
        if not items:
            return []
        # Compute scores with a single matmul.
        ids = [cid for cid, _ in items]
        mat = np.stack([v for _, (v, _) in items])
        q = query_vector.astype("float32")
        scores = await asyncio.to_thread(_score, mat, q, col.metric)
        order = np.argsort(-scores)[:top_k]
        return [
            VectorHit(
                chunk_id=ids[int(i)],
                score=float(scores[int(i)]),
                metadata=items[int(i)][1][1],
            )
            for i in order
        ]

    async def delete(self, collection: str, ids: list[ChunkId]) -> None:
        col = self._must_get(collection)
        for cid in ids:
            col.rows.pop(cid, None)

    async def stats(self, collection: str) -> CollectionStats:
        col = self._must_get(collection)
        return CollectionStats(name=col.name, dim=col.dim, count=len(col.rows), metric=col.metric)

    def _must_get(self, name: str) -> _Collection:
        if name not in self._collections:
            raise OpenRagError(
                f"collection {name!r} does not exist",
                code="VECTOR_COLLECTION_NOT_FOUND",
            )
        return self._collections[name]


def _matches(metadata: dict[str, Any], filters: dict[str, Any]) -> bool:
    return all(metadata.get(k) == v for k, v in filters.items())


def _score(matrix: np.ndarray, query: np.ndarray, metric: DistanceMetric) -> np.ndarray:
    if metric is DistanceMetric.COSINE:
        m = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-12)
        q = query / (float(np.linalg.norm(query)) + 1e-12)
        return np.asarray(m @ q)
    if metric is DistanceMetric.INNER_PRODUCT:
        return np.asarray(matrix @ query)
    # L2 — closer is better, so we negate so larger == better.
    return np.asarray(-np.linalg.norm(matrix - query, axis=1))
