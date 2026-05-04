"""External provider key endpoints (API_SPEC §15.0.1-§15.0.3)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.external import ExternalProvider
from openrag_lab.infra.external.keystore import Keystore

# --------------------------------------------------------------------- helpers


def _state_with_http(
    state: AppState,
    handler: Callable[[httpx.Request], httpx.Response],
) -> AppState:
    """Return a copy of the state with a mock-transport http_client attached."""
    return replace(
        state,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=2.0),
    )


def _ok_validation(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"data": []})


# ---------------------------------------------------------------- GET /list


def test_list_providers_returns_all_four_unregistered_initially(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/system/external-providers")
    assert resp.status_code == 200
    body = resp.json()
    ids = {p["id"] for p in body["providers"]}
    assert ids == {"openai", "anthropic", "gemini", "openrouter"}
    for p in body["providers"]:
        assert p["key_registered"] is False
        assert "key_suffix" not in p
        assert isinstance(p["supported_models"], list) and p["supported_models"]


def test_list_providers_marks_registered_with_suffix(app_state: AppState) -> None:
    Keystore(app_state.layout.api_keys_yaml).set(ExternalProvider.OPENAI, "sk-abcd1234")
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/system/external-providers")
    body = resp.json()
    openai_entry = next(p for p in body["providers"] if p["id"] == "openai")
    assert openai_entry["key_registered"] is True
    assert openai_entry["key_suffix"] == "...1234"
    assert openai_entry["validation_status"] == "not_validated"
    other = next(p for p in body["providers"] if p["id"] == "anthropic")
    assert other["key_registered"] is False


# ---------------------------------------------------------------- POST /key


def test_register_key_with_validate_now_ok(app_state: AppState) -> None:
    state = _state_with_http(app_state, _ok_validation)
    with TestClient(create_app(state=state)) as client:
        resp = client.post(
            "/system/external-providers/openai/key",
            json={"key": "sk-test-9999", "validate_now": True},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "provider_id": "openai",
        "key_registered": True,
        "key_suffix": "...9999",
        "registered_at": body["registered_at"],
        "validation_status": "ok",
    }
    # Round-trip: keystore actually persisted.
    assert Keystore(state.layout.api_keys_yaml).get(ExternalProvider.OPENAI) == "sk-test-9999"


def test_register_key_skips_validation_when_disabled(app_state: AppState) -> None:
    # No http_client attached, but validate_now=False so we shouldn't need it.
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post(
            "/system/external-providers/anthropic/key",
            json={"key": "anth-key", "validate_now": False},
        )
    assert resp.status_code == 200
    assert resp.json()["validation_status"] == "not_validated"
    assert Keystore(app_state.layout.api_keys_yaml).get(ExternalProvider.ANTHROPIC) == "anth-key"


def test_register_key_returns_422_on_invalid(app_state: AppState) -> None:
    def reject(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad"})

    state = _state_with_http(app_state, reject)
    with TestClient(create_app(state=state)) as client:
        resp = client.post(
            "/system/external-providers/openai/key",
            json={"key": "sk-bad", "validate_now": True},
        )
    assert resp.status_code == 422
    err = resp.json()["error"]
    assert err["code"] == "EXTERNAL_API_KEY_INVALID"
    assert err["recoverable"] is True
    assert err["details"]["provider_id"] == "openai"
    # Critical: the key MUST NOT be persisted when validation rejects it.
    assert Keystore(state.layout.api_keys_yaml).get(ExternalProvider.OPENAI) is None


def test_register_key_records_rate_limited_status(app_state: AppState) -> None:
    def rate_limit(_: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "rate"})

    state = _state_with_http(app_state, rate_limit)
    with TestClient(create_app(state=state)) as client:
        resp = client.post(
            "/system/external-providers/openrouter/key",
            json={"key": "or-x", "validate_now": True},
        )
    # Rate-limited at validate time isn't fatal — the key still registers,
    # the user can re-validate later.
    assert resp.status_code == 200
    assert resp.json()["validation_status"] == "rate_limited"
    assert Keystore(state.layout.api_keys_yaml).get(ExternalProvider.OPENROUTER) == "or-x"


def test_register_key_unknown_provider_returns_422(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post(
            "/system/external-providers/mistral/key",
            json={"key": "x", "validate_now": False},
        )
    assert resp.status_code == 422
    err = resp.json()["error"]
    assert err["code"] == "EXTERNAL_PROVIDER_UNKNOWN"
    assert "openai" in err["details"]["supported_providers"]


def test_register_key_rejects_empty_key(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post(
            "/system/external-providers/openai/key",
            json={"key": "", "validate_now": False},
        )
    # Pydantic min_length=1 → app's BAD_REQUEST_FIELD (400) per app/errors.py.
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "BAD_REQUEST_FIELD"


@pytest.mark.parametrize(
    ("provider_id", "expected_url_substring", "expected_auth_header_name"),
    [
        ("openai", "api.openai.com/v1/models", "authorization"),
        ("anthropic", "api.anthropic.com/v1/models", "x-api-key"),
        ("gemini", "generativelanguage.googleapis.com/v1beta/models", None),
        ("openrouter", "openrouter.ai/api/v1/models", "authorization"),
    ],
)
def test_validate_now_hits_correct_endpoint_per_provider(
    app_state: AppState,
    provider_id: str,
    expected_url_substring: str,
    expected_auth_header_name: str | None,
) -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        if expected_auth_header_name:
            seen["auth"] = request.headers.get(expected_auth_header_name)
        return httpx.Response(200, json={"data": []})

    state = _state_with_http(app_state, handler)
    with TestClient(create_app(state=state)) as client:
        resp = client.post(
            f"/system/external-providers/{provider_id}/key",
            json={"key": "K123", "validate_now": True},
        )
    assert resp.status_code == 200
    assert expected_url_substring in seen["url"]
    if expected_auth_header_name == "authorization":
        assert seen["auth"] == "Bearer K123"
    elif expected_auth_header_name == "x-api-key":
        assert seen["auth"] == "K123"


# ---------------------------------------------------------------- DELETE /key


def test_delete_key_removes_when_unused(app_state: AppState) -> None:
    Keystore(app_state.layout.api_keys_yaml).set(ExternalProvider.GEMINI, "gem")
    with TestClient(create_app(state=app_state)) as client:
        resp = client.delete("/system/external-providers/gemini/key")
    assert resp.status_code == 204
    assert Keystore(app_state.layout.api_keys_yaml).get(ExternalProvider.GEMINI) is None


def test_delete_key_idempotent_when_not_registered(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.delete("/system/external-providers/openai/key")
    assert resp.status_code == 204


def test_delete_key_409_when_provider_in_use(app_state: AppState) -> None:
    """Create a workspace + experiment whose llm_id references openai → delete blocked."""
    Keystore(app_state.layout.api_keys_yaml).set(ExternalProvider.OPENAI, "k")

    from datetime import UTC, datetime

    from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
    from openrag_lab.domain.models.chunk import ChunkingConfig
    from openrag_lab.domain.models.enums import (
        ChunkingStrategy,
        ExperimentStatus,
        RetrievalStrategy,
    )
    from openrag_lab.domain.models.experiment import (
        EvaluationScores,
        ExperimentConfig,
        ExperimentResult,
        PerformanceProfile,
    )
    from openrag_lab.domain.models.ids import new_experiment_id
    from openrag_lab.domain.models.workspace import WorkspaceMeta
    from openrag_lab.infra.db.repositories._common import to_iso
    from openrag_lab.infra.db.repositories.experiment_repo import ExperimentRepository

    registry = WorkspaceRegistry(app_state.layout)
    ws = registry.create(WorkspaceMeta(name="t"))
    cfg = ExperimentConfig(
        embedder_id="e",
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE, chunk_size=256, chunk_overlap=32
        ),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=4,
        llm_id="external:openai:gpt-4o",
    )
    exp_id = new_experiment_id()
    started = datetime.now(UTC)
    with registry.open(ws.id) as conn:
        repo = ExperimentRepository(conn)
        repo.add_pending(exp_id, ws.id, cfg, started_at_iso=to_iso(started))
        repo.save_result(
            ExperimentResult(
                experiment_id=exp_id,
                workspace_id=ws.id,
                config=cfg,
                scores=EvaluationScores(),
                profile=PerformanceProfile(),
                status=ExperimentStatus.COMPLETED,
                started_at=started,
                completed_at=datetime.now(UTC),
            )
        )

    with TestClient(create_app(state=app_state)) as client:
        resp = client.delete("/system/external-providers/openai/key")

    assert resp.status_code == 409
    err = resp.json()["error"]
    assert err["code"] == "PROVIDER_IN_USE"
    assert err["recoverable"] is False
    assert str(ws.id) in err["details"]["workspace_ids"]
    # The key MUST remain registered after the failed delete.
    assert Keystore(app_state.layout.api_keys_yaml).get(ExternalProvider.OPENAI) == "k"


def test_delete_key_unknown_provider_returns_422(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.delete("/system/external-providers/mistral/key")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "EXTERNAL_PROVIDER_UNKNOWN"
