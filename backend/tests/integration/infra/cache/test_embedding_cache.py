"""EmbeddingCache — chunk_id+model+version key, vector round-trip."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from openrag_lab.domain.models.ids import new_chunk_id
from openrag_lab.infra.cache.embedding_cache import EmbeddingCache, make_embedding


def _vec(dim: int = 8, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.standard_normal(dim).astype("float32")


def test_miss_returns_none(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    assert cache.get(new_chunk_id(), "model", "v1") is None


def test_round_trip_preserves_vector(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(
        chunk_id=chunk_id,
        vector=_vec(),
        model_id="bge-m3",
        model_version="2024-01-01",
    )
    cache.put(emb)

    out = cache.get(chunk_id, "bge-m3", "2024-01-01")
    assert out is not None
    np.testing.assert_array_equal(out.vector, emb.vector)
    assert out.model_id == emb.model_id
    assert out.model_version == emb.model_version
    assert out.chunk_id == emb.chunk_id


def test_model_version_change_invalidates_entry(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(
        chunk_id=chunk_id,
        vector=_vec(),
        model_id="bge-m3",
        model_version="2024-01-01",
    )
    cache.put(emb)
    assert cache.get(chunk_id, "bge-m3", "2024-12-01") is None


def test_model_id_change_invalidates_entry(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(
        chunk_id=chunk_id,
        vector=_vec(),
        model_id="bge-m3",
        model_version="v1",
    )
    cache.put(emb)
    assert cache.get(chunk_id, "different-model", "v1") is None


def test_corrupted_vector_treated_as_miss(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(chunk_id=chunk_id, vector=_vec(), model_id="m", model_version="v1")
    cache.put(emb)

    key = cache.key_for(chunk_id, "m", "v1")
    (tmp_path / key[:2] / f"{key}.npy").write_bytes(b"not a numpy file")
    assert cache.get(chunk_id, "m", "v1") is None


def test_missing_sidecar_treated_as_miss(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(chunk_id=chunk_id, vector=_vec(), model_id="m", model_version="v1")
    cache.put(emb)

    key = cache.key_for(chunk_id, "m", "v1")
    (tmp_path / key[:2] / f"{key}.json").unlink()
    assert cache.get(chunk_id, "m", "v1") is None


def test_evict_removes_both_files(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(chunk_id=chunk_id, vector=_vec(), model_id="m", model_version="v1")
    cache.put(emb)
    assert cache.evict(chunk_id, "m", "v1") is True
    assert cache.evict(chunk_id, "m", "v1") is False


def test_high_dim_vector_round_trips(tmp_path: Path) -> None:
    cache = EmbeddingCache(tmp_path)
    chunk_id = new_chunk_id()
    emb = make_embedding(
        chunk_id=chunk_id,
        vector=_vec(dim=1024),
        model_id="m",
        model_version="v1",
    )
    cache.put(emb)
    out = cache.get(chunk_id, "m", "v1")
    assert out is not None
    assert out.dim == 1024
