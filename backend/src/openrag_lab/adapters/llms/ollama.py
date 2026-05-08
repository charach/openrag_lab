"""Ollama / OpenAI-compatible HTTP adapter (LLM port).

Targets any OpenAI-compatible ``/v1/chat/completions`` endpoint. Default
host is ``http://localhost:11434`` (Ollama). Works with vLLM, LM Studio,
LocalAI and other servers that expose the OpenAI schema. No auth header
is sent — the keystore slot stores the base URL instead of an API key.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from openrag_lab.domain.errors import ExternalApiError
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.infra.external.http_client import request_json

DEFAULT_BASE_URL = "http://localhost:11434"


def _normalize_base(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    return base or DEFAULT_BASE_URL


class OllamaLLM:
    def __init__(self, *, model: str, base_url: str, client: httpx.AsyncClient) -> None:
        self._model = model
        self._base = _normalize_base(base_url)
        self._client = client

    @property
    def model_id(self) -> str:
        return f"external:ollama:{self._model}"

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
        body = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        payload = await request_json(
            self._client,
            method="POST",
            url=f"{self._base}/v1/chat/completions",
            headers={"content-type": "application/json"},
            json_body=body,
            provider_id="ollama",
        )
        try:
            return str(payload["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise ExternalApiError(
                "Ollama 응답에서 답변을 추출할 수 없습니다.",
                code="EXTERNAL_API_FAILED",
                recoverable=True,
                details={"provider": "ollama", "kind": "response_shape"},
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
