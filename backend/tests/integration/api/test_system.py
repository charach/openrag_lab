"""Integration tests for /system/* endpoints (API_SPEC §4)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def test_profile_returns_serialized_hardware(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/system/profile")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cpu"]["cores"] == 8
    assert body["ram"]["total_gb"] == 16.0
    assert body["gpu"]["available"] is True
    assert body["gpu"]["vendor"] == "apple"
    assert body["gpu"]["acceleration_backend"] == "metal"
    assert "metal" in body["gpu"]["available_backends"]
    assert body["os"]["platform"] == "darwin"
    assert body["paths"]["openrag_home"] == str(app_state.layout.root)
    assert body["warnings"] == []


def test_presets_lists_three_with_one_recommended(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/system/presets")
    assert resp.status_code == 200
    presets = resp.json()["presets"]
    assert {p["id"] for p in presets} == {"lite", "balanced", "quality"}
    recommended = [p for p in presets if p["recommended"]]
    assert len(recommended) == 1
    # 16 GiB falls in "quality" tier (>= 12).
    assert recommended[0]["id"] == "quality"
    for p in presets:
        assert p["config"]["chunking"]["chunk_size"] >= 32
        assert p["config"]["retrieval_strategy"] == "dense"


def test_profile_envelopes_unknown_route_with_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/system/does-not-exist")
    assert resp.status_code == 404
