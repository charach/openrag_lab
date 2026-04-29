"""HTTP error envelope + domain-exception → response mapping.

The application layer is the *only* place that knows about HTTP status codes.
Adapters and services raise ``OpenRagError`` subclasses; these handlers turn
them into the envelope defined by API_SPEC §2.3.

Mapping table follows ERROR_CODES.md §12.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from openrag_lab.domain.errors import (
    BackendUnavailableError,
    CancelledError,
    ConfigurationError,
    ExternalApiError,
    ModelNotLoadedError,
    OpenRagError,
    OutOfMemoryError,
    ParseError,
)


def _envelope(
    code: str,
    message: str,
    *,
    recoverable: bool,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "recoverable": recoverable,
            "details": details or {},
        }
    }


def _status_for(exc: OpenRagError) -> int:
    if isinstance(exc, ParseError):
        return 422
    if isinstance(exc, ConfigurationError):
        return 422
    if isinstance(exc, OutOfMemoryError):
        return 507
    if isinstance(exc, BackendUnavailableError):
        return 503
    if isinstance(exc, ExternalApiError):
        return 502
    if isinstance(exc, ModelNotLoadedError):
        return 500
    if isinstance(exc, CancelledError):
        # CancelledError is logically not an error per ERROR_CODES §12.
        return 200
    return 500


class HttpError(Exception):
    """Application-layer error with an explicit HTTP status + error code.

    Used for cases where there is no natural domain exception (e.g.
    ``WORKSPACE_NOT_FOUND``, ``TASK_NOT_FOUND``) — the situation lives in
    the application layer, not the domain.
    """

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        recoverable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.recoverable = recoverable
        self.details = details or {}


def install_exception_handlers(app: FastAPI) -> None:
    """Wire all error handlers onto the FastAPI app."""

    @app.exception_handler(HttpError)
    async def _http_error(_: Request, exc: HttpError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(
                exc.code,
                exc.message,
                recoverable=exc.recoverable,
                details=exc.details,
            ),
        )

    @app.exception_handler(OpenRagError)
    async def _domain_error(_: Request, exc: OpenRagError) -> JSONResponse:
        return JSONResponse(
            status_code=_status_for(exc),
            content=_envelope(
                exc.code,
                exc.user_message,
                recoverable=exc.recoverable,
                details=exc.details,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {}
        loc = list(first.get("loc", ()))
        # FastAPI prefixes ``loc`` with the source ("body", "query", "path") —
        # drop it so the caller gets just the field path.
        if loc and loc[0] in {"body", "query", "path", "header", "cookie"}:
            loc = loc[1:]
        field = ".".join(str(p) for p in loc) or "unknown"
        # Pydantic puts non-JSON-safe values (e.g. exception ctx) into errors;
        # strip them so the response is always serializable.
        safe_errors = [{k: v for k, v in e.items() if k in {"type", "loc", "msg"}} for e in errors]
        return JSONResponse(
            status_code=400,
            content=_envelope(
                "BAD_REQUEST_FIELD",
                f"필드 '{field}'가 올바르지 않습니다.",
                recoverable=True,
                details={"field": field, "errors": safe_errors},
            ),
        )
