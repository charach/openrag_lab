"""LLM port — local or external answer generation.

``is_local`` drives UI badges and the external-call gateway in PLATFORM.md
§11. External adapters MUST set ``is_local = False``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from openrag_lab.domain.models.enums import AccelBackend


@runtime_checkable
class LLM(Protocol):
    @property
    def model_id(self) -> str: ...

    @property
    def is_local(self) -> bool: ...

    @property
    def active_backend(self) -> AccelBackend | None:
        """``None`` for external (network-bound) LLMs."""
        ...

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> str: ...

    def stream(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]: ...
