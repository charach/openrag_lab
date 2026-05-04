"""Global ``<OPENRAG_HOME>/settings.yaml`` loader.

PLATFORM.md §11 defines the ``network`` section schema. The loader is
intentionally permissive — most fields are optional and the MVP only
uses ``network.proxy.*`` and ``network.tls.*`` once external HTTP calls
land in P1. Until then we still parse + surface the values so admins
can drop a settings.yaml in place and the file is validated at startup.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from openrag_lab.domain.errors import ConfigurationError


class ProxyAuthSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str | None = None
    password_env: str | None = None


class ProxySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    http_proxy: str | None = None
    https_proxy: str | None = None
    no_proxy: tuple[str, ...] = Field(default_factory=tuple)
    auth: ProxyAuthSettings = Field(default_factory=ProxyAuthSettings)


class TlsSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ca_bundle_path: Path | None = None
    verify: bool = True


class TimeoutSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connect_seconds: float = Field(default=10.0, gt=0)
    read_seconds: float = Field(default=60.0, gt=0)


class NetworkSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proxy: ProxySettings = Field(default_factory=ProxySettings)
    tls: TlsSettings = Field(default_factory=TlsSettings)
    timeouts: TimeoutSettings = Field(default_factory=TimeoutSettings)


class ExternalSettings(BaseModel):
    """External LLM provider gating (PLATFORM.md §11, ERROR_CODES.md §8).

    ``allow_llm_api`` is the master switch — when False every external LLM
    call is refused with ``EXTERNAL_API_NOT_ENABLED`` regardless of the
    keystore. ``allowed_providers`` further restricts which of the four
    supported providers are reachable; the default permits all four.
    """

    model_config = ConfigDict(extra="forbid")

    allow_llm_api: bool = True
    allowed_providers: tuple[str, ...] = Field(
        default=("openai", "anthropic", "gemini", "openrouter")
    )


class GlobalSettings(BaseModel):
    """Top-level ``settings.yaml`` document.

    Unknown top-level keys are rejected so typos surface at load time
    rather than silently doing nothing.
    """

    model_config = ConfigDict(extra="forbid")

    network: NetworkSettings = Field(default_factory=NetworkSettings)
    external: ExternalSettings = Field(default_factory=ExternalSettings)
    warnings: tuple[str, ...] = Field(default_factory=tuple)

    @field_validator("network", mode="after")
    @classmethod
    def _validate_tls(cls, v: NetworkSettings) -> NetworkSettings:
        if v.tls.ca_bundle_path is not None and not v.tls.ca_bundle_path.is_file():
            raise ValueError(
                f"network.tls.ca_bundle_path does not point to a file: {v.tls.ca_bundle_path}"
            )
        return v


def default_settings() -> GlobalSettings:
    """Empty defaults used when no settings.yaml is present."""
    return GlobalSettings()


def load(path: Path) -> GlobalSettings:
    """Read + validate a settings.yaml. Missing file → defaults.

    Raises ``ConfigurationError`` (CONFIG_VALIDATION_FAILED) on parse or
    schema errors so the application layer can surface a clear message.
    """
    if not path.exists():
        return default_settings()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigurationError(
            f"settings.yaml를 읽을 수 없습니다: {path}",
            code="CONFIG_VALIDATION_FAILED",
            details={"path": str(path), "underlying": str(exc)},
        ) from exc
    if not raw.strip():
        return default_settings()
    try:
        payload: Any = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ConfigurationError(
            "settings.yaml 파싱 실패",
            code="CONFIG_VALIDATION_FAILED",
            details={"path": str(path), "underlying": str(exc)},
        ) from exc
    if payload is None:
        return default_settings()
    if not isinstance(payload, dict):
        raise ConfigurationError(
            "settings.yaml 최상위는 매핑이어야 합니다.",
            code="CONFIG_VALIDATION_FAILED",
            details={"path": str(path), "received_type": type(payload).__name__},
        )
    warnings: list[str] = []
    if (
        isinstance(payload.get("network"), dict)
        and isinstance(payload["network"].get("tls"), dict)
        and payload["network"]["tls"].get("verify") is False
    ):
        warnings.append("network.tls.verify=false — 운영 환경에서는 권장되지 않음")
    try:
        return GlobalSettings.model_validate({**payload, "warnings": tuple(warnings)})
    except Exception as exc:  # pydantic.ValidationError or ValueError
        raise ConfigurationError(
            f"settings.yaml 검증 실패: {exc}",
            code="CONFIG_VALIDATION_FAILED",
            details={"path": str(path), "underlying": str(exc)},
        ) from exc
