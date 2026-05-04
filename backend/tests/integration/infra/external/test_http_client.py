"""http_client error mapping — uses httpx.MockTransport, no network."""

from __future__ import annotations

import httpx
import pytest

from openrag_lab.config.settings import NetworkSettings
from openrag_lab.domain.errors import ConfigurationError, ExternalApiError
from openrag_lab.infra.external.http_client import build_client, request_json


def _client_with(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=2.0)


async def test_2xx_returns_parsed_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "Bearer k"
        return httpx.Response(200, json={"ok": True, "echo": "hi"})

    async with _client_with(handler) as client:
        out = await request_json(
            client,
            method="POST",
            url="https://api.example.com/v1/x",
            headers={"authorization": "Bearer k"},
            json_body={"hello": "world"},
            provider_id="openai",
        )
    assert out == {"ok": True, "echo": "hi"}


async def test_401_raises_invalid_key() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key"})

    async with _client_with(handler) as client:
        with pytest.raises(ConfigurationError) as ei:
            await request_json(
                client,
                method="POST",
                url="https://api.example.com/v1",
                headers={},
                json_body={},
                provider_id="openai",
            )
    assert ei.value.code == "EXTERNAL_API_KEY_INVALID"
    assert ei.value.details["provider_id"] == "openai"


async def test_429_raises_external_failed_with_retry_after() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "30"}, json={"error": "rate"})

    async with _client_with(handler) as client:
        with pytest.raises(ExternalApiError) as ei:
            await request_json(
                client,
                method="POST",
                url="https://api.example.com/v1",
                headers={},
                json_body={},
                provider_id="openrouter",
            )
    assert ei.value.code == "EXTERNAL_API_FAILED"
    assert ei.value.details["status_code"] == 429
    assert ei.value.details["retry_after_seconds"] == 30
    assert ei.value.details["provider"] == "openrouter"


async def test_timeout_maps_to_external_failed() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow", request=None)

    async with _client_with(handler) as client:
        with pytest.raises(ExternalApiError) as ei:
            await request_json(
                client,
                method="POST",
                url="https://api.example.com/v1",
                headers={},
                json_body={},
                provider_id="anthropic",
            )
    assert ei.value.code == "EXTERNAL_API_FAILED"
    assert ei.value.details["kind"] == "timeout"


async def test_non_json_response_maps_to_decode_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>not json</html>")

    async with _client_with(handler) as client:
        with pytest.raises(ExternalApiError) as ei:
            await request_json(
                client,
                method="POST",
                url="https://api.example.com/v1",
                headers={},
                json_body={},
                provider_id="gemini",
            )
    assert ei.value.code == "EXTERNAL_API_FAILED"
    assert ei.value.details["kind"] == "decode"


def test_build_client_honours_settings() -> None:
    network = NetworkSettings.model_validate(
        {
            "proxy": {"https_proxy": "http://proxy.example:8080"},
            "tls": {"verify": False},
            "timeouts": {"connect_seconds": 3.0, "read_seconds": 7.0},
        }
    )
    client = build_client(network)
    try:
        assert client.timeout.connect == 3.0
        assert client.timeout.read == 7.0
    finally:
        # Sync close — the test is synchronous and the client never made calls.
        client._transport.close() if hasattr(client._transport, "close") else None
