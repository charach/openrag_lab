"""VectorStore port — vector + metadata persistence.

Collection naming convention (per docs/ARCHITECTURE_v3.md §13-4):
``vectors_<embedder_id_short>_<dim>`` — collections are partitioned by
embedding dimension so embedder swaps do not corrupt existing indices.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.enums import DistanceMetric
from openrag_lab.domain.models.ids import ChunkId


class VectorItem(BaseModel):
    """One row to upsert: id + vector + arbitrary scalar/string metadata."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    chunk_id: ChunkId
    vector: np.ndarray
    metadata: dict[str, Any] = Field(default_factory=dict)


class VectorHit(BaseModel):
    """One search hit. Score interpretation depends on the metric."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    chunk_id: ChunkId
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class CollectionStats(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    dim: int
    count: int = Field(ge=0)
    metric: DistanceMetric


@runtime_checkable
class VectorStore(Protocol):
    async def create_collection(
        self,
        name: str,
        dim: int,
        metric: DistanceMetric,
    ) -> None: ...

    async def upsert(self, collection: str, items: list[VectorItem]) -> None: ...

    async def search(
        self,
        collection: str,
        query_vector: np.ndarray,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorHit]: ...

    async def delete(self, collection: str, ids: list[ChunkId]) -> None: ...

    async def stats(self, collection: str) -> CollectionStats: ...
