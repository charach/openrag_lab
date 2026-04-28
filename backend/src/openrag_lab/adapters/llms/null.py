"""``NullLLM`` — the explicit "no answering LLM" adapter.

When ``ExperimentConfig.llm_id is None`` the pipeline is in retrieval-only
mode (REQUIREMENTS_v4 §3.3.4) and never calls an LLM. This adapter exists
for the rare case where a code path must hold a non-``None`` LLM
reference but should not actually generate anything — it raises
``ConfigurationError`` so accidental use surfaces loudly instead of
returning a misleading empty string.

For deterministic tests that exercise services with a real LLM in the
loop, use ``EchoLLM`` (in the same module) which echoes a small
prompt-derived response.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator

from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.enums import AccelBackend


class NullLLM:
    """An LLM that refuses to generate anything."""

    @property
    def model_id(self) -> str:
        return "null"

    @property
    def is_local(self) -> bool:
        return True

    @property
    def active_backend(self) -> AccelBackend | None:
        return None

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> str:
        raise ConfigurationError(
            "NullLLM cannot generate; the pipeline is in retrieval-only mode.",
            code="LLM_NOT_CONFIGURED",
            recoverable=False,
        )

    def stream(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        async def _it() -> AsyncIterator[str]:
            for _ in ():  # generator marker, body never runs
                yield ""
            raise ConfigurationError(
                "NullLLM cannot generate; the pipeline is in retrieval-only mode.",
                code="LLM_NOT_CONFIGURED",
                recoverable=False,
            )

        return _it()


class EchoLLM:
    """Test-only LLM that returns a deterministic answer derived from prompt.

    Output format: ``"echo[<sha8>]: <first 200 chars of prompt>"``. The
    sha8 prefix gives just enough variation that integration tests can
    distinguish prompts without resorting to a real model.
    """

    def __init__(self, model_id: str = "echo-llm") -> None:
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def is_local(self) -> bool:
        return True

    @property
    def active_backend(self) -> AccelBackend | None:
        return AccelBackend.CPU

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> str:
        return await asyncio.to_thread(_echo_response, prompt)

    def stream(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        async def _it() -> AsyncIterator[str]:
            text = await asyncio.to_thread(_echo_response, prompt)
            # Yield in small chunks so consumers exercise their streaming path.
            for i in range(0, len(text), 16):
                yield text[i : i + 16]

        return _it()


def _echo_response(prompt: str) -> str:
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:8]
    return f"echo[{digest}]: {prompt[:200]}"
