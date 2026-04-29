"""Integration tests for /workspaces/{id}/config/export + import."""

from __future__ import annotations

import io
import json

import yaml
from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def _create_ws(client: TestClient, name: str = "ws") -> str:
    return str(client.post("/workspaces", json={"name": name}).json()["id"])


def _wait(client: TestClient, task_id: str) -> None:
    for _ in range(80):
        body = client.get(f"/tasks/{task_id}").json()
        if body["status"] not in {"pending", "running"}:
            return


def _index(client: TestClient, ws: str) -> str:
    files = [("files", ("a.txt", io.BytesIO(b"hello world " * 30), "text/plain"))]
    client.post(f"/workspaces/{ws}/documents", files=files)
    body = {
        "config": {
            "embedder_id": "fake-embedder",
            "chunking": {"strategy": "recursive", "chunk_size": 64, "chunk_overlap": 8},
            "retrieval_strategy": "dense",
            "top_k": 3,
            "llm_id": None,
        }
    }
    start = client.post(f"/workspaces/{ws}/index", json=body).json()
    _wait(client, start["task_id"])
    return str(start["experiment_id"])


def test_export_yaml_after_indexing(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client, "변호사 자료실")
        _index(client, ws)
        resp = client.get(f"/workspaces/{ws}/config/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/yaml")
    parsed = yaml.safe_load(resp.text)
    assert parsed["version"] == "1"
    assert parsed["workspace"]["name"] == "변호사 자료실"
    assert parsed["config"]["embedder_id"] == "fake-embedder"
    assert parsed["meta"]["fingerprint"]


def test_export_json_format(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _index(client, ws)
        resp = client.get(f"/workspaces/{ws}/config/export?format=json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == "1"


def test_export_without_experiment_returns_409(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.get(f"/workspaces/{ws}/config/export")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFIG_VALIDATION_FAILED"


def test_import_yaml_updates_workspace_name(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client, "old-name")
        payload = {
            "version": "1",
            "workspace": {"name": "new-name", "description": "imported"},
            "config": {
                "embedder_id": "fake-embedder",
                "chunking": {
                    "strategy": "recursive",
                    "chunk_size": 64,
                    "chunk_overlap": 8,
                },
                "retrieval_strategy": "dense",
                "top_k": 3,
                "llm_id": None,
            },
        }
        body = yaml.safe_dump(payload, allow_unicode=True)
        resp = client.post(
            f"/workspaces/{ws}/config/import",
            data=body,
            headers={"content-type": "application/yaml"},
        )
    assert resp.status_code == 200
    result = resp.json()
    assert result["applied"] is True
    assert len(result["fingerprint"]) == 16

    # Workspace name actually changed.
    with TestClient(create_app(state=app_state)) as client:
        listing = client.get("/workspaces").json()["items"]
    assert any(item["id"] == ws and item["name"] == "new-name" for item in listing)


def test_import_json_body(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        payload = {
            "version": "1",
            "workspace": {"name": "via-json"},
            "config": {
                "embedder_id": "fake-embedder",
                "chunking": {"strategy": "fixed", "chunk_size": 128, "chunk_overlap": 0},
                "retrieval_strategy": "dense",
                "top_k": 5,
                "llm_id": None,
            },
        }
        resp = client.post(
            f"/workspaces/{ws}/config/import",
            content=json.dumps(payload),
            headers={"content-type": "application/json"},
        )
    assert resp.status_code == 200


def test_import_unsupported_version_returns_422(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.post(
            f"/workspaces/{ws}/config/import",
            content=yaml.safe_dump({"version": "99", "workspace": {"name": "x"}, "config": {}}),
            headers={"content-type": "application/yaml"},
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "CONFIG_VERSION_TOO_NEW"


def test_import_invalid_yaml_returns_400(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.post(
            f"/workspaces/{ws}/config/import",
            content="not: valid: yaml: at: all\n  - mixed",
            headers={"content-type": "application/yaml"},
        )
    assert resp.status_code == 400


def test_export_unknown_workspace_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/workspaces/ws_nope/config/export")
    assert resp.status_code == 404


def test_import_round_trip(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client, "original")
        _index(client, ws)
        exported = client.get(f"/workspaces/{ws}/config/export").text
        parsed = yaml.safe_load(exported)
        # Re-import the same payload — fingerprint must match.
        resp = client.post(
            f"/workspaces/{ws}/config/import",
            content=exported,
            headers={"content-type": "application/yaml"},
        ).json()
    assert resp["fingerprint"] == parsed["meta"]["fingerprint"]
    assert resp["requires_reindex"] is False
