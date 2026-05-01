"""Integration tests for /workspaces/{id}/documents + /chunking/preview."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

from openrag_lab.app.main import create_app
from openrag_lab.app.state import AppState


def _create_ws(client: TestClient, name: str = "ws") -> str:
    return str(client.post("/workspaces", json={"name": name}).json()["id"])


def _upload(
    client: TestClient,
    ws_id: str,
    *files: tuple[str, str],
) -> dict:
    multipart = [
        ("files", (name, io.BytesIO(content.encode()), "text/plain")) for name, content in files
    ]
    resp = client.post(f"/workspaces/{ws_id}/documents", files=multipart)
    return resp.json() | {"_status": resp.status_code}


def test_upload_single_txt(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        result = _upload(client, ws, ("notes.txt", "hello world"))
    assert result["_status"] == 201
    assert len(result["uploaded"]) == 1
    item = result["uploaded"][0]
    assert item["filename"] == "notes.txt"
    assert item["format"] == "txt"
    assert item["size_bytes"] == len("hello world")
    assert item["content_hash"].startswith("sha256:")
    assert item["indexing_status"] == "not_indexed"


def test_upload_unsupported_format_goes_to_failed(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        result = _upload(client, ws, ("report.xlsx", "binarycontent"))
    assert result["_status"] == 201
    assert len(result["uploaded"]) == 0
    assert len(result["failed"]) == 1
    assert result["failed"][0]["error"]["code"] == "PARSE_UNSUPPORTED_FORMAT"


def test_upload_duplicate_skipped(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        first = _upload(client, ws, ("a.txt", "same"))
        second = _upload(client, ws, ("a.txt", "same"))
    assert len(first["uploaded"]) == 1
    assert len(second["skipped"]) == 1
    assert second["skipped"][0]["reason"] == "DUPLICATE_CONTENT_HASH"
    assert second["skipped"][0]["existing_id"] == first["uploaded"][0]["id"]


def test_list_documents_after_upload(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "a"), ("b.md", "# title"))
        listing = client.get(f"/workspaces/{ws}/documents").json()
    assert len(listing["items"]) == 2
    formats = {i["format"] for i in listing["items"]}
    assert formats == {"txt", "md"}


def test_delete_document(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        upload = _upload(client, ws, ("x.txt", "content"))
        doc_id = upload["uploaded"][0]["id"]

        del_resp = client.delete(f"/workspaces/{ws}/documents/{doc_id}")
        assert del_resp.status_code == 204

        # Subsequent listing is empty.
        items = client.get(f"/workspaces/{ws}/documents").json()["items"]
        assert items == []


def test_delete_unknown_document_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.delete(f"/workspaces/{ws}/documents/doc_missing")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"


def test_rename_document(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        upload = _upload(client, ws, ("before.txt", "content"))
        doc_id = upload["uploaded"][0]["id"]
        resp = client.patch(
            f"/workspaces/{ws}/documents/{doc_id}",
            json={"filename": "after.txt"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "after.txt"


def test_rename_document_strips_path_traversal(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        upload = _upload(client, ws, ("a.txt", "x"))
        doc_id = upload["uploaded"][0]["id"]
        resp = client.patch(
            f"/workspaces/{ws}/documents/{doc_id}",
            json={"filename": "../../escape.txt"},
        )
    assert resp.status_code == 200
    assert resp.json()["filename"] == "escape.txt"


def test_rename_document_conflict(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        upload = _upload(client, ws, ("a.txt", "alpha"), ("b.txt", "beta"))
        target = upload["uploaded"][0]["id"]
        resp = client.patch(
            f"/workspaces/{ws}/documents/{target}",
            json={"filename": "b.txt"},
        )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "DOCUMENT_FILENAME_CONFLICT"


def test_rename_document_unknown_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.patch(
            f"/workspaces/{ws}/documents/doc_missing",
            json={"filename": "anything.txt"},
        )
    assert resp.status_code == 404


def test_chunking_preview_recursive(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        text = ("Lorem ipsum dolor sit amet. " * 60).strip()
        _upload(client, ws, ("a.txt", text))
        resp = client.post(
            f"/workspaces/{ws}/chunking/preview",
            json={
                "config": {
                    "strategy": "recursive",
                    "chunk_size": 64,
                    "chunk_overlap": 8,
                },
                "max_chunks": 20,
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["chunks"]) >= 1
    assert all("color_hint" in c and c["color_hint"].startswith("hsl") for c in body["chunks"])
    assert body["stats"]["total_chunks_estimated"] == len(body["chunks"])
    assert len(body["config_key"]) == 16


def test_chunking_preview_with_explicit_document_id(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        upload = _upload(client, ws, ("a.txt", "first"), ("b.txt", "second body content"))
        target = upload["uploaded"][1]["id"]
        resp = client.post(
            f"/workspaces/{ws}/chunking/preview",
            json={
                "document_id": target,
                "config": {"strategy": "fixed", "chunk_size": 32, "chunk_overlap": 0},
            },
        )
    assert resp.status_code == 200
    assert any("second" in c["content"] for c in resp.json()["chunks"])


def test_chunking_preview_validation_error(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        _upload(client, ws, ("a.txt", "x"))
        resp = client.post(
            f"/workspaces/{ws}/chunking/preview",
            json={
                "config": {"strategy": "recursive", "chunk_size": 16},  # below MIN_CHUNK_SIZE=32
            },
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "CONFIG_VALIDATION_FAILED"


def test_chunking_preview_no_documents_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        resp = client.post(
            f"/workspaces/{ws}/chunking/preview",
            json={"config": {"strategy": "recursive", "chunk_size": 64}},
        )
    assert resp.status_code == 404


def test_upload_to_unknown_workspace_returns_404(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        result = _upload(client, "ws_notreal", ("a.txt", "x"))
    assert result["_status"] == 404


def test_upload_filename_with_path_traversal_is_sanitized(app_state: AppState) -> None:
    """PROBLEM.md P-001 — ``../../etc/passwd`` must not escape documents/."""
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        result = _upload(client, ws, ("../../../etc/evil.txt", "evil"))
    assert result["_status"] == 201
    # Filename was stripped to its basename — the file lives inside documents/.
    uploaded = result["uploaded"]
    assert len(uploaded) == 1
    assert uploaded[0]["filename"] == "evil.txt"

    # No ``etc/`` directory was created under OPENRAG_HOME.
    home = app_state.layout.root
    assert not (home / "etc").exists()


def test_upload_pure_dotdot_filename_rejected(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        result = _upload(client, ws, ("..", "x"))
    assert result["_status"] == 201
    failed = result["failed"]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "PATH_OUTSIDE_WORKSPACE"


def test_upload_windows_separator_filename_sanitized(app_state: AppState) -> None:
    with TestClient(create_app(state=app_state)) as client:
        ws = _create_ws(client)
        result = _upload(client, ws, ("..\\..\\evil.txt", "evil"))
    uploaded = result["uploaded"]
    assert len(uploaded) == 1
    assert uploaded[0]["filename"] == "evil.txt"
