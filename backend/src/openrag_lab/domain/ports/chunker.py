"""Chunker port — splits a ParsedDocument into Chunks per a ChunkingConfig.

Reference: docs/ARCHITECTURE_v3.md §7.2.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from openrag_lab.domain.models.chunk import Chunk, ChunkingConfig, ChunkPreview
from openrag_lab.domain.models.document import ParsedDocument
from openrag_lab.domain.models.enums import ChunkingStrategy


@runtime_checkable
class Chunker(Protocol):
    """Strategy-specific chunker.

    Each implementation declares its ``strategy`` and only handles configs
    with that strategy. The orchestrator (IndexingService) picks the right
    chunker by ``ChunkingConfig.strategy``.
    """

    @property
    def strategy(self) -> ChunkingStrategy: ...

    async def chunk(
        self,
        parsed: ParsedDocument,
        config: ChunkingConfig,
    ) -> tuple[Chunk, ...]: ...

    async def preview(
        self,
        text: str,
        config: ChunkingConfig,
        max_chunks: int = 50,
    ) -> tuple[ChunkPreview, ...]:
        """Produce a fast, no-cache preview for the chunking lab UI.

        ``max_chunks`` caps how many chunks are returned regardless of
        input size — the lab UI only renders what the user can see.
        """
        ...
