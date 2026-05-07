"""Publishes external-LLM call boundaries to the WebSocket hub.

A wrapper that proxies an ``LLM`` and, only when the wrapped instance is
non-local, emits ``external_call_started`` before each request and
``external_call_completed`` after it. The frontend's header dot
subscribes to a single topic and toggles regardless of the call site
(chat, evaluator, …) — the producing surface just has to wrap its LLM.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from openrag_lab.app.ws.hub import WebSocketHub
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.ports.llm import LLM

EXTERNAL_CALLS_TOPIC = "external_calls"


def _provider_and_model(model_id: str) -> tuple[str, str]:
    """Parse ``external:<provider>:<model>`` into a (provider, model) pair.

    Falls back to ``("external", model_id)`` when the id doesn't match the
    convention so we never crash on a malformed adapter id.
    """
    if model_id.startswith("external:"):
        parts = model_id.split(":", 2)
        if len(parts) == 3 and parts[1] and parts[2]:
            return parts[1], parts[2]
    return "external", model_id


class PublishingLLM:
    """LLM proxy that announces start/finish of non-local generations."""

    def __init__(self, *, inner: LLM, hub: WebSocketHub, scope: dict[str, str] | None = None) -> None:
        self._inner = inner
        self._hub = hub
        self._scope = scope or {}

    @property
    def model_id(self) -> str:
        return self._inner.model_id

    @property
    def is_local(self) -> bool:
        return self._inner.is_local

    @property
    def active_backend(self) -> AccelBackend | None:
        return self._inner.active_backend

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> str:
        if self._inner.is_local:
            return await self._inner.generate(
                prompt, max_tokens=max_tokens, temperature=temperature
            )
        provider, model = _provider_and_model(self._inner.model_id)
        await self._hub.publish(
            EXTERNAL_CALLS_TOPIC,
            {
                "type": "external_call_started",
                "provider": provider,
                "model": model,
                **self._scope,
            },
        )
        try:
            return await self._inner.generate(
                prompt, max_tokens=max_tokens, temperature=temperature
            )
        finally:
            await self._hub.publish(
                EXTERNAL_CALLS_TOPIC,
                {
                    "type": "external_call_completed",
                    "provider": provider,
                    "model": model,
                    **self._scope,
                },
            )

    def stream(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        return self._inner.stream(prompt, max_tokens=max_tokens, temperature=temperature)
