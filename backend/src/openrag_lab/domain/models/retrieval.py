"""Retrieval-time models: Query and the result objects."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.chunk import Chunk
from openrag_lab.domain.models.enums import RetrievalStrategy


class Query(BaseModel):
    """A user question to be answered against the indexed corpus."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    text: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)
    filters: dict[str, Any] = Field(default_factory=dict)


class RetrievedChunk(BaseModel):
    """A chunk plus the score and rank assigned by retrieval."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    chunk: Chunk
    score: float
    rank: int = Field(ge=0)


class RetrievalResult(BaseModel):
    """Output of a retrieval call: ranked chunks + provenance."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    query: Query
    retrieved: tuple[RetrievedChunk, ...]
    strategy: RetrievalStrategy
    latency_ms: int = Field(ge=0)
