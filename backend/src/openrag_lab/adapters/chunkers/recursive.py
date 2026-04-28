"""Semantic-boundary-aware recursive chunker.

Splits each page into "atomic" pieces by trying separators in order
(paragraphs → lines → sentences → words → character runs), then merges
adjacent pieces into chunks of at most ``chunk_size`` tokens with
``chunk_overlap`` tail-overlap between consecutive chunks.

This mirrors LangChain's ``RecursiveCharacterTextSplitter`` in spirit
but is implemented from scratch to avoid the dependency.
"""

from __future__ import annotations

from openrag_lab.adapters.chunkers._token import token_count
from openrag_lab.domain.models.chunk import (
    Chunk,
    ChunkingConfig,
    ChunkMetadata,
    ChunkPreview,
)
from openrag_lab.domain.models.document import ParsedDocument
from openrag_lab.domain.models.enums import ChunkingStrategy
from openrag_lab.domain.models.ids import new_chunk_id

# Order matters: try the largest semantic unit first. The trailing ``""``
# means "fall back to character-level slicing" when nothing else fits.
_SEPARATORS: tuple[str, ...] = (
    "\n\n",  # paragraphs
    "\n",  # hard line breaks
    ". ",  # English sentence ends
    "다. ",  # Korean declarative sentence ends
    "다.\n",
    " ",  # words
    "",  # raw char windows — last resort
)


def _split_by(text: str, sep: str) -> list[str]:
    """Split keeping the separator attached to the *trailing* piece.

    For ``sep="\\n\\n"`` and text ``"para1\\n\\npara2"`` this returns
    ``["para1\\n\\n", "para2"]`` — every reassembly preserves the
    original byte sequence exactly.
    """
    if sep == "":
        # Character chunking handled by the caller.
        return [text]
    parts = text.split(sep)
    out: list[str] = []
    for i, p in enumerate(parts):
        if i < len(parts) - 1:
            out.append(p + sep)
        else:
            out.append(p)
    # Drop empty leading/trailing artifacts but keep order.
    return [p for p in out if p != ""]


def _split_recursive(text: str, separators: tuple[str, ...], chunk_size: int) -> list[str]:
    """Return a list of pieces, each <= chunk_size tokens, in source order."""
    if token_count(text) <= chunk_size:
        return [text] if text else []

    if not separators:
        # Hard fallback — slice by characters at ~4 chars per token.
        slice_chars = max(1, chunk_size * 4)
        return [text[i : i + slice_chars] for i in range(0, len(text), slice_chars)]

    sep, *rest = separators
    rest_tuple = tuple(rest)

    if sep == "":
        # Final separator: char-level slicing (handled above by recursing with rest=()).
        return _split_recursive(text, (), chunk_size)

    pieces: list[str] = []
    for part in _split_by(text, sep):
        if token_count(part) <= chunk_size:
            if part:
                pieces.append(part)
        else:
            pieces.extend(_split_recursive(part, rest_tuple, chunk_size))
    return pieces


def _merge_with_overlap(
    pieces: list[str],
    chunk_size: int,
    chunk_overlap: int,
) -> list[str]:
    """Greedy pack pieces; carry the trailing N tokens forward as overlap."""
    chunks: list[str] = []
    buf: list[str] = []
    buf_tokens = 0

    for piece in pieces:
        piece_tokens = token_count(piece)
        if buf and buf_tokens + piece_tokens > chunk_size:
            chunks.append("".join(buf))
            # Build overlap tail from the buffer.
            tail: list[str] = []
            tail_tokens = 0
            for back in reversed(buf):
                back_tokens = token_count(back)
                if tail_tokens + back_tokens > chunk_overlap:
                    break
                tail.insert(0, back)
                tail_tokens += back_tokens
            buf = tail
            buf_tokens = tail_tokens
        buf.append(piece)
        buf_tokens += piece_tokens

    if buf:
        chunks.append("".join(buf))
    return chunks


class RecursiveChunker:
    """Chunker for ``ChunkingStrategy.RECURSIVE``."""

    @property
    def strategy(self) -> ChunkingStrategy:
        return ChunkingStrategy.RECURSIVE

    def _chunk_page_text(
        self,
        page_text: str,
        chunk_size: int,
        chunk_overlap: int,
    ) -> list[tuple[str, int]]:
        """Return ``[(chunk_text, char_offset_in_page), ...]``."""
        pieces = _split_recursive(page_text, _SEPARATORS, chunk_size)
        merged = _merge_with_overlap(pieces, chunk_size, chunk_overlap)

        out: list[tuple[str, int]] = []
        cursor = 0
        for chunk_text in merged:
            offset = page_text.find(chunk_text, cursor)
            if offset == -1:
                # Recovery: search from the start (overlap may have moved cursor past).
                offset = page_text.find(chunk_text, 0)
            if offset == -1:
                # Should not happen — every chunk is a substring by construction.
                offset = cursor
            out.append((chunk_text, offset))
            # Advance just past the start of this chunk so overlap is allowed.
            cursor = offset + 1
        return out

    async def chunk(
        self,
        parsed: ParsedDocument,
        config: ChunkingConfig,
    ) -> tuple[Chunk, ...]:
        if config.strategy is not ChunkingStrategy.RECURSIVE:
            raise ValueError(
                f"RecursiveChunker received strategy={config.strategy.value}",
            )

        cfg_key = config.cache_key()
        sequence = 0
        out: list[Chunk] = []

        for page in parsed.pages:
            for content, offset in self._chunk_page_text(
                page.text, config.chunk_size, config.chunk_overlap
            ):
                meta = ChunkMetadata(
                    page_number=page.page_number,
                    char_offset=offset,
                    char_length=len(content),
                )
                out.append(
                    Chunk(
                        id=new_chunk_id(),
                        document_id=parsed.document_id,
                        sequence=sequence,
                        content=content,
                        token_count=token_count(content),
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
        previews: list[ChunkPreview] = []
        for sequence, (content, offset) in enumerate(
            self._chunk_page_text(text, config.chunk_size, config.chunk_overlap)
        ):
            if sequence >= max_chunks:
                break
            previews.append(
                ChunkPreview(
                    sequence=sequence,
                    content=content,
                    char_offset=offset,
                    char_length=len(content),
                )
            )
        return tuple(previews)


# Re-exports for tests and adapter-internal helpers.
SEPARATORS = _SEPARATORS
split_recursive = _split_recursive
merge_with_overlap = _merge_with_overlap
