"""FakeEmbedder — determinism + protocol shape."""

from __future__ import annotations

import numpy as np
import pytest

from openrag_lab.adapters.embedders.fake import FakeEmbedder
from openrag_lab.domain.models.enums import AccelBackend


async def test_same_input_produces_same_vector() -> None:
    e = FakeEmbedder(dim=64)
    a = await e.embed_query("hello world")
    b = await e.embed_query("hello world")
    np.testing.assert_array_equal(a, b)


async def test_different_inputs_produce_different_vectors() -> None:
    e = FakeEmbedder(dim=64)
    a = await e.embed_query("hello")
    b = await e.embed_query("world")
    assert not np.array_equal(a, b)


async def test_vector_is_unit_norm() -> None:
    e = FakeEmbedder(dim=128)
    v = await e.embed_query("some text 한국어 🚀")
    assert pytest.approx(float(np.linalg.norm(v)), rel=1e-5) == 1.0


async def test_dim_matches_constructor_argument() -> None:
    e = FakeEmbedder(dim=256)
    v = await e.embed_query("x")
    assert v.shape == (256,)


async def test_embed_documents_calls_progress() -> None:
    e = FakeEmbedder(dim=8)
    seen: list[tuple[int, int]] = []

    async def cb(done: int, total: int) -> None:
        seen.append((done, total))

    out = await e.embed_documents(["a", "b", "c"], progress=cb)
    assert len(out) == 3
    assert seen == [(1, 3), (2, 3), (3, 3)]


def test_metadata_properties_are_set() -> None:
    e = FakeEmbedder(dim=16, model_id="test-model")
    assert e.model_id == "test-model"
    assert e.model_version == "1.0"
    assert e.dim == 16
    assert e.max_tokens > 0
    assert e.active_backend is AccelBackend.CPU


def test_zero_dim_rejected() -> None:
    with pytest.raises(ValueError, match="dim"):
        FakeEmbedder(dim=0)
