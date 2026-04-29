"""Integration tests for /workspaces (API_SPEC §5)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def test_list_empty_initially(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/workspaces")
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "next_cursor": None}


def test_create_returns_201_with_workspace(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/workspaces", json={"name": "변호사 자료실"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"].startswith("ws_")
    assert body["name"] == "변호사 자료실"
    assert body["stats"] == {"document_count": 0, "chunk_count": 0, "experiment_count": 0}
    assert body["config"]["embedder_id"] is None  # no preset


def test_create_with_preset_materializes_config(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/workspaces", json={"name": "with-preset", "preset_id": "balanced"})
    assert resp.status_code == 201
    config = resp.json()["config"]
    assert config["embedder_id"] == "BAAI/bge-base-en-v1.5"
    assert config["chunking"]["chunk_size"] == 512
    assert config["retrieval_strategy"] == "dense"


def test_create_with_unknown_preset_returns_400(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/workspaces", json={"name": "x", "preset_id": "does-not-exist"})
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "BAD_REQUEST_FIELD"
    assert body["error"]["details"]["field"] == "preset_id"


def test_create_then_list_then_get_then_delete(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        created = client.post("/workspaces", json={"name": "round-trip"}).json()
        ws_id = created["id"]

        listing = client.get("/workspaces").json()
        assert any(item["id"] == ws_id for item in listing["items"])

        detail = client.get(f"/workspaces/{ws_id}").json()
        assert detail["id"] == ws_id
        assert detail["name"] == "round-trip"
        assert "config" in detail

        del_resp = client.delete(f"/workspaces/{ws_id}")
        assert del_resp.status_code == 204
        assert del_resp.text == ""

        # Now gone.
        miss = client.get(f"/workspaces/{ws_id}")
        assert miss.status_code == 404
        assert miss.json()["error"]["code"] == "WORKSPACE_NOT_FOUND"
        assert miss.json()["error"]["details"]["workspace_id"] == ws_id


def test_get_unknown_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/workspaces/ws_doesnotexist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "WORKSPACE_NOT_FOUND"


def test_delete_unknown_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.delete("/workspaces/ws_doesnotexist")
    assert resp.status_code == 404


def test_create_validates_name_length(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/workspaces", json={"name": ""})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "BAD_REQUEST_FIELD"


def test_listing_orders_newest_first(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        first = client.post("/workspaces", json={"name": "older"}).json()
        second = client.post("/workspaces", json={"name": "newer"}).json()
        items = client.get("/workspaces").json()["items"]
    assert [i["id"] for i in items[:2]] == [second["id"], first["id"]]
