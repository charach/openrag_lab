"""Async HTTP client for external LLM providers.

Wraps ``httpx.AsyncClient`` with the timeout / proxy / TLS settings
loaded from ``settings.yaml`` (PLATFORM.md §11). Maps transport-level
errors into ``ExternalApiError`` so adapter code never raises an httpx
exception across the domain boundary.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from openrag_lab.config.settings import NetworkSettings
from openrag_lab.domain.errors import ConfigurationError, ExternalApiError


def build_client(network: NetworkSettings) -> httpx.AsyncClient:
    """Build an ``httpx.AsyncClient`` honouring the network settings.

    Caller owns the lifecycle (``async with client`` or explicit ``aclose``).
    """
    timeout = httpx.Timeout(
        connect=network.timeouts.connect_seconds,
        read=network.timeouts.read_seconds,
        write=network.timeouts.read_seconds,
        pool=network.timeouts.connect_seconds,
    )
    verify: bool | str = network.tls.verify
    if network.tls.ca_bundle_path is not None:
        verify = str(network.tls.ca_bundle_path)
    proxy: str | None = network.proxy.https_proxy or network.proxy.http_proxy
    return httpx.AsyncClient(timeout=timeout, verify=verify, proxy=proxy)


def _retry_after(headers: Mapping[str, str]) -> int | None:
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if not raw:
        return None
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


async def request_json(
    client: httpx.AsyncClient,
    *,
    method: str,
    url: str,
    headers: Mapping[str, str],
    json_body: Mapping[str, Any] | None = None,
    provider_id: str,
) -> dict[str, Any]:
    """Send an HTTP request expecting a JSON response.

    On ``2xx`` returns the parsed dict body. On ``401`` raises
    ``ConfigurationError(EXTERNAL_API_KEY_INVALID)`` so the user is
    funnelled to re-enter their key. All other failures raise
    ``ExternalApiError(EXTERNAL_API_FAILED)`` with provider + status.
    """
    try:
        resp = await client.request(method, url, headers=dict(headers), json=json_body)
    except httpx.TimeoutException as exc:
        raise ExternalApiError(
            "외부 API 호출이 시간 초과되었습니다.",
            code="EXTERNAL_API_FAILED",
            recoverable=True,
            details={"provider": provider_id, "underlying": str(exc), "kind": "timeout"},
        ) from exc
    except httpx.HTTPError as exc:
        raise ExternalApiError(
            "외부 API 호출에 실패했습니다.",
            code="EXTERNAL_API_FAILED",
            recoverable=True,
            details={"provider": provider_id, "underlying": str(exc), "kind": "transport"},
        ) from exc

    if resp.status_code == 401:
        raise ConfigurationError(
            "API 키 검증에 실패했습니다.",
            code="EXTERNAL_API_KEY_INVALID",
            recoverable=True,
            details={"provider_id": provider_id, "validation_error": "401 Unauthorized"},
        )
    if resp.status_code >= 400:
        details: dict[str, Any] = {
            "provider": provider_id,
            "status_code": resp.status_code,
        }
        ra = _retry_after(resp.headers)
        if ra is not None:
            details["retry_after_seconds"] = ra
        # Include a short body excerpt so debugging is possible without
        # leaking long payloads into structured logs.
        text = resp.text
        if text:
            details["body_excerpt"] = text[:200]
        raise ExternalApiError(
            "외부 API 호출에 실패했습니다.",
            code="EXTERNAL_API_FAILED",
            recoverable=True,
            details=details,
        )
    try:
        payload: Any = resp.json()
    except ValueError as exc:
        raise ExternalApiError(
            "외부 API 응답을 파싱할 수 없습니다.",
            code="EXTERNAL_API_FAILED",
            recoverable=True,
            details={"provider": provider_id, "underlying": str(exc), "kind": "decode"},
        ) from exc
    if not isinstance(payload, dict):
        raise ExternalApiError(
            "외부 API 응답이 객체가 아닙니다.",
            code="EXTERNAL_API_FAILED",
            recoverable=True,
            details={"provider": provider_id, "kind": "decode"},
        )
    return payload
