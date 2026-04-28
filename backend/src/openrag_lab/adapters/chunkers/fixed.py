"""Fixed-window chunker.

Walks each parsed page in token windows of ``chunk_size`` with stride
``chunk_size - chunk_overlap``. Original whitespace and ordering are
preserved by slicing the source text at token char-offsets rather than
re-joining tokens.

Page boundaries are respected — no chunk spans two pages, so citations
keep an unambiguous page number.
"""

from __future__ import annotations

from openrag_lab.adapters.chunkers._token import token_offsets
from openrag_lab.domain.models.chunk import (
    Chunk,
    ChunkingConfig,
    ChunkMetadata,
    ChunkPreview,
)
from openrag_lab.domain.models.document import ParsedDocument
from openrag_lab.domain.models.enums import ChunkingStrategy
from openrag_lab.domain.models.ids import new_chunk_id


def _windows(n_tokens: int, size: int, overlap: int) -> list[tuple[int, int]]:
    """Half-open ``[start, end)`` windows over the token index space."""
    if n_tokens == 0:
        return []
    stride = max(1, size - overlap)
    out: list[tuple[int, int]] = []
    i = 0
    while i < n_tokens:
        end = min(i + size, n_tokens)
        out.append((i, end))
        if end >= n_tokens:
            break
        i += stride
    return out


class FixedChunker:
    """Chunker for ``ChunkingStrategy.FIXED``."""

    @property
    def strategy(self) -> ChunkingStrategy:
        return ChunkingStrategy.FIXED

    async def chunk(
        self,
        parsed: ParsedDocument,
        config: ChunkingConfig,
    ) -> tuple[Chunk, ...]:
        if config.strategy is not ChunkingStrategy.FIXED:
            raise ValueError(
                f"FixedChunker received strategy={config.strategy.value}",
            )

        cfg_key = config.cache_key()
        sequence = 0
        out: list[Chunk] = []

        for page in parsed.pages:
            offsets = token_offsets(page.text)
            for start_tok, end_tok in _windows(
                len(offsets), config.chunk_size, config.chunk_overlap
            ):
                start_char = offsets[start_tok][0]
                end_char = offsets[end_tok - 1][1]
                content = page.text[start_char:end_char]
                meta = ChunkMetadata(
                    page_number=page.page_number,
                    char_offset=start_char,
                    char_length=end_char - start_char,
                )
                out.append(
                    Chunk(
                        id=new_chunk_id(),
                        document_id=parsed.document_id,
                        sequence=sequence,
                        content=content,
                        token_count=end_tok - start_tok,
                        metadata=meta,
                        chunk_config_key=cfg_key,
                    )
                )
                sequence += 1

        return tuple(out)

    async def preview(
        self,
        text: str,
        config: ChunkingConfig,
        max_chunks: int = 50,
    ) -> tuple[ChunkPreview, ...]:
        offsets = token_offsets(text)
        previews: list[ChunkPreview] = []
        for sequence, (start_tok, end_tok) in enumerate(
            _windows(len(offsets), config.chunk_size, config.chunk_overlap)
        ):
            if sequence >= max_chunks:
                break
            start_char = offsets[start_tok][0]
            end_char = offsets[end_tok - 1][1]
            previews.append(
                ChunkPreview(
                    sequence=sequence,
                    content=text[start_char:end_char],
                    char_offset=start_char,
                    char_length=end_char - start_char,
                )
            )
        return tuple(previews)
