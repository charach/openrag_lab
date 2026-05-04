"""OpenRouter adapter (LLM port).

OpenRouter exposes an OpenAI-compatible Chat Completions endpoint, so the
request/response shape mirrors ``OpenAILLM``. The base URL and required
referrer/title headers are the only differences.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from openrag_lab.domain.errors import ExternalApiError
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.infra.external.http_client import request_json


class OpenRouterLLM:
    base_url: str = "https://openrouter.ai/api/v1"

    def __init__(self, *, model: str, api_key: str, client: httpx.AsyncClient) -> None:
        self._model = model
        self._api_key = api_key
        self._client = client

    @property
    def model_id(self) -> str:
        return f"external:openrouter:{self._model}"

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
        body = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        payload = await request_json(
            self._client,
            method="POST",
            url=f"{self.base_url}/chat/completions",
            headers={
                "authorization": f"Bearer {self._api_key}",
                "content-type": "application/json",
                "http-referer": "https://github.com/openrag-lab",
                "x-title": "OpenRAG-Lab",
            },
            json_body=body,
            provider_id="openrouter",
        )
        try:
            return str(payload["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as exc:
            raise ExternalApiError(
                "OpenRouter 응답에서 답변을 추출할 수 없습니다.",
                code="EXTERNAL_API_FAILED",
                recoverable=True,
                details={"provider": "openrouter", "kind": "response_shape"},
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
