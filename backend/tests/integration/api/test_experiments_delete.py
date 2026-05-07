"""Integration tests for ``DELETE /workspaces/{ws}/experiments/{id}``."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def _create_ws(client: TestClient) -> str:
    return str(client.post("/workspaces", json={"name": "ws"}).json()["id"])


def _upload(client: TestClient, ws: str) -> None:
    client.post(
        f"/workspaces/{ws}/documents",
        files={"files": ("a.txt", io.BytesIO(b"the quick brown fox " * 20), "text/plain")},
    )


def _wait(client: TestClient, task_id: str, *, max_polls: int = 200) -> str:
    for _ in range(max_polls):
        body = client.get(f"/tasks/{task_id}").json()
        if body["status"] not in {"pending", "running"}:
            return str(body["status"])
    raise AssertionError(f"task {task_id} did not finish")


def _index_once(client: TestClient, ws: str) -> str:
    """Trigger an indexing run and return the spawned experiment id."""
    accepted = client.post(
        f"/workspaces/{ws}/index",
        json={
            "config": {
                "embedder_id": "fake-embedder",
                "chunking": {
                    "strategy": "recursive",
                    "chunk_size": 64,
                    "chunk_overlap": 0,
                },
                "retrieval_strategy": "dense",
                "top_k": 3,
                "llm_id": "echo-llm",
            },
            "force_reindex": True,
        },
    ).json()
    final = _wait(client, accepted["task_id"])
    assert final == "completed", final
    items = client.get(f"/workspaces/{ws}/experiments").json()["items"]
    assert items, "indexing should have created at least one experiment"
    return str(items[0]["id"])


def test_delete_experiment_removes_row(app_state: AppState) -> None:
    """The 204 response should be paired with a missing row on next list."""
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws)
        exp_id = _index_once(client, ws)

        resp = client.delete(f"/workspaces/{ws}/experiments/{exp_id}")
        assert resp.status_code == 204

        items = client.get(f"/workspaces/{ws}/experiments").json()["items"]
        assert all(item["id"] != exp_id for item in items)


def test_delete_unknown_experiment_returns_404(app_state: AppState) -> None:
    """A bogus id under a real workspace must 404, not silently succeed."""
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.delete(f"/workspaces/{ws}/experiments/exp_doesnotexist")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "EXPERIMENT_NOT_FOUND"


def test_delete_experiment_unknown_workspace_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.delete("/workspaces/ws_doesnotexist/experiments/exp_x")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "WORKSPACE_NOT_FOUND"
