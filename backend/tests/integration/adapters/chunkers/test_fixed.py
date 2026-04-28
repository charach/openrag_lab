"""FixedChunker — windowing math, page boundaries, preview.

ChunkingConfig enforces chunk_size in [32, 4096] (CONFIG_SCHEMA §4.3.1),
so behavioural tests use sizes >= 32. The pure ``_windows`` helper has
no such constraint and is exercised with small numbers for clarity.
"""

from __future__ import annotations

import pytest

from openrag_lab.adapters.chunkers._token import token_count
from openrag_lab.adapters.chunkers.fixed import FixedChunker, _windows
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import ChunkingStrategy

from ._helpers import make_tokens, parsed_from

# --- pure window math --------------------------------------------------------


def test_windows_empty_input_returns_no_windows() -> None:
    assert _windows(0, 5, 0) == []


def test_windows_no_overlap_yields_disjoint_ranges() -> None:
    assert _windows(10, 4, 0) == [(0, 4), (4, 8), (8, 10)]


def test_windows_with_overlap_advances_by_stride() -> None:
    # size=4, overlap=1 -> stride=3.
    assert _windows(10, 4, 1) == [(0, 4), (3, 7), (6, 10)]


def test_windows_size_equal_to_input_yields_one_window() -> None:
    assert _windows(5, 5, 0) == [(0, 5)]


def test_windows_size_larger_than_input_clamps_end() -> None:
    assert _windows(3, 10, 0) == [(0, 3)]


def test_windows_full_overlap_falls_back_to_stride_one() -> None:
    # overlap == size - 1 -> stride 1; overlap > size impossible per ChunkingConfig.
    # Loop terminates as soon as a window reaches the end, so we get only
    # two windows here, not one per starting index.
    assert _windows(5, 4, 3) == [(0, 4), (1, 5)]


# --- chunker behaviour -------------------------------------------------------


@pytest.fixture
def fixed_cfg() -> ChunkingConfig:
    return ChunkingConfig(
        strategy=ChunkingStrategy.FIXED,
        chunk_size=32,
        chunk_overlap=0,
    )


async def test_fixed_chunker_produces_expected_chunk_count(
    fixed_cfg: ChunkingConfig,
) -> None:
    # 80 tokens / 32 per chunk -> 3 windows: [0,32) [32,64) [64,80).
    parsed = parsed_from(make_tokens(80))
    chunks = await FixedChunker().chunk(parsed, fixed_cfg)
    assert len(chunks) == 3


async def test_fixed_chunker_preserves_original_whitespace(
    fixed_cfg: ChunkingConfig,
) -> None:
    # 32 tokens with mixed whitespace, then a sentinel suffix on the next window.
    head = "alpha   beta\tgamma\ndelta " + make_tokens(28, sep=" ")
    tail = " " + make_tokens(8, sep=" ")  # ensures more than one window
    parsed = parsed_from(head + tail)
    chunks = await FixedChunker().chunk(parsed, fixed_cfg)
    # First chunk covers the unusual-whitespace prefix verbatim.
    assert chunks[0].content.startswith("alpha   beta\tgamma\ndelta")


async def test_fixed_chunker_assigns_page_number_per_page(
    fixed_cfg: ChunkingConfig,
) -> None:
    parsed = parsed_from(make_tokens(40), make_tokens(40))
    chunks = await FixedChunker().chunk(parsed, fixed_cfg)
    pages = [c.metadata.page_number for c in chunks]
    assert 1 in pages and 2 in pages
    for chunk in chunks:
        assert "\x00" not in chunk.content


async def test_fixed_chunker_overlap_repeats_tail_tokens() -> None:
    cfg = ChunkingConfig(
        strategy=ChunkingStrategy.FIXED,
        chunk_size=32,
        chunk_overlap=16,  # stride = 16
    )
    parsed = parsed_from(make_tokens(64))
    chunks = await FixedChunker().chunk(parsed, cfg)
    # Windows: (0,32) (16,48) (32,64) -> 3 chunks.
    assert len(chunks) == 3
    # Last 16 tokens of chunk[0] equal first 16 tokens of chunk[1].
    tail0 = chunks[0].content.split()[-16:]
    head1 = chunks[1].content.split()[:16]
    assert tail0 == head1


async def test_fixed_chunker_token_count_matches_window_size() -> None:
    cfg = ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=32, chunk_overlap=0)
    parsed = parsed_from(make_tokens(50))
    chunks = await FixedChunker().chunk(parsed, cfg)
    assert chunks[0].token_count == 32
    assert chunks[-1].token_count == 18  # partial tail


async def test_fixed_chunker_skips_empty_pages(fixed_cfg: ChunkingConfig) -> None:
    parsed = parsed_from("", make_tokens(40))
    chunks = await FixedChunker().chunk(parsed, fixed_cfg)
    assert all(c.metadata.page_number == 2 for c in chunks)


async def test_fixed_chunker_records_cache_key_on_chunks(
    fixed_cfg: ChunkingConfig,
) -> None:
    parsed = parsed_from(make_tokens(40))
    chunks = await FixedChunker().chunk(parsed, fixed_cfg)
    assert all(c.chunk_config_key == fixed_cfg.cache_key() for c in chunks)


async def test_fixed_chunker_rejects_non_fixed_strategy() -> None:
    cfg = ChunkingConfig(strategy=ChunkingStrategy.RECURSIVE, chunk_size=64)
    parsed = parsed_from("hello world")
    with pytest.raises(ValueError, match="strategy"):
        await FixedChunker().chunk(parsed, cfg)


async def test_fixed_chunker_preview_caps_at_max_chunks(
    fixed_cfg: ChunkingConfig,
) -> None:
    long_text = make_tokens(500)  # plenty of windows at chunk_size=32
    previews = await FixedChunker().preview(long_text, fixed_cfg, max_chunks=5)
    assert len(previews) == 5


async def test_fixed_chunker_offsets_let_callers_recover_text(
    fixed_cfg: ChunkingConfig,
) -> None:
    page_text = make_tokens(40)
    parsed = parsed_from(page_text)
    chunks = await FixedChunker().chunk(parsed, fixed_cfg)
    for chunk in chunks:
        sliced = page_text[chunk.metadata.char_offset :][: chunk.metadata.char_length]
        assert sliced == chunk.content


# Sanity check — tests rely on the same approximation as the chunker.
def test_token_count_helper_matches_whitespace_split() -> None:
    assert token_count("a b c d") == 4
    assert token_count("  spaced  out  ") == 2
    assert token_count("") == 0
