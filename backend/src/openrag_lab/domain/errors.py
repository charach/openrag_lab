"""Domain exception hierarchy.

All adapter / service code raises these instead of leaking library-specific
exceptions. The application layer middleware translates them into the HTTP
error envelope defined by ERROR_CODES.md.

Design ref: docs/ARCHITECTURE_v3.md §9.1, docs/ERROR_CODES.md §12.
"""

from __future__ import annotations

from typing import Any


class OpenRagError(Exception):
    """Root of all domain exceptions.

    Attributes:
        code: Stable identifier from ERROR_CODES.md (e.g. ``PARSE_ENCRYPTED_PDF``).
        user_message: Korean message safe to render to end users.
        recoverable: ``True`` if a retry could plausibly succeed.
        details: Additional structured context. Schema per error code
            (see ERROR_CODES.md §3 onward).
    """

    default_code: str = "INTERNAL_ERROR"
    default_recoverable: bool = False

    def __init__(
        self,
        user_message: str,
        *,
        code: str | None = None,
        recoverable: bool | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(user_message)
        self.code = code or self.default_code
        self.user_message = user_message
        self.recoverable = recoverable if recoverable is not None else self.default_recoverable
        self.details: dict[str, Any] = dict(details) if details else {}


class ParseError(OpenRagError):
    """Document parsing failed."""

    default_code = "PARSE_CORRUPTED_FILE"
    default_recoverable = False


class ModelNotLoadedError(OpenRagError):
    """A model file exists but failed to load (OOM, corruption, etc.)."""

    default_code = "MODEL_NOT_LOADED"
    default_recoverable = True


class OutOfMemoryError(OpenRagError):
    """An operation ran out of memory (CPU or GPU)."""

    default_code = "OUT_OF_MEMORY"
    default_recoverable = True


class CancelledError(OpenRagError):
    """A long-running task was cancelled by the user. Logically not an error."""

    default_code = "OPERATION_CANCELLED"
    default_recoverable = False


class ConfigurationError(OpenRagError):
    """Invalid configuration (workspace YAML, settings.yaml, etc.)."""

    default_code = "CONFIG_VALIDATION_FAILED"
    default_recoverable = True


class ExternalApiError(OpenRagError):
    """Failure calling an external service (HF Hub, external LLM provider)."""

    default_code = "EXTERNAL_API_FAILED"
    default_recoverable = True


class BackendUnavailableError(OpenRagError):
    """Requested acceleration backend not available at runtime.

    Distinct from ``BACKEND_NOT_AVAILABLE`` (config-time refusal).
    """

    default_code = "BACKEND_UNAVAILABLE"
    default_recoverable = True
