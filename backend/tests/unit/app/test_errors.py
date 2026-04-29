"""Unit tests for the error envelope + handlers."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from openrag_lab.app.errors import HttpError, install_exception_handlers
from openrag_lab.domain.errors import (
    BackendUnavailableError,
    CancelledError,
    ConfigurationError,
    ExternalApiError,
    OpenRagError,
    OutOfMemoryError,
    ParseError,
)


class _Body(BaseModel):
    n: int


def _make_app() -> FastAPI:
    app = FastAPI()
    install_exception_handlers(app)

    @app.get("/raise/{kind}")
    async def raise_route(kind: str) -> dict[str, str]:
        if kind == "parse":
            raise ParseError("암호화된 PDF", code="PARSE_ENCRYPTED_PDF", details={"x": 1})
        if kind == "config":
            raise ConfigurationError("설정 오류")
        if kind == "oom":
            raise OutOfMemoryError("메모리 부족")
        if kind == "backend":
            raise BackendUnavailableError("백엔드 없음")
        if kind == "external":
            raise ExternalApiError("외부 API 실패")
        if kind == "cancel":
            raise CancelledError("취소됨")
        if kind == "http":
            raise HttpError(
                status_code=404,
                code="WORKSPACE_NOT_FOUND",
                message="없음",
                details={"workspace_id": "ws_xxx"},
            )
        if kind == "generic":
            raise OpenRagError("뭔가 망가짐")
        return {"ok": "true"}

    @app.post("/validate")
    async def validate_route(body: _Body) -> dict[str, int]:
        return {"n": body.n}

    return app


def test_parse_error_maps_to_422_with_envelope() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/parse")
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "PARSE_ENCRYPTED_PDF"
    assert body["error"]["recoverable"] is False
    assert body["error"]["details"] == {"x": 1}


def test_configuration_error_maps_to_422_with_default_code() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/config")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "CONFIG_VALIDATION_FAILED"


def test_oom_maps_to_507() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/oom")
    assert resp.status_code == 507
    assert resp.json()["error"]["code"] == "OUT_OF_MEMORY"


def test_backend_unavailable_maps_to_503() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/backend")
    assert resp.status_code == 503


def test_external_api_failure_maps_to_502() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/external")
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "EXTERNAL_API_FAILED"


def test_cancelled_maps_to_200() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/cancel")
    assert resp.status_code == 200
    assert resp.json()["error"]["code"] == "OPERATION_CANCELLED"


def test_generic_openrag_error_maps_to_500() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/generic")
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "INTERNAL_ERROR"


def test_http_error_uses_specified_status_and_code() -> None:
    with TestClient(_make_app()) as client:
        resp = client.get("/raise/http")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "WORKSPACE_NOT_FOUND"
    assert body["error"]["details"] == {"workspace_id": "ws_xxx"}


def test_request_validation_returns_bad_request_field() -> None:
    with TestClient(_make_app()) as client:
        resp = client.post("/validate", json={"n": "not-an-int"})
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "BAD_REQUEST_FIELD"
    assert body["error"]["details"]["field"] == "n"
