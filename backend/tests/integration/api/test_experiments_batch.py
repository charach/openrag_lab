"""Integration tests for ``POST /workspaces/{ws}/experiments/batch``."""

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
        files={"files": ("a.txt", io.BytesIO(b"the quick brown fox jumps. " * 30), "text/plain")},
    )


def _wait(client: TestClient, task_id: str, *, max_polls: int = 200) -> str:
    for _ in range(max_polls):
        body = client.get(f"/tasks/{task_id}").json()
        if body["status"] not in {"pending", "running"}:
            return str(body["status"])
    raise AssertionError(f"task {task_id} did not finish")


def _golden_set_with_pair(client: TestClient, ws: str) -> str:
    gs_id: str = client.post(f"/workspaces/{ws}/golden-sets", json={"name": "tiny"}).json()["id"]
    client.post(
        f"/workspaces/{ws}/golden-sets/{gs_id}/pairs",
        json={"pairs": [{"question": "Who jumps?", "expected_answer": "fox"}]},
    )
    return gs_id


def _batch_body(gs_id: str, *, chunk_sizes: list[int]) -> dict:
    return {
        "embedders": ["fake-embedder"],
        "chunkings": [
            {"strategy": "recursive", "chunk_size": size, "chunk_overlap": 0}
            for size in chunk_sizes
        ],
        "retrievals": ["dense"],
        "evaluators": ["context_precision", "context_recall"],
        "golden_set_id": gs_id,
        "llm_id": "echo-llm",
        "judge_llm_id": "echo-llm",
        "top_k": 3,
    }


def test_batch_returns_202_with_batch_id_and_topic(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws)
        gs_id = _golden_set_with_pair(client, ws)
        resp = client.post(
            f"/workspaces/{ws}/experiments/batch",
            json=_batch_body(gs_id, chunk_sizes=[64, 96]),
        )
    assert resp.status_code == 202
    body = resp.json()
    assert body["task_id"].startswith("task_")
    assert body["batch_id"].startswith("batch_")
    assert body["websocket_topic"] == f"experiments.batch.{body['batch_id']}"
    # 1 embedder × 2 chunkings × 1 retrieval × 2 evaluators = 4
    assert body["total_evals"] == 4


def test_batch_runs_each_combo_serially(app_state: AppState) -> None:
    """All combos finish, each producing its own experiment row."""
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws)
        gs_id = _golden_set_with_pair(client, ws)
        accepted = client.post(
            f"/workspaces/{ws}/experiments/batch",
            json=_batch_body(gs_id, chunk_sizes=[64, 96]),
        ).json()
        final = _wait(client, accepted["task_id"])
        assert final == "completed", final

        # Two distinct combos → two new experiment rows.
        items = client.get(f"/workspaces/{ws}/experiments").json()["items"]
    assert len(items) >= 2
    chunk_sizes = sorted(it["config_fingerprint"] for it in items)
    assert len(set(chunk_sizes)) == len(chunk_sizes)


def test_batch_publishes_started_progress_completed(app_state: AppState) -> None:
    """The websocket carries a single started, one progress per combo, and one completed."""
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws)
        gs_id = _golden_set_with_pair(client, ws)

        with client.websocket_connect("/ws") as ws_client:
            accepted = client.post(
                f"/workspaces/{ws}/experiments/batch",
                json=_batch_body(gs_id, chunk_sizes=[64, 96]),
            ).json()
            ws_client.send_json(
                {"action": "subscribe", "topics": [accepted["websocket_topic"]]}
            )
            ack = ws_client.receive_json()
            assert ack["type"] == "subscribed"

            # Drain until completion.
            seen_types: list[str] = []
            while True:
                msg = ws_client.receive_json()
                if msg.get("type") in {"started", "progress", "completed"}:
                    seen_types.append(msg["type"])
                if msg.get("type") == "completed":
                    completed = msg
                    break

            _wait(client, accepted["task_id"])

    assert seen_types[0] == "started"
    assert seen_types[-1] == "completed"
    assert seen_types.count("progress") == 2
    assert completed["batch_id"] == accepted["batch_id"]
    assert len(completed["results"]) == 2
    assert completed["cancelled"] is False


def test_batch_unknown_golden_set_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.post(
            f"/workspaces/{ws}/experiments/batch",
            json=_batch_body("gs_doesnotexist", chunk_sizes=[64]),
        )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "GOLDEN_SET_NOT_FOUND"


def test_batch_unknown_workspace_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        resp = client.post(
            "/workspaces/ws_nope/experiments/batch",
            json=_batch_body("gs_x", chunk_sizes=[64]),
        )
    assert resp.status_code == 404


def test_batch_empty_matrix_rejected_at_validation(app_state: AppState) -> None:
    """Pydantic ``min_length=1`` blocks an empty embedders/chunkings list."""
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        body = {
            "embedders": [],
            "chunkings": [],
            "retrievals": [],
            "golden_set_id": "gs_x",
        }
        resp = client.post(f"/workspaces/{ws}/experiments/batch", json=body)
    # The app maps Pydantic validation errors to 400 via the global handler.
    assert resp.status_code == 400


def test_batch_filtered_scores_match_evaluator_selection(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws)
        gs_id = _golden_set_with_pair(client, ws)

        with client.websocket_connect("/ws") as ws_client:
            body = _batch_body(gs_id, chunk_sizes=[64])
            body["evaluators"] = ["faithfulness"]
            accepted = client.post(
                f"/workspaces/{ws}/experiments/batch", json=body
            ).json()
            ws_client.send_json(
                {"action": "subscribe", "topics": [accepted["websocket_topic"]]}
            )
            ws_client.receive_json()  # ack
            while True:
                msg = ws_client.receive_json()
                if msg.get("type") == "completed":
                    break
            _wait(client, accepted["task_id"])

    assert msg["results"][0]["scores"].keys() == {"faithfulness"}
