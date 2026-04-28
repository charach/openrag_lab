"""RecursiveChunker — separator priority, merging, overlap, preview.

ChunkingConfig enforces chunk_size in [32, 4096] (CONFIG_SCHEMA §4.3.1),
so behavioural tests use sizes >= 32. The pure ``split_recursive`` and
``merge_with_overlap`` helpers have no such constraint and are exercised
with small numbers for clarity.
"""

from __future__ import annotations

import pytest

from openrag_lab.adapters.chunkers._token import token_count
from openrag_lab.adapters.chunkers.recursive import (
    RecursiveChunker,
    merge_with_overlap,
    split_recursive,
)
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import ChunkingStrategy

from ._helpers import make_tokens, parsed_from

# --- pure split/merge --------------------------------------------------------


def test_split_recursive_returns_text_unchanged_when_already_small() -> None:
    out = split_recursive("hello world", ("\n\n", " ", ""), chunk_size=10)
    assert out == ["hello world"]


def test_split_recursive_breaks_on_first_separator_that_helps() -> None:
    text = "para one. " * 20 + "\n\n" + "para two. " * 20
    out = split_recursive(text, ("\n\n", "\n", ". ", " ", ""), chunk_size=30)
    assert all(token_count(p) <= 30 for p in out)


def test_split_recursive_falls_back_to_char_window_when_no_separator() -> None:
    # No newline or space in the text — every \S+ is its own token, but no
    # separator in the list matches. The "" separator triggers char-window
    # fallback at ~4 chars per token.
    text = "abc\tdef\tghi\t" * 10  # tabs are whitespace but not in separators
    out = split_recursive(text, ("\n\n", "\n", " ", ""), chunk_size=2)
    assert all(len(p) <= 8 for p in out)


def test_merge_packs_pieces_up_to_chunk_size() -> None:
    pieces = ["one ", "two ", "three ", "four "]  # 1 token each
    chunks = merge_with_overlap(pieces, chunk_size=2, chunk_overlap=0)
    assert chunks == ["one two ", "three four "]


def test_merge_carries_overlap_tokens_forward() -> None:
    pieces = ["one ", "two ", "three ", "four ", "five "]
    chunks = merge_with_overlap(pieces, chunk_size=3, chunk_overlap=1)
    # First chunk: one two three.  Tail = "three " (1 token) -> next starts with three.
    assert chunks[0].endswith("three ")
    assert chunks[1].startswith("three ")


# --- chunker behaviour -------------------------------------------------------


@pytest.fixture
def recursive_cfg() -> ChunkingConfig:
    return ChunkingConfig(
        strategy=ChunkingStrategy.RECURSIVE,
        chunk_size=64,
        chunk_overlap=16,
    )


async def test_recursive_chunker_emits_at_least_one_chunk(
    recursive_cfg: ChunkingConfig,
) -> None:
    parsed = parsed_from("Hello world. This is a short test passage.")
    chunks = await RecursiveChunker().chunk(parsed, recursive_cfg)
    assert len(chunks) >= 1


async def test_recursive_chunker_keeps_paragraphs_together_when_small_enough() -> None:
    cfg = ChunkingConfig(strategy=ChunkingStrategy.RECURSIVE, chunk_size=128, chunk_overlap=0)
    parsed = parsed_from("first short para.\n\nsecond short para.")
    chunks = await RecursiveChunker().chunk(parsed, cfg)
    # Both paragraphs together are well under 128 tokens.
    assert len(chunks) == 1
    assert "first" in chunks[0].content and "second" in chunks[0].content


async def test_recursive_chunker_splits_oversized_paragraph() -> None:
    cfg = ChunkingConfig(strategy=ChunkingStrategy.RECURSIVE, chunk_size=32, chunk_overlap=0)
    parsed = parsed_from(make_tokens(160))  # 160 tokens, 32 per chunk -> >=4 chunks
    chunks = await RecursiveChunker().chunk(parsed, cfg)
    assert len(chunks) >= 4
    assert all(c.token_count <= 32 for c in chunks)


async def test_recursive_chunker_respects_max_chunk_size_with_overlap(
    recursive_cfg: ChunkingConfig,
) -> None:
    parsed = parsed_from(make_tokens(200))
    chunks = await RecursiveChunker().chunk(parsed, recursive_cfg)
    assert all(c.token_count <= recursive_cfg.chunk_size for c in chunks)


async def test_recursive_chunker_preserves_korean_sentence_boundaries() -> None:
    cfg = ChunkingConfig(strategy=ChunkingStrategy.RECURSIVE, chunk_size=32, chunk_overlap=0)
    text = "첫 번째 문장 입니다. " * 15 + "두 번째 문장 입니다. " * 15
    parsed = parsed_from(text)
    chunks = await RecursiveChunker().chunk(parsed, cfg)
    rebuilt = "".join(c.content for c in chunks)
    assert "첫 번째" in rebuilt and "두 번째" in rebuilt


async def test_recursive_chunker_records_cache_key(
    recursive_cfg: ChunkingConfig,
) -> None:
    parsed = parsed_from("hello world. " * 30)
    chunks = await RecursiveChunker().chunk(parsed, recursive_cfg)
    assert all(c.chunk_config_key == recursive_cfg.cache_key() for c in chunks)


async def test_recursive_chunker_rejects_non_recursive_strategy() -> None:
    cfg = ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=64)
    parsed = parsed_from("hello")
    with pytest.raises(ValueError, match="strategy"):
        await RecursiveChunker().chunk(parsed, cfg)


async def test_recursive_chunker_preview_caps_at_max_chunks(
    recursive_cfg: ChunkingConfig,
) -> None:
    text = "alpha beta gamma delta. " * 100
    previews = await RecursiveChunker().preview(text, recursive_cfg, max_chunks=3)
    assert len(previews) == 3


async def test_recursive_chunker_handles_empty_page(
    recursive_cfg: ChunkingConfig,
) -> None:
    parsed = parsed_from("", make_tokens(80))
    chunks = await RecursiveChunker().chunk(parsed, recursive_cfg)
    assert all(c.metadata.page_number == 2 for c in chunks)
