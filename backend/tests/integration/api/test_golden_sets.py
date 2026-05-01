"""Integration tests for /workspaces/{id}/golden-sets endpoints (API_SPEC §10)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def _setup(client: TestClient) -> tuple[str, str, list[str]]:
    ws_id = client.post("/workspaces", json={"name": "g"}).json()["id"]
    gs = client.post(
        f"/workspaces/{ws_id}/golden-sets", json={"name": "set"}
    ).json()
    pairs = client.post(
        f"/workspaces/{ws_id}/golden-sets/{gs['id']}/pairs",
        json={
            "pairs": [
                {"question": "Q1", "expected_answer": "A1"},
                {"question": "Q2", "expected_answer": "A2"},
            ]
        },
    ).json()
    return ws_id, gs["id"], pairs["ids"]


def test_list_pairs(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws, gs, _ = _setup(client)
        resp = client.get(f"/workspaces/{ws}/golden-sets/{gs}/pairs")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert {p["question"] for p in items} == {"Q1", "Q2"}


def test_update_pair(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws, gs, ids = _setup(client)
        resp = client.patch(
            f"/workspaces/{ws}/golden-sets/{gs}/pairs/{ids[0]}",
            json={"question": "Q1-edited", "expected_answer": "A1-edited"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["question"] == "Q1-edited"
    assert body["expected_answer"] == "A1-edited"


def test_update_pair_partial(app_state: AppState) -> None:
    """A PATCH with only some fields keeps the others intact."""
    with TestClient(create_app(state=app_state)) as client:
        ws, gs, ids = _setup(client)
        resp = client.patch(
            f"/workspaces/{ws}/golden-sets/{gs}/pairs/{ids[0]}",
            json={"expected_answer": "only-this"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["question"] == "Q1"
    assert body["expected_answer"] == "only-this"


def test_delete_pair(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws, gs, ids = _setup(client)
        resp = client.delete(f"/workspaces/{ws}/golden-sets/{gs}/pairs/{ids[0]}")
        assert resp.status_code == 204
        listing = client.get(f"/workspaces/{ws}/golden-sets/{gs}/pairs").json()
    remaining_ids = {p["id"] for p in listing["items"]}
    assert remaining_ids == {ids[1]}


def test_pair_unknown_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws, gs, _ = _setup(client)
        resp = client.delete(
            f"/workspaces/{ws}/golden-sets/{gs}/pairs/gpair_missing"
        )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "GOLDEN_PAIR_NOT_FOUND"


def test_export_csv(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws, gs, _ = _setup(client)
        resp = client.get(f"/workspaces/{ws}/golden-sets/{gs}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert resp.headers["content-disposition"].startswith("attachment")
    body = resp.text.strip().splitlines()
    assert body[0] == "question,expected_answer"
    assert {body[1], body[2]} == {"Q1,A1", "Q2,A2"}
