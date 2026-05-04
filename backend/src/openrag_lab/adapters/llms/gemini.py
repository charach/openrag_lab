"""Google Gemini ``generateContent`` adapter (LLM port).

The API key is passed as a query parameter (``?key=``) per Google's
public docs. We do not log the URL with the key — only the path/method
are surfaced in error details.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from openrag_lab.domain.errors import ExternalApiError
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.infra.external.http_client import request_json


class GeminiLLM:
    base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, *, model: str, api_key: str, client: httpx.AsyncClient) -> None:
        self._model = model
        self._api_key = api_key
        self._client = client

    @property
    def model_id(self) -> str:
        return f"external:gemini:{self._model}"

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
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }
        url = f"{self.base_url}/models/{self._model}:generateContent?key={self._api_key}"
        payload = await request_json(
            self._client,
            method="POST",
            url=url,
            headers={"content-type": "application/json"},
            json_body=body,
            provider_id="gemini",
        )
        try:
            parts = payload["candidates"][0]["content"]["parts"]
            return "".join(str(p.get("text", "")) for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise ExternalApiError(
                "Gemini 응답에서 답변을 추출할 수 없습니다.",
                code="EXTERNAL_API_FAILED",
                recoverable=True,
                details={"provider": "gemini", "kind": "response_shape"},
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
