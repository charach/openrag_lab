"""Keystore round-trip + permissions + missing-key error."""

from __future__ import annotations

import stat
import sys
from pathlib import Path

import pytest

from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.external import ExternalProvider
from openrag_lab.infra.external.keystore import Keystore


def test_get_returns_none_when_file_missing(tmp_path: Path) -> None:
    ks = Keystore(tmp_path / "api_keys.yaml")
    assert ks.get(ExternalProvider.OPENAI) is None
    assert ks.list_providers() == []


def test_set_then_get_roundtrip(tmp_path: Path) -> None:
    ks = Keystore(tmp_path / "api_keys.yaml")
    ks.set(ExternalProvider.OPENAI, "sk-test-123")
    ks.set(ExternalProvider.ANTHROPIC, "anth-key-456")
    assert ks.get(ExternalProvider.OPENAI) == "sk-test-123"
    assert ks.get(ExternalProvider.ANTHROPIC) == "anth-key-456"
    assert set(ks.list_providers()) == {
        ExternalProvider.OPENAI,
        ExternalProvider.ANTHROPIC,
    }


def test_overwrite_preserves_other_providers(tmp_path: Path) -> None:
    ks = Keystore(tmp_path / "api_keys.yaml")
    ks.set(ExternalProvider.OPENAI, "v1")
    ks.set(ExternalProvider.GEMINI, "gem")
    ks.set(ExternalProvider.OPENAI, "v2")
    assert ks.get(ExternalProvider.OPENAI) == "v2"
    assert ks.get(ExternalProvider.GEMINI) == "gem"


def test_delete_removes_only_target(tmp_path: Path) -> None:
    ks = Keystore(tmp_path / "api_keys.yaml")
    ks.set(ExternalProvider.OPENAI, "a")
    ks.set(ExternalProvider.OPENROUTER, "b")
    ks.delete(ExternalProvider.OPENAI)
    assert ks.get(ExternalProvider.OPENAI) is None
    assert ks.get(ExternalProvider.OPENROUTER) == "b"


def test_require_raises_with_registration_hint(tmp_path: Path) -> None:
    ks = Keystore(tmp_path / "api_keys.yaml")
    with pytest.raises(ConfigurationError) as ei:
        ks.require(ExternalProvider.OPENAI)
    assert ei.value.code == "EXTERNAL_API_KEY_NOT_REGISTERED"
    assert ei.value.recoverable is True
    assert ei.value.details["provider_id"] == "openai"
    assert "/system/external-providers/openai/key" in ei.value.details["registration_endpoint"]


def test_set_empty_key_rejected(tmp_path: Path) -> None:
    ks = Keystore(tmp_path / "api_keys.yaml")
    with pytest.raises(ConfigurationError) as ei:
        ks.set(ExternalProvider.OPENAI, "")
    assert ei.value.code == "EXTERNAL_API_KEY_INVALID"


@pytest.mark.posix_only
def test_file_permissions_are_owner_only(tmp_path: Path) -> None:
    if sys.platform == "win32":
        pytest.skip("POSIX-only permission check")
    ks = Keystore(tmp_path / "api_keys.yaml")
    ks.set(ExternalProvider.OPENAI, "x")
    mode = ks.path.stat().st_mode & 0o777
    # Owner-readable+writable, no group/other access.
    assert mode & stat.S_IRWXG == 0
    assert mode & stat.S_IRWXO == 0


def test_corrupted_yaml_raises_configuration_error(tmp_path: Path) -> None:
    p = tmp_path / "api_keys.yaml"
    p.write_text(":::not yaml::: [", encoding="utf-8")
    ks = Keystore(p)
    with pytest.raises(ConfigurationError) as ei:
        ks.get(ExternalProvider.OPENAI)
    assert ei.value.code == "CONFIG_VALIDATION_FAILED"
