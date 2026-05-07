"""Integration tests for ``/models`` — catalog + license acceptance."""

from __future__ import annotations

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def test_list_models_returns_known_embedders(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/models")
    assert resp.status_code == 200
    items = resp.json()["items"]
    ids = {it["id"] for it in items}
    # The three embedders the wizard ships presets for.
    assert {"all-MiniLM-L6-v2", "BAAI/bge-base-en-v1.5", "BAAI/bge-m3"}.issubset(ids)
    for it in items:
        assert it["license_id"] in {"Apache-2.0", "MIT"}
        assert isinstance(it["size_estimate_bytes"], int)
        assert isinstance(it["license_body"], str) and len(it["license_body"]) > 50


def test_get_model_returns_card_with_accepted_false_initially(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/models/all-MiniLM-L6-v2")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "all-MiniLM-L6-v2"
    assert body["license_accepted"] is False


def test_unknown_model_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/models/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "MODEL_NOT_FOUND"


def test_accept_license_persists_across_requests(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        accept_resp = client.post("/models/all-MiniLM-L6-v2/accept-license")
        assert accept_resp.status_code == 200
        assert accept_resp.json() == {
            "accepted": True,
            "model_id": "all-MiniLM-L6-v2",
            "license_id": "Apache-2.0",
        }
        # Subsequent GET reflects the acceptance.
        body = client.get("/models/all-MiniLM-L6-v2").json()
        assert body["license_accepted"] is True

    # Acceptance file persists; a fresh app reading the same layout sees it.
    with TestClient(create_app(state=app_state)) as client:
        # AppState mutates _license_store on first access; reset so the
        # store re-reads the on-disk file and we exercise persistence.
        app_state._license_store = None
        body = client.get("/models/all-MiniLM-L6-v2").json()
        assert body["license_accepted"] is True


def test_accept_license_unknown_model_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/models/nope/accept-license")
    assert resp.status_code == 404


def test_presets_include_embedder_license_id(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/system/presets")
    assert resp.status_code == 200
    presets = resp.json()["presets"]
    license_ids = {p["config"]["embedder_license_id"] for p in presets}
    # Every preset's embedder is in the catalog → license_id is non-null.
    assert None not in license_ids
    assert license_ids.issubset({"Apache-2.0", "MIT"})
