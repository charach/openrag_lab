"""ChunkingConfig — cache_key determinism and validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from openrag_lab.domain.models.chunk import (
    MAX_CHUNK_SIZE,
    MIN_CHUNK_SIZE,
    ChunkingConfig,
)
from openrag_lab.domain.models.enums import ChunkingStrategy


def _cfg(**overrides: object) -> ChunkingConfig:
    base: dict[str, object] = {
        "strategy": ChunkingStrategy.RECURSIVE,
        "chunk_size": 512,
        "chunk_overlap": 64,
    }
    base.update(overrides)
    return ChunkingConfig(**base)  # type: ignore[arg-type]


# --- determinism -------------------------------------------------------------


def test_chunking_config_cache_key_same_for_equivalent_configs() -> None:
    a = _cfg()
    b = _cfg()
    assert a.cache_key() == b.cache_key()


def test_chunking_config_cache_key_stable_across_extra_dict_ordering() -> None:
    a = _cfg(extra={"a": 1, "b": 2, "c": 3})
    b = _cfg(extra={"c": 3, "b": 2, "a": 1})
    assert a.cache_key() == b.cache_key()


def test_chunking_config_cache_key_changes_with_chunk_size() -> None:
    assert _cfg(chunk_size=512).cache_key() != _cfg(chunk_size=768).cache_key()


def test_chunking_config_cache_key_changes_with_strategy() -> None:
    assert (
        _cfg(strategy=ChunkingStrategy.RECURSIVE).cache_key()
        != _cfg(strategy=ChunkingStrategy.FIXED).cache_key()
    )


def test_chunking_config_cache_key_changes_with_overlap() -> None:
    assert _cfg(chunk_overlap=0).cache_key() != _cfg(chunk_overlap=64).cache_key()


def test_chunking_config_cache_key_changes_with_extra() -> None:
    assert _cfg(extra={}).cache_key() != _cfg(extra={"x": 1}).cache_key()


def test_chunking_config_cache_key_is_16_lowercase_hex() -> None:
    key = _cfg().cache_key()
    assert len(key) == 16
    assert all(c in "0123456789abcdef" for c in key)


# --- validation --------------------------------------------------------------


def test_chunking_config_rejects_overlap_more_than_half_size() -> None:
    with pytest.raises(ValidationError, match="chunk_overlap"):
        ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE,
            chunk_size=512,
            chunk_overlap=300,
        )


def test_chunking_config_accepts_overlap_equal_to_half_size() -> None:
    # 512 / 2 = 256 — boundary value should be accepted.
    cfg = ChunkingConfig(
        strategy=ChunkingStrategy.RECURSIVE,
        chunk_size=512,
        chunk_overlap=256,
    )
    assert cfg.chunk_overlap == 256


def test_chunking_config_rejects_chunk_size_below_min() -> None:
    with pytest.raises(ValidationError):
        ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE,
            chunk_size=MIN_CHUNK_SIZE - 1,
        )


def test_chunking_config_rejects_chunk_size_above_max() -> None:
    with pytest.raises(ValidationError):
        ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE,
            chunk_size=MAX_CHUNK_SIZE + 1,
        )


def test_chunking_config_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE,
            chunk_size=512,
            chunkSize=512,  # type: ignore[call-arg]
        )


def test_chunking_config_is_frozen() -> None:
    cfg = _cfg()
    with pytest.raises(ValidationError):
        cfg.chunk_size = 1024  # type: ignore[misc]
