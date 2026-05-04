"""External LLM provider key management (API_SPEC §15.0.1-§15.0.3).

Three endpoints under ``/system/external-providers``:

- ``GET    /``                 — list providers + key registration status
- ``POST   /{provider_id}/key`` — register or replace a key (optional ping
  validation against the provider's models endpoint)
- ``DELETE /{provider_id}/key`` — remove a key, refusing with 409
  ``PROVIDER_IN_USE`` when any workspace's experiments reference it

The keystore is built per request from ``state.layout.api_keys_yaml`` so
write semantics stay simple (no caching of plaintext keys in memory).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState
from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.external import ExternalProvider
from openrag_lab.infra.db.repositories.experiment_repo import ExperimentRepository
from openrag_lab.infra.external.keystore import Keystore

router = APIRouter(prefix="/system/external-providers", tags=["system"])


# ---------------------------------------------------------------------------
# Static catalog — display names + a small list of common models per provider.
# Kept lean on purpose; users can pass any model id, the catalog only powers
# autocomplete in the UI.
# ---------------------------------------------------------------------------

_PROVIDER_DISPLAY: dict[ExternalProvider, str] = {
    ExternalProvider.OPENAI: "OpenAI",
    ExternalProvider.ANTHROPIC: "Anthropic",
    ExternalProvider.GEMINI: "Google Gemini",
    ExternalProvider.OPENROUTER: "OpenRouter",
}

_SUPPORTED_MODELS: dict[ExternalProvider, list[str]] = {
    ExternalProvider.OPENAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    ExternalProvider.ANTHROPIC: [
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
    ],
    ExternalProvider.GEMINI: ["gemini-2.5-pro", "gemini-2.5-flash"],
    ExternalProvider.OPENROUTER: [
        "meta-llama/llama-3-70b-instruct",
        "anthropic/claude-3.5-sonnet",
    ],
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class RegisterKeyBody(BaseModel):
    key: str = Field(min_length=1)
    validate_now: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _key_suffix(key: str) -> str:
    tail = key[-4:] if len(key) >= 4 else key
    return f"...{tail}"


def _parse_provider(provider_id: str) -> ExternalProvider:
    try:
        return ExternalProvider(provider_id)
    except ValueError as exc:
        raise HttpError(
            status_code=422,
            code="EXTERNAL_PROVIDER_UNKNOWN",
            message=f"지원하지 않는 외부 제공자입니다: {provider_id!r}.",
            recoverable=False,
            details={
                "provider_id": provider_id,
                "supported_providers": [p.value for p in ExternalProvider],
            },
        ) from exc


async def _validate_key(
    provider: ExternalProvider, key: str, client: httpx.AsyncClient
) -> str:
    """Ping the provider's models endpoint. Returns API §15.0.1 status string."""
    try:
        if provider is ExternalProvider.OPENAI:
            resp = await client.get(
                "https://api.openai.com/v1/models",
                headers={"authorization": f"Bearer {key}"},
            )
        elif provider is ExternalProvider.ANTHROPIC:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                },
            )
        elif provider is ExternalProvider.GEMINI:
            resp = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
            )
        else:
            assert provider is ExternalProvider.OPENROUTER
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"authorization": f"Bearer {key}"},
            )
    except httpx.TimeoutException:
        return "network_error"
    except httpx.HTTPError:
        return "network_error"

    if resp.status_code == 200:
        return "ok"
    if resp.status_code in (401, 403):
        return "invalid"
    if resp.status_code == 429:
        return "rate_limited"
    return "network_error"


def _scan_workspaces_for_provider(
    registry: WorkspaceRegistry, provider: ExternalProvider
) -> list[str]:
    """Return workspace ids whose experiments reference this external provider."""
    prefix = f"external:{provider.value}:"
    in_use: list[str] = []
    for workspace in registry.list_all():
        try:
            with registry.open(workspace.id) as conn:
                experiments = ExperimentRepository(conn).list_for_workspace(workspace.id)
        except Exception:  # noqa: S112 — a single broken workspace must not block the scan
            continue
        for exp in experiments:
            llm_id = exp.config.llm_id or ""
            if llm_id.startswith(prefix):
                in_use.append(str(workspace.id))
                break
    return in_use


def _http_client(state: AppState) -> httpx.AsyncClient | None:
    return state.http_client


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def list_providers(
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    keystore = Keystore(state.layout.api_keys_yaml)
    items: list[dict[str, Any]] = []
    for provider in ExternalProvider:
        registered_key = keystore.get(provider)
        item: dict[str, Any] = {
            "id": provider.value,
            "name": _PROVIDER_DISPLAY[provider],
            "key_registered": registered_key is not None,
            "supported_models": list(_SUPPORTED_MODELS[provider]),
        }
        if registered_key is not None:
            item["key_suffix"] = _key_suffix(registered_key)
            item["validation_status"] = "not_validated"
        items.append(item)
    return {"providers": items}


@router.post("/{provider_id}/key")
async def register_key(
    provider_id: str,
    body: RegisterKeyBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    provider = _parse_provider(provider_id)
    keystore = Keystore(state.layout.api_keys_yaml)

    validation_status = "not_validated"
    if body.validate_now:
        client = _http_client(state)
        if client is None:
            # No shared client configured (test mode without explicit stub).
            # Fall through with not_validated so the key still registers.
            validation_status = "not_validated"
        else:
            validation_status = await _validate_key(provider, body.key, client)

    if validation_status == "invalid":
        raise HttpError(
            status_code=422,
            code="EXTERNAL_API_KEY_INVALID",
            message="API 키 검증에 실패했습니다.",
            recoverable=True,
            details={
                "provider_id": provider.value,
                "validation_error": "401 Unauthorized",
                "validated_at": datetime.now(UTC).isoformat(),
            },
        )

    try:
        keystore.set(provider, body.key)
    except ConfigurationError as exc:
        raise HttpError(
            status_code=422,
            code=exc.code,
            message=exc.user_message,
            recoverable=exc.recoverable,
            details=exc.details,
        ) from exc

    return {
        "provider_id": provider.value,
        "key_registered": True,
        "key_suffix": _key_suffix(body.key),
        "registered_at": datetime.now(UTC).isoformat(),
        "validation_status": validation_status,
    }


@router.delete("/{provider_id}/key", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(
    provider_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> None:
    provider = _parse_provider(provider_id)
    registry = WorkspaceRegistry(state.layout)
    in_use = _scan_workspaces_for_provider(registry, provider)
    if in_use:
        raise HttpError(
            status_code=409,
            code="PROVIDER_IN_USE",
            message="이 제공자를 사용 중인 워크스페이스가 있습니다.",
            recoverable=False,
            details={"provider_id": provider.value, "workspace_ids": in_use},
        )
    keystore = Keystore(state.layout.api_keys_yaml)
    keystore.delete(provider)
