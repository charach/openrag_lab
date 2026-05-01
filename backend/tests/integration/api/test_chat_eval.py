"""Integration tests for chat + golden-sets + experiments + evaluate."""

from __future__ import annotations

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


def _index_body(*, llm_id: str | None = None) -> dict:
    return {
        "config": {
            "embedder_id": "fake-embedder",
            "chunking": {"strategy": "recursive", "chunk_size": 64, "chunk_overlap": 8},
            "retrieval_strategy": "dense",
            "top_k": 3,
            "llm_id": llm_id,
        },
    }


def _wait_for_task(client: TestClient, task_id: str, *, max_polls: int = 80) -> str:
    """Poll ``/tasks/{id}`` until the task leaves ``running``.

    Each request ticks FastAPI's event loop, so the indexing/eval task gets
    scheduled even though the test is synchronous.
    """
    for _ in range(max_polls):
        body = client.get(f"/tasks/{task_id}").json()
        if body["status"] not in {"pending", "running"}:
            return str(body["status"])
    raise AssertionError(f"task {task_id} did not finish in {max_polls} polls")


def _index_and_wait(client: TestClient, ws: str, app_state: AppState, body: dict) -> str:
    del app_state  # legacy parameter; kept for callers
    start = client.post(f"/workspaces/{ws}/index", json=body).json()
    final = _wait_for_task(client, start["task_id"])
    assert final == "completed", f"indexing ended in state {final}"
    return str(start["experiment_id"])


def test_chat_retrieval_only_mode(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "the quick brown fox jumps over the lazy dog. " * 30))
        exp_id = _index_and_wait(client, ws, app_state, _index_body(llm_id=None))

        resp = client.post(
            f"/workspaces/{ws}/chat",
            json={"experiment_id": exp_id, "question": "what jumps?"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "retrieval_only"
    assert body["answer"] is None
    assert body["citations"] is None
    assert len(body["retrieval"]["chunks"]) >= 1


def test_chat_with_llm_returns_answer(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "lorem ipsum dolor sit amet. " * 30))
        exp_id = _index_and_wait(client, ws, app_state, _index_body(llm_id="echo-llm"))

        resp = client.post(
            f"/workspaces/{ws}/chat",
            json={"experiment_id": exp_id, "question": "what is lorem?"},
        )
    body = resp.json()
    assert "mode" not in body
    assert isinstance(body["answer"], str)
    assert body["answer"].startswith("echo[")


def test_chat_persists_turn_and_lists_history(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "alpha beta gamma. " * 30))
        exp_id = _index_and_wait(client, ws, app_state, _index_body(llm_id=None))

        first = client.post(
            f"/workspaces/{ws}/chat",
            json={"experiment_id": exp_id, "question": "Q1"},
        ).json()
        second = client.post(
            f"/workspaces/{ws}/chat",
            json={"experiment_id": exp_id, "question": "Q2"},
        ).json()

        history = client.get(
            f"/workspaces/{ws}/experiments/{exp_id}/turns"
        ).json()
    assert {t["id"] for t in history["items"]} == {first["turn_id"], second["turn_id"]}
    questions = {t["question"] for t in history["items"]}
    assert questions == {"Q1", "Q2"}


def test_delete_turn_removes_from_history(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "alpha. " * 30))
        exp_id = _index_and_wait(client, ws, app_state, _index_body(llm_id=None))

        first = client.post(
            f"/workspaces/{ws}/chat",
            json={"experiment_id": exp_id, "question": "Q1"},
        ).json()

        resp = client.delete(f"/workspaces/{ws}/turns/{first['turn_id']}")
        assert resp.status_code == 204

        history = client.get(
            f"/workspaces/{ws}/experiments/{exp_id}/turns"
        ).json()
    assert history["items"] == []


def test_delete_unknown_turn_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.delete(f"/workspaces/{ws}/turns/turn_nope")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "CHAT_TURN_NOT_FOUND"


def test_chat_unknown_experiment_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.post(
            f"/workspaces/{ws}/chat",
            json={"experiment_id": "exp_nope", "question": "hi"},
        )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "EXPERIMENT_NOT_FOUND"


def test_create_and_list_golden_sets(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        created = client.post(f"/workspaces/{ws}/golden-sets", json={"name": "MVP set"}).json()
        assert created["pair_count"] == 0
        listing = client.get(f"/workspaces/{ws}/golden-sets").json()
        assert len(listing["items"]) == 1
        assert listing["items"][0]["id"] == created["id"]


def test_add_pairs_to_golden_set(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        gs_id = client.post(f"/workspaces/{ws}/golden-sets", json={"name": "set"}).json()["id"]
        resp = client.post(
            f"/workspaces/{ws}/golden-sets/{gs_id}/pairs",
            json={
                "pairs": [
                    {"question": "Q1?", "expected_answer": "A1"},
                    {"question": "Q2?"},
                ]
            },
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["added"] == 2
    assert len(body["ids"]) == 2


def test_import_csv_pairs(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        gs_id = client.post(f"/workspaces/{ws}/golden-sets", json={"name": "set"}).json()["id"]
        csv_text = "question,expected_answer\nQ1?,A1\nQ2?,\n"
        resp = client.post(
            f"/workspaces/{ws}/golden-sets/{gs_id}/pairs/import",
            files={"file": ("pairs.csv", io.BytesIO(csv_text.encode()), "text/csv")},
        )
    assert resp.status_code == 201
    assert resp.json()["added"] == 2


def test_import_csv_with_empty_question_returns_422(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        gs_id = client.post(f"/workspaces/{ws}/golden-sets", json={"name": "set"}).json()["id"]
        csv_text = "question,expected_answer\n,A1\n"
        resp = client.post(
            f"/workspaces/{ws}/golden-sets/{gs_id}/pairs/import",
            files={"file": ("pairs.csv", io.BytesIO(csv_text.encode()), "text/csv")},
        )
    assert resp.status_code == 422


def test_list_experiments_after_indexing(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "x " * 50))
        exp_id = _index_and_wait(client, ws, app_state, _index_body())
        items = client.get(f"/workspaces/{ws}/experiments").json()["items"]
    assert any(i["id"] == exp_id for i in items)


def test_experiment_detail(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "x " * 50))
        exp_id = _index_and_wait(client, ws, app_state, _index_body())
        detail = client.get(f"/workspaces/{ws}/experiments/{exp_id}").json()
    assert detail["id"] == exp_id
    assert "config" in detail
    assert "profile" in detail


def test_experiment_detail_unknown_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.get(f"/workspaces/{ws}/experiments/exp_nope")
    assert resp.status_code == 404


def test_evaluate_completes_and_updates_scores(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "the quick brown fox jumps. " * 30))
        exp_id = _index_and_wait(client, ws, app_state, _index_body(llm_id="echo-llm"))

        gs_id = client.post(f"/workspaces/{ws}/golden-sets", json={"name": "tiny"}).json()["id"]
        client.post(
            f"/workspaces/{ws}/golden-sets/{gs_id}/pairs",
            json={"pairs": [{"question": "Who jumps?", "expected_answer": "fox"}]},
        )

        eval_resp = client.post(
            f"/workspaces/{ws}/experiments/{exp_id}/evaluate",
            json={"golden_set_id": gs_id, "judge_llm_id": "echo-llm"},
        ).json()
        _wait_for_task(client, eval_resp["task_id"])

        detail = client.get(f"/workspaces/{ws}/experiments/{exp_id}").json()
    # Echo judge produces an unparseable response → 0.0 scores, but the field
    # must be a number rather than null after evaluation runs.
    assert detail["scores"]["context_precision"] is not None
