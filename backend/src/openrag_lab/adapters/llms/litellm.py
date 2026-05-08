"""LiteLLM Proxy / OpenAI-compatible gateway adapter (LLM port).

Targets a LiteLLM Proxy or any OpenAI-compatible ``/v1/chat/completions``
endpoint that may sit behind a bearer token. Differs from the Ollama
adapter only in that an optional API key adds an ``authorization``
header. Default base URL is ``http://localhost:4000`` (LiteLLM default).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from openrag_lab.domain.errors import ExternalApiError
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.infra.external.http_client import request_json

DEFAULT_BASE_URL = "http://localhost:4000"


def _normalize_base(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    return base or DEFAULT_BASE_URL


def parse_credentials(stored: str) -> tuple[str, str]:
    """Split a ``<url>|<key>`` keystore value. Either side may be empty.

    The first ``|`` separates URL from key — pipes inside the URL are
    rejected by ``rsplit`` only on first match, so an api key that
    contains ``|`` would still survive. Returns ``(url, key)`` with the
    URL normalized to a non-empty default when missing.
    """
    if "|" in stored:
        url, _, key = stored.partition("|")
    else:
        url, key = stored, ""
    return _normalize_base(url), key.strip()


class LiteLLMLLM:
    def __init__(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str = "",
        client: httpx.AsyncClient,
    ) -> None:
        self._model = model
        self._base = _normalize_base(base_url)
        self._api_key = api_key
        self._client = client

    @property
    def model_id(self) -> str:
        return f"external:litellm:{self._model}"

    @property
    def is_local(self) -> bool:
        # LiteLLM is typically self-hosted; mark local so the UI doesn't
        # raise the "external call" alarm for proxy traffic.
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
        body = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        headers: dict[str, str] = {"content-type": "application/json"}
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
        payload = await request_json(
            self._client,
            method="POST",
            url=f"{self._base}/v1/chat/completions",
            headers=headers,
            json_body=body,
            provider_id="litellm",
        )
        try:
            return str(payload["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise ExternalApiError(
                "LiteLLM 응답에서 답변을 추출할 수 없습니다.",
                code="EXTERNAL_API_FAILED",
                recoverable=True,
                details={"provider": "litellm", "kind": "response_shape"},
            ) from exc

    def stream(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        async def _it() -> AsyncIterator[str]:
            yield await self.generate(prompt, max_tokens=max_tokens, temperature=temperature)

        return _it()
