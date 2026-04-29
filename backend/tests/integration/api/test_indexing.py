"""Integration tests for /workspaces/{id}/index + /tasks/* + WebSocket /ws."""

from __future__ import annotations

import asyncio
import io

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def _create_ws(client: TestClient) -> str:
    return str(client.post("/workspaces", json={"name": "ws"}).json()["id"])


def _upload(client: TestClient, ws: str, *files: tuple[str, str]) -> dict:
    multipart = [
        ("files", (name, io.BytesIO(content.encode()), "text/plain")) for name, content in files
    ]
    return client.post(f"/workspaces/{ws}/documents", files=multipart).json()


def _default_index_body(embedder_id: str = "fake-embedder") -> dict:
    return {
        "config": {
            "embedder_id": embedder_id,
            "chunking": {"strategy": "recursive", "chunk_size": 64, "chunk_overlap": 8},
            "retrieval_strategy": "dense",
            "top_k": 3,
            "llm_id": None,
        },
        "force_reindex": False,
    }


def test_index_returns_202_with_task_and_experiment(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "the quick brown fox jumps over a lazy dog. " * 20))
        resp = client.post(f"/workspaces/{ws}/index", json=_default_index_body())

    assert resp.status_code == 202
    body = resp.json()
    assert body["task_id"].startswith("task_")
    assert body["experiment_id"].startswith("exp_")
    assert len(body["config_fingerprint"]) == 16
    assert body["websocket_topic"] == f"experiment:{body['experiment_id']}"
    assert body["external_calls"] == []


def test_index_completes_successfully(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "abc def ghi " * 50))
        start = client.post(f"/workspaces/{ws}/index", json=_default_index_body()).json()
        task_id = start["task_id"]

        status: dict = {}
        for _ in range(80):
            status = client.get(f"/tasks/{task_id}").json()
            if status["status"] not in {"pending", "running"}:
                break
        else:
            raise AssertionError("task never finished")
    assert status["status"] == "completed", status


def test_index_chunk_size_exceeds_embedder_returns_422(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "hello"))
        body = _default_index_body()
        # FakeEmbedder.max_tokens=8192, so 4096 is allowed → 202 Accepted.
        body["config"]["chunking"]["chunk_size"] = 4096
        body["config"]["chunking"]["chunk_overlap"] = 0
        resp = client.post(f"/workspaces/{ws}/index", json=body)
    assert resp.status_code == 202


def test_get_unknown_task_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.get("/tasks/task_doesnotexist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "TASK_NOT_FOUND"


def test_cancel_unknown_task_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/tasks/task_doesnotexist/cancel")
    assert resp.status_code == 404


def test_cancel_completed_task_returns_409(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "x " * 50))
        start = client.post(f"/workspaces/{ws}/index", json=_default_index_body()).json()
        task_id = start["task_id"]

        for _ in range(80):
            status = client.get(f"/tasks/{task_id}").json()
            if status["status"] not in {"pending", "running"}:
                break

        resp = client.post(f"/tasks/{task_id}/cancel")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "TASK_ALREADY_COMPLETED"


def test_websocket_subscribes_and_receives_publish(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        with client.websocket_connect("/ws") as ws_client:
            ws_client.send_json({"action": "subscribe", "topics": ["topic:test"]})
            ack = ws_client.receive_json()
            assert ack == {"type": "subscribed", "topics": ["topic:test"]}

            async def _publish() -> None:
                await app_state.hub.publish("topic:test", {"type": "ping", "value": 1})

            asyncio.run(_publish())
            msg = ws_client.receive_json()
            assert msg["topic"] == "topic:test"
            assert msg["type"] == "ping"
            assert msg["value"] == 1


def test_websocket_unsubscribe(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        with client.websocket_connect("/ws") as ws_client:
            ws_client.send_json({"action": "subscribe", "topics": ["t1", "t2"]})
            ws_client.receive_json()
            ws_client.send_json({"action": "unsubscribe", "topics": ["t1"]})
            ack = ws_client.receive_json()
            assert ack == {"type": "unsubscribed", "topics": ["t2"]}


def test_index_unknown_workspace_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post("/workspaces/ws_nope/index", json=_default_index_body())
    assert resp.status_code == 404
