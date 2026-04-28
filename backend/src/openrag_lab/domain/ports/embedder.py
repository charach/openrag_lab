"""Embedder port — text -> vector. Reference: docs/ARCHITECTURE_v3.md §7.3."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol, runtime_checkable

import numpy as np

from openrag_lab.domain.models.enums import AccelBackend

# Adapter -> caller progress callback. ``done`` and ``total`` are batch counts.
ProgressCallback = Callable[[int, int], Awaitable[None]]


@runtime_checkable
class Embedder(Protocol):
    """Encode text into a vector. Asymmetric query/document is supported."""

    @property
    def model_id(self) -> str: ...

    @property
    def model_version(self) -> str: ...

    @property
    def dim(self) -> int: ...

    @property
    def max_tokens(self) -> int: ...

    @property
    def active_backend(self) -> AccelBackend:
        """Selected acceleration backend at construction (PLATFORM.md §3.3)."""
        ...

    async def embed_query(self, text: str) -> np.ndarray: ...

    async def embed_documents(
        self,
        texts: list[str],
        progress: ProgressCallback | None = None,
    ) -> list[np.ndarray]: ...
