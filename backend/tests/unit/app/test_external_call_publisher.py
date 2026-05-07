"""Unit tests for the ``PublishingLLM`` external-call wrapper."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from openrag_lab.adapters.llms.null import EchoLLM
from openrag_lab.app.services.external_call_publisher import (
    EXTERNAL_CALLS_TOPIC,
    PublishingLLM,
    _provider_and_model,
)
from openrag_lab.app.ws.hub import WebSocketHub
from openrag_lab.domain.models.enums import AccelBackend


class _FakeExternalLLM:
    """Stand-in for a non-local provider — same shape as Anthropic/OpenAI adapters."""

    def __init__(self, *, model_id: str = "external:anthropic:claude-haiku") -> None:
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def is_local(self) -> bool:
        return False

    @property
    def active_backend(self) -> AccelBackend | None:
        return None

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> str:
        return "external answer"

    def stream(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        async def _it() -> AsyncIterator[str]:
            yield "external answer"

        return _it()


async def _drain(queue) -> list[dict]:  # type: ignore[no-untyped-def]
    out: list[dict] = []
    while not queue.empty():
        out.append(queue.get_nowait())
    return out


@pytest.mark.asyncio
async def test_external_llm_publishes_started_and_completed() -> None:
    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, [EXTERNAL_CALLS_TOPIC])

    wrapped = PublishingLLM(inner=_FakeExternalLLM(), hub=hub)
    answer = await wrapped.generate("hi")

    assert answer == "external answer"
    msgs = await _drain(sub.queue)
    types = [m["type"] for m in msgs]
    assert types == ["external_call_started", "external_call_completed"]
    assert msgs[0]["provider"] == "anthropic"
    assert msgs[0]["model"] == "claude-haiku"


@pytest.mark.asyncio
async def test_local_llm_does_not_publish() -> None:
    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, [EXTERNAL_CALLS_TOPIC])

    wrapped = PublishingLLM(inner=EchoLLM(), hub=hub)
    await wrapped.generate("hello")

    assert sub.queue.empty()


@pytest.mark.asyncio
async def test_completed_published_even_when_inner_raises() -> None:
    class _Boom(_FakeExternalLLM):
        async def generate(
            self,
            prompt: str,
            max_tokens: int = 512,
            temperature: float = 0.0,
        ) -> str:
            raise RuntimeError("upstream timeout")

    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, [EXTERNAL_CALLS_TOPIC])

    wrapped = PublishingLLM(inner=_Boom(), hub=hub)
    with pytest.raises(RuntimeError):
        await wrapped.generate("hi")

    msgs = await _drain(sub.queue)
    types = [m["type"] for m in msgs]
    assert types == ["external_call_started", "external_call_completed"]


@pytest.mark.asyncio
async def test_scope_is_attached_to_payloads() -> None:
    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, [EXTERNAL_CALLS_TOPIC])

    wrapped = PublishingLLM(
        inner=_FakeExternalLLM(),
        hub=hub,
        scope={"experiment_id": "exp_abc"},
    )
    await wrapped.generate("hi")

    msgs = await _drain(sub.queue)
    assert all(m["experiment_id"] == "exp_abc" for m in msgs)


def test_provider_and_model_parses_external_id() -> None:
    assert _provider_and_model("external:openai:gpt-4o-mini") == ("openai", "gpt-4o-mini")
    assert _provider_and_model("external:anthropic:claude-3-5-haiku-20241022") == (
        "anthropic",
        "claude-3-5-haiku-20241022",
    )


def test_provider_and_model_falls_back_for_unknown_shape() -> None:
    assert _provider_and_model("legacy-id") == ("external", "legacy-id")
    assert _provider_and_model("external:") == ("external", "external:")
