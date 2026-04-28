"""Embedding model.

We treat ``numpy.ndarray`` as a domain-allowable type — vectors are at the
heart of retrieval and pretending otherwise just adds wrapping overhead
(see CONTRIBUTING.md §2.3).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator

from openrag_lab.domain.models.ids import ChunkId


class Embedding(BaseModel):
    """A single vector tied to the chunk it represents."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    chunk_id: ChunkId
    vector: np.ndarray
    model_id: str
    model_version: str
    created_at: datetime

    @field_validator("vector")
    @classmethod
    def _vector_is_1d_float(cls, v: Any) -> np.ndarray:
        if not isinstance(v, np.ndarray):
            raise TypeError(f"vector must be np.ndarray, got {type(v).__name__}")
        if v.ndim != 1:
            raise ValueError(f"vector must be 1-D, got shape {v.shape}")
        if v.dtype.kind != "f":
            raise ValueError(f"vector dtype must be floating, got {v.dtype}")
        return v

    @property
    def dim(self) -> int:
        return int(self.vector.shape[0])


class EmbeddingBatch(BaseModel):
    """Multiple embeddings batched together. Order matches the input chunks."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    items: tuple[Embedding, ...] = Field(min_length=1)

    @property
    def dim(self) -> int:
        return self.items[0].dim

    @field_validator("items")
    @classmethod
    def _all_same_dim(cls, v: tuple[Embedding, ...]) -> tuple[Embedding, ...]:
        if len(v) == 0:
            return v
        first_dim = v[0].dim
        for i, emb in enumerate(v[1:], start=1):
            if emb.dim != first_dim:
                raise ValueError(
                    f"all embeddings must share dim; item 0 has {first_dim}, "
                    f"item {i} has {emb.dim}",
                )
        return v
