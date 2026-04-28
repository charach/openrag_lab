"""InMemoryVectorStore — protocol coverage + metric semantics."""

from __future__ import annotations

import numpy as np
import pytest

from openrag_lab.adapters.vector_stores.in_memory import InMemoryVectorStore
from openrag_lab.domain.errors import OpenRagError
from openrag_lab.domain.models.enums import DistanceMetric
from openrag_lab.domain.models.ids import ChunkId, new_chunk_id
from openrag_lab.domain.ports.vector_store import VectorItem


def _vec(*xs: float) -> np.ndarray:
    return np.asarray(xs, dtype="float32")


async def test_create_then_upsert_then_search_round_trip() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=3, metric=DistanceMetric.COSINE)
    a = new_chunk_id()
    b = new_chunk_id()
    await store.upsert(
        "c",
        [
            VectorItem(chunk_id=a, vector=_vec(1, 0, 0), metadata={"page": 1}),
            VectorItem(chunk_id=b, vector=_vec(0, 1, 0), metadata={"page": 2}),
        ],
    )
    hits = await store.search("c", _vec(1, 0, 0), top_k=2)
    assert hits[0].chunk_id == a
    assert hits[1].chunk_id == b
    assert hits[0].score >= hits[1].score


async def test_search_filters_by_metadata() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.COSINE)
    a = new_chunk_id()
    b = new_chunk_id()
    await store.upsert(
        "c",
        [
            VectorItem(chunk_id=a, vector=_vec(1, 0), metadata={"doc": "d1"}),
            VectorItem(chunk_id=b, vector=_vec(1, 0), metadata={"doc": "d2"}),
        ],
    )
    hits = await store.search("c", _vec(1, 0), top_k=5, filters={"doc": "d2"})
    assert len(hits) == 1
    assert hits[0].chunk_id == b


async def test_l2_returns_negative_score_so_higher_is_better() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.L2)
    near = new_chunk_id()
    far = new_chunk_id()
    await store.upsert(
        "c",
        [
            VectorItem(chunk_id=near, vector=_vec(0, 0)),
            VectorItem(chunk_id=far, vector=_vec(10, 10)),
        ],
    )
    hits = await store.search("c", _vec(0, 0), top_k=2)
    assert hits[0].chunk_id == near
    assert hits[0].score > hits[1].score  # higher == closer


async def test_inner_product_metric() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.INNER_PRODUCT)
    a = new_chunk_id()
    b = new_chunk_id()
    await store.upsert(
        "c",
        [
            VectorItem(chunk_id=a, vector=_vec(2, 0)),
            VectorItem(chunk_id=b, vector=_vec(1, 0)),
        ],
    )
    hits = await store.search("c", _vec(1, 0), top_k=2)
    assert hits[0].chunk_id == a
    assert hits[0].score == pytest.approx(2.0)


async def test_dim_mismatch_raises() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=3, metric=DistanceMetric.COSINE)
    with pytest.raises(OpenRagError):
        await store.upsert("c", [VectorItem(chunk_id=new_chunk_id(), vector=_vec(1, 2))])


async def test_search_unknown_collection_raises() -> None:
    store = InMemoryVectorStore()
    with pytest.raises(OpenRagError):
        await store.search("missing", _vec(1, 2), top_k=1)


async def test_delete_removes_specified_ids() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.COSINE)
    a = new_chunk_id()
    b = new_chunk_id()
    await store.upsert(
        "c",
        [
            VectorItem(chunk_id=a, vector=_vec(1, 0)),
            VectorItem(chunk_id=b, vector=_vec(0, 1)),
        ],
    )
    await store.delete("c", [a])
    stats = await store.stats("c")
    assert stats.count == 1


async def test_create_collection_idempotent_when_signature_matches() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.COSINE)
    await store.create_collection("c", dim=2, metric=DistanceMetric.COSINE)  # no error


async def test_create_collection_rejects_dim_change() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.COSINE)
    with pytest.raises(OpenRagError):
        await store.create_collection("c", dim=3, metric=DistanceMetric.COSINE)


async def test_empty_search_returns_empty_list() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.COSINE)
    hits = await store.search("c", _vec(1, 0), top_k=5)
    assert hits == []
    # Filters that exclude everything also return empty.
    await store.upsert(
        "c", [VectorItem(chunk_id=ChunkId("chk_x"), vector=_vec(1, 0), metadata={"a": 1})]
    )
    hits = await store.search("c", _vec(1, 0), top_k=5, filters={"a": 99})
    assert hits == []


async def test_stats_reflects_count_and_metric() -> None:
    store = InMemoryVectorStore()
    await store.create_collection("c", dim=2, metric=DistanceMetric.L2)
    s = await store.stats("c")
    assert s.count == 0
    assert s.metric is DistanceMetric.L2
    assert s.dim == 2
