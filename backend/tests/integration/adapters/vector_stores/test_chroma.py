"""ChromaVectorStore — smoke test against the real chromadb backend."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from openrag_lab.domain.models.enums import DistanceMetric
from openrag_lab.domain.models.ids import new_chunk_id
from openrag_lab.domain.ports.vector_store import VectorItem

pytest.importorskip("chromadb")

from openrag_lab.adapters.vector_stores.chroma import ChromaVectorStore


def _vec(*xs: float) -> np.ndarray:
    return np.asarray(xs, dtype="float32")


async def test_round_trip(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    await store.create_collection("vectors_test", dim=3, metric=DistanceMetric.COSINE)
    a = new_chunk_id()
    b = new_chunk_id()
    await store.upsert(
        "vectors_test",
        [
            VectorItem(chunk_id=a, vector=_vec(1, 0, 0), metadata={"doc": "x"}),
            VectorItem(chunk_id=b, vector=_vec(0, 1, 0), metadata={"doc": "y"}),
        ],
    )
    hits = await store.search("vectors_test", _vec(1, 0, 0), top_k=2)
    assert hits[0].chunk_id == a


async def test_create_collection_is_idempotent(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    await store.create_collection("vectors_test", dim=2, metric=DistanceMetric.COSINE)
    await store.create_collection("vectors_test", dim=2, metric=DistanceMetric.COSINE)


async def test_stats_returns_counts(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    await store.create_collection("vectors_test", dim=2, metric=DistanceMetric.COSINE)
    stats_empty = await store.stats("vectors_test")
    assert stats_empty.count == 0
    await store.upsert("vectors_test", [VectorItem(chunk_id=new_chunk_id(), vector=_vec(1, 0))])
    stats_one = await store.stats("vectors_test")
    assert stats_one.count == 1


async def test_delete_removes_rows(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    await store.create_collection("vectors_test", dim=2, metric=DistanceMetric.COSINE)
    a = new_chunk_id()
    await store.upsert("vectors_test", [VectorItem(chunk_id=a, vector=_vec(1, 0))])
    await store.delete("vectors_test", [a])
    stats = await store.stats("vectors_test")
    assert stats.count == 0
