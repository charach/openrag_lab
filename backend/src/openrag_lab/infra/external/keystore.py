"""File-based API keystore for external LLM providers.

Stored at ``<OPENRAG_HOME>/api_keys.yaml`` as a flat ``{provider: key}`` map.
On POSIX the file is created with mode 0600 so other users on a shared
host cannot read it. Windows ACLs are not adjusted here — the path is
already inside the per-user APPDATA tree (PLATFORM.md §2.1) which has
user-only permissions by default.

The keystore intentionally does NOT validate keys against the provider
network — that belongs in the registration endpoint (API §15.0.2).
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import yaml

from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.external import ExternalProvider


class Keystore:
    def __init__(self, path: Path) -> None:
        self._path = path

    @property
    def path(self) -> Path:
        return self._path

    def _read(self) -> dict[str, str]:
        if not self._path.exists():
            return {}
        try:
            raw = self._path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ConfigurationError(
                f"api_keys.yaml를 읽을 수 없습니다: {self._path}",
                code="CONFIG_VALIDATION_FAILED",
                details={"path": str(self._path), "underlying": str(exc)},
            ) from exc
        if not raw.strip():
            return {}
        try:
            payload = yaml.safe_load(raw)
        except yaml.YAMLError as exc:
            raise ConfigurationError(
                "api_keys.yaml 파싱 실패",
                code="CONFIG_VALIDATION_FAILED",
                details={"path": str(self._path), "underlying": str(exc)},
            ) from exc
        if payload is None:
            return {}
        if not isinstance(payload, dict):
            raise ConfigurationError(
                "api_keys.yaml 최상위는 매핑이어야 합니다.",
                code="CONFIG_VALIDATION_FAILED",
                details={"path": str(self._path)},
            )
        out: dict[str, str] = {}
        for k, v in payload.items():
            if isinstance(k, str) and isinstance(v, str):
                out[k] = v
        return out

    def _write(self, data: dict[str, str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic write: tmp file in same dir + rename. mode=0600 on POSIX.
        fd, tmp = tempfile.mkstemp(
            prefix=".api_keys.", suffix=".yaml.tmp", dir=str(self._path.parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                yaml.safe_dump(data, f, sort_keys=True)
            if sys.platform != "win32":
                os.chmod(tmp, 0o600)
            os.replace(tmp, self._path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def get(self, provider: ExternalProvider) -> str | None:
        return self._read().get(provider.value)

    def require(self, provider: ExternalProvider) -> str:
        key = self.get(provider)
        if key is None:
            raise ConfigurationError(
                f"{provider.value} 제공자의 API 키가 등록되어 있지 않습니다.",
                code="EXTERNAL_API_KEY_NOT_REGISTERED",
                recoverable=True,
                details={
                    "provider_id": provider.value,
                    "registration_endpoint": (
                        f"/system/external-providers/{provider.value}/key"
                    ),
                },
            )
        return key

    def set(self, provider: ExternalProvider, key: str) -> None:
        if not key:
            raise ConfigurationError(
                "빈 API 키는 등록할 수 없습니다.",
                code="EXTERNAL_API_KEY_INVALID",
                recoverable=True,
                details={"provider_id": provider.value},
            )
        data = self._read()
        data[provider.value] = key
        self._write(data)

    def delete(self, provider: ExternalProvider) -> None:
        data = self._read()
        if provider.value in data:
            data.pop(provider.value)
            self._write(data)

    def list_providers(self) -> list[ExternalProvider]:
        out: list[ExternalProvider] = []
        for name in self._read():
            try:
                out.append(ExternalProvider(name))
            except ValueError:
                continue
        return out
