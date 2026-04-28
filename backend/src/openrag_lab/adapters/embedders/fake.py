"""Deterministic in-memory embedder used by tests and for offline development.

Vectors are produced by hashing the input text — same string in, same
vector out — and never touch the network or load a model. Embedding
adapter contract (``Embedder`` protocol) is preserved.

Production code paths use ``sentence_transformers.py``. Anything that
exercises the indexing/retrieval pipeline in tests should depend on
this fake.
"""

from __future__ import annotations

import asyncio
import hashlib

import numpy as np

from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.ports.embedder import ProgressCallback


def _vec_for(text: str, dim: int) -> np.ndarray:
    """Map ``text`` to a length-``dim`` unit vector via SHA-256 expansion."""
    out = np.zeros(dim, dtype="float32")
    seed = hashlib.sha256(text.encode("utf-8")).digest()
    # Tile and slice the SHA bytes into floats in [-1, 1].
    pos = 0
    while pos < dim:
        block = hashlib.sha256(seed + pos.to_bytes(4, "big")).digest()
        for byte in block:
            if pos >= dim:
                break
            out[pos] = (byte / 127.5) - 1.0
            pos += 1
    norm = float(np.linalg.norm(out))
    if norm > 0:
        out /= norm
    return out


class FakeEmbedder:
    """An ``Embedder`` whose output is deterministic, dependency-free."""

    def __init__(self, *, dim: int = 32, model_id: str = "fake-embedder") -> None:
        if dim < 1:
            raise ValueError(f"dim must be >= 1, got {dim}")
        self._dim = dim
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def model_version(self) -> str:
        return "1.0"

    @property
    def dim(self) -> int:
        return self._dim

    @property
    def max_tokens(self) -> int:
        return 8192

    @property
    def active_backend(self) -> AccelBackend:
        return AccelBackend.CPU

    async def embed_query(self, text: str) -> np.ndarray:
        return await asyncio.to_thread(_vec_for, text, self._dim)

    async def embed_documents(
        self,
        texts: list[str],
        progress: ProgressCallback | None = None,
    ) -> list[np.ndarray]:
        out: list[np.ndarray] = []
        total = len(texts)
        for i, t in enumerate(texts):
            out.append(await asyncio.to_thread(_vec_for, t, self._dim))
            if progress is not None:
                await progress(i + 1, total)
        return out
