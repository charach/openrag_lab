"""External LLM adapters — request shape + response extraction + auth header.

Each test stubs httpx with ``MockTransport`` so no network is touched.
"""

from __future__ import annotations

import json

import httpx
import pytest

from openrag_lab.adapters.llms.anthropic import AnthropicLLM
from openrag_lab.adapters.llms.gemini import GeminiLLM
from openrag_lab.adapters.llms.openai import OpenAILLM
from openrag_lab.adapters.llms.openrouter import OpenRouterLLM
from openrag_lab.domain.errors import ConfigurationError, ExternalApiError


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=2.0)


# --------------------------------------------------------------------- OpenAI


async def test_openai_generates_and_sends_bearer_token() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "pong"}}],
            },
        )

    async with _client(handler) as c:
        llm = OpenAILLM(model="gpt-4o-mini", api_key="sk-x", client=c)
        out = await llm.generate("ping", max_tokens=64, temperature=0.2)

    assert out == "pong"
    assert llm.model_id == "external:openai:gpt-4o-mini"
    assert llm.is_local is False
    assert seen["url"].endswith("/v1/chat/completions")
    assert seen["auth"] == "Bearer sk-x"
    assert seen["body"]["model"] == "gpt-4o-mini"
    assert seen["body"]["messages"] == [{"role": "user", "content": "ping"}]
    assert seen["body"]["max_tokens"] == 64
    assert seen["body"]["temperature"] == 0.2


async def test_openai_401_raises_invalid_key() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "bad"}})

    async with _client(handler) as c:
        llm = OpenAILLM(model="gpt-4o", api_key="bad", client=c)
        with pytest.raises(ConfigurationError) as ei:
            await llm.generate("hi")
    assert ei.value.code == "EXTERNAL_API_KEY_INVALID"
    assert ei.value.details["provider_id"] == "openai"


async def test_openai_unparseable_response_raises_shape_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": True})

    async with _client(handler) as c:
        llm = OpenAILLM(model="gpt-4o", api_key="k", client=c)
        with pytest.raises(ExternalApiError) as ei:
            await llm.generate("hi")
    assert ei.value.code == "EXTERNAL_API_FAILED"
    assert ei.value.details["kind"] == "response_shape"


# ------------------------------------------------------------------- Anthropic


async def test_anthropic_generates_and_sends_required_headers() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["x-api-key"] = request.headers.get("x-api-key")
        seen["anthropic-version"] = request.headers.get("anthropic-version")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "text", "text": "hello-from-claude"},
                ],
            },
        )

    async with _client(handler) as c:
        llm = AnthropicLLM(model="claude-3-5-sonnet", api_key="anth-key", client=c)
        out = await llm.generate("hi", max_tokens=128, temperature=0.0)

    assert out == "hello-from-claude"
    assert llm.model_id == "external:anthropic:claude-3-5-sonnet"
    assert seen["url"].endswith("/v1/messages")
    assert seen["x-api-key"] == "anth-key"
    assert seen["anthropic-version"] == "2023-06-01"
    assert seen["body"]["model"] == "claude-3-5-sonnet"
    assert seen["body"]["messages"] == [{"role": "user", "content": "hi"}]


async def test_anthropic_skips_non_text_blocks() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "thinking", "thinking": "..."},
                    {"type": "text", "text": "answer"},
                ],
            },
        )

    async with _client(handler) as c:
        llm = AnthropicLLM(model="claude-3-haiku", api_key="k", client=c)
        out = await llm.generate("q")
    assert out == "answer"


# ---------------------------------------------------------------------- Gemini


async def test_gemini_generates_and_sends_key_in_query() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["params"] = dict(request.url.params)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "hel"}, {"text": "lo"}],
                        }
                    }
                ]
            },
        )

    async with _client(handler) as c:
        llm = GeminiLLM(model="gemini-1.5-pro", api_key="goog-key", client=c)
        out = await llm.generate("hi", max_tokens=32, temperature=0.5)

    assert out == "hello"
    assert llm.model_id == "external:gemini:gemini-1.5-pro"
    assert "models/gemini-1.5-pro:generateContent" in seen["url"]
    assert seen["params"]["key"] == "goog-key"
    assert seen["body"]["generationConfig"] == {
        "maxOutputTokens": 32,
        "temperature": 0.5,
    }
    assert seen["body"]["contents"] == [{"parts": [{"text": "hi"}]}]


# -------------------------------------------------------------------- OpenRouter


async def test_openrouter_uses_openai_compatible_shape_with_referer() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["referer"] = request.headers.get("http-referer")
        seen["title"] = request.headers.get("x-title")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "router-says-hi"}}]},
        )

    async with _client(handler) as c:
        llm = OpenRouterLLM(model="meta-llama/llama-3-8b", api_key="or-key", client=c)
        out = await llm.generate("hi")

    assert out == "router-says-hi"
    assert llm.model_id == "external:openrouter:meta-llama/llama-3-8b"
    assert seen["url"].endswith("/api/v1/chat/completions")
    assert seen["auth"] == "Bearer or-key"
    assert seen["referer"]  # non-empty
    assert seen["title"] == "OpenRAG-Lab"
    assert seen["body"]["model"] == "meta-llama/llama-3-8b"


# --------------------------------------------------------------- shared properties


@pytest.mark.parametrize(
    "factory",
    [
        lambda c: OpenAILLM(model="m", api_key="k", client=c),
        lambda c: AnthropicLLM(model="m", api_key="k", client=c),
        lambda c: GeminiLLM(model="m", api_key="k", client=c),
        lambda c: OpenRouterLLM(model="m", api_key="k", client=c),
    ],
)
async def test_all_external_adapters_report_remote_and_no_backend(factory) -> None:
    async with _client(lambda r: httpx.Response(200, json={})) as c:
        llm = factory(c)
        assert llm.is_local is False
        assert llm.active_backend is None
