"""Embedding + EmbeddingBatch — shape/dtype constraints and dim agreement."""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pytest
from pydantic import ValidationError

from openrag_lab.domain.models.embedding import Embedding, EmbeddingBatch
from openrag_lab.domain.models.ids import new_chunk_id


def _emb(dim: int = 4) -> Embedding:
    return Embedding(
        chunk_id=new_chunk_id(),
        vector=np.zeros(dim, dtype=np.float32),
        model_id="test/model",
        model_version="1.0",
        created_at=datetime.now(UTC),
    )


def test_embedding_accepts_1d_float_vector() -> None:
    emb = _emb(dim=8)
    assert emb.dim == 8


def test_embedding_rejects_non_ndarray_vector() -> None:
    with pytest.raises(ValidationError):
        Embedding(
            chunk_id=new_chunk_id(),
            vector=[0.1, 0.2, 0.3],  # type: ignore[arg-type]
            model_id="test/model",
            model_version="1.0",
            created_at=datetime.now(UTC),
        )


def test_embedding_rejects_2d_vector() -> None:
    with pytest.raises(ValidationError, match="1-D"):
        Embedding(
            chunk_id=new_chunk_id(),
            vector=np.zeros((2, 3), dtype=np.float32),
            model_id="test/model",
            model_version="1.0",
            created_at=datetime.now(UTC),
        )


def test_embedding_rejects_integer_dtype() -> None:
    with pytest.raises(ValidationError, match="dtype"):
        Embedding(
            chunk_id=new_chunk_id(),
            vector=np.zeros(4, dtype=np.int32),
            model_id="test/model",
            model_version="1.0",
            created_at=datetime.now(UTC),
        )


def test_embedding_batch_requires_consistent_dim() -> None:
    a = _emb(dim=4)
    b = _emb(dim=8)
    with pytest.raises(ValidationError, match="all embeddings must share dim"):
        EmbeddingBatch(items=(a, b))


def test_embedding_batch_dim_returns_first_item_dim() -> None:
    items = tuple(_emb(dim=4) for _ in range(3))
    batch = EmbeddingBatch(items=items)
    assert batch.dim == 4


def test_embedding_batch_rejects_empty() -> None:
    with pytest.raises(ValidationError):
        EmbeddingBatch(items=())
