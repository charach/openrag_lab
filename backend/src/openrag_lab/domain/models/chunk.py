"""Chunk model + chunking configuration with deterministic cache key.

The cache key feeds the parsed/chunked/embedded checkpoint chain
(ARCHITECTURE_v3.md §8.3). Two configs that differ in any field that
affects chunk content MUST produce different keys; configs that differ
only in irrelevant ordering MUST produce the same key.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from openrag_lab.domain.models.enums import ChunkingStrategy
from openrag_lab.domain.models.ids import ChunkId, DocumentId

# Bounds mirror docs/CONFIG_SCHEMA.md §4.3.1 + §7.2.
MIN_CHUNK_SIZE = 32
MAX_CHUNK_SIZE = 4096


class ChunkingConfig(BaseModel):
    """Configuration that fully determines how a parsed document is split."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    strategy: ChunkingStrategy
    chunk_size: int = Field(ge=MIN_CHUNK_SIZE, le=MAX_CHUNK_SIZE)
    chunk_overlap: int = Field(default=0, ge=0)
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("chunk_overlap")
    @classmethod
    def _overlap_at_most_half(cls, v: int, info: Any) -> int:
        chunk_size = info.data.get("chunk_size")
        if chunk_size is not None and v > chunk_size // 2:
            raise ValueError(
                f"chunk_overlap ({v}) must be <= chunk_size/2 ({chunk_size // 2})",
            )
        return v

    def cache_key(self) -> str:
        """Deterministic 16-char hash. Stable across processes and OSes.

        The serialization is JSON with sorted keys so dict ordering does
        not leak into the hash.
        """
        payload = {
            "strategy": self.strategy.value,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "extra": self.extra,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()[:16]


class ChunkMetadata(BaseModel):
    """Metadata attached to a chunk, persisted as JSON in the chunk row."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    page_number: int | None = Field(default=None, ge=1)
    section_path: tuple[str, ...] = Field(default_factory=tuple)
    char_offset: int = Field(default=0, ge=0)
    char_length: int = Field(default=0, ge=0)


class Chunk(BaseModel):
    """A retrievable unit of text produced by a Chunker adapter."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: ChunkId
    document_id: DocumentId
    sequence: int = Field(ge=0)
    content: str
    token_count: int = Field(ge=0)
    metadata: ChunkMetadata
    chunk_config_key: str = Field(min_length=16, max_length=16)


class ChunkPreview(BaseModel):
    """Lightweight chunk view for the chunking lab UI (no ID, no token count)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    sequence: int = Field(ge=0)
    content: str
    char_offset: int = Field(ge=0)
    char_length: int = Field(ge=0)
