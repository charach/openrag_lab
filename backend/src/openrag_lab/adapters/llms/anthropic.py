"""Anthropic Messages API adapter (LLM port)."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from openrag_lab.domain.errors import ExternalApiError
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.infra.external.http_client import request_json


class AnthropicLLM:
    base_url: str = "https://api.anthropic.com/v1"
    api_version: str = "2023-06-01"

    def __init__(self, *, model: str, api_key: str, client: httpx.AsyncClient) -> None:
        self._model = model
        self._api_key = api_key
        self._client = client

    @property
    def model_id(self) -> str:
        return f"external:anthropic:{self._model}"

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
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        payload = await request_json(
            self._client,
            method="POST",
            url=f"{self.base_url}/messages",
            headers={
                "x-api-key": self._api_key,
                "anthropic-version": self.api_version,
                "content-type": "application/json",
            },
            json_body=body,
            provider_id="anthropic",
        )
        try:
            blocks = payload["content"]
            for b in blocks:
                if b.get("type") == "text":
                    return str(b["text"])
            # No text block — fall back to first block's text-ish field if any.
            return str(blocks[0].get("text", ""))
        except (KeyError, IndexError, TypeError) as exc:
            raise ExternalApiError(
                "Anthropic 응답에서 답변을 추출할 수 없습니다.",
                code="EXTERNAL_API_FAILED",
                recoverable=True,
                details={"provider": "anthropic", "kind": "response_shape"},
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
