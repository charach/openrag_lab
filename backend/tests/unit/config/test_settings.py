"""Unit tests for the global settings.yaml loader (PLATFORM.md §11)."""

from __future__ import annotations

from pathlib import Path

import pytest

from openrag_lab.config.settings import default_settings, load
from openrag_lab.domain.errors import ConfigurationError


def test_missing_file_returns_defaults(tmp_path: Path) -> None:
    settings = load(tmp_path / "settings.yaml")
    assert settings == default_settings()
    assert settings.network.tls.verify is True
    assert settings.network.proxy.http_proxy is None


def test_empty_file_returns_defaults(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text("", encoding="utf-8")
    assert load(path) == default_settings()


def test_full_network_section_parses(tmp_path: Path) -> None:
    ca = tmp_path / "ca.pem"
    ca.write_text("dummy", encoding="utf-8")
    path = tmp_path / "settings.yaml"
    path.write_text(
        f"""
network:
  proxy:
    http_proxy: "http://proxy.local:8080"
    https_proxy: "http://proxy.local:8080"
    no_proxy:
      - localhost
      - 127.0.0.1
    auth:
      username: alice
      password_env: PROXY_PASSWORD
  tls:
    ca_bundle_path: {ca}
    verify: true
  timeouts:
    connect_seconds: 5
    read_seconds: 30
""",
        encoding="utf-8",
    )
    settings = load(path)
    assert settings.network.proxy.http_proxy == "http://proxy.local:8080"
    assert settings.network.proxy.no_proxy == ("localhost", "127.0.0.1")
    assert settings.network.proxy.auth.username == "alice"
    assert settings.network.tls.ca_bundle_path == ca
    assert settings.network.timeouts.connect_seconds == 5.0


def test_invalid_yaml_raises_configuration_error(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text("network:\n  bad: [unterminated\n", encoding="utf-8")
    with pytest.raises(ConfigurationError) as exc:
        load(path)
    assert exc.value.code == "CONFIG_VALIDATION_FAILED"


def test_unknown_top_level_key_rejected(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text("ynsupported: 1\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load(path)


def test_missing_ca_bundle_file_rejected(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(
        "network:\n  tls:\n    ca_bundle_path: /nonexistent/file.pem\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load(path)


def test_tls_verify_false_records_warning(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text(
        "network:\n  tls:\n    verify: false\n",
        encoding="utf-8",
    )
    settings = load(path)
    assert settings.network.tls.verify is False
    assert any("verify=false" in w for w in settings.warnings)


def test_top_level_must_be_mapping(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text("- a\n- b\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load(path)


def test_proxy_no_proxy_accepts_empty_list(tmp_path: Path) -> None:
    path = tmp_path / "settings.yaml"
    path.write_text("network:\n  proxy:\n    no_proxy: []\n", encoding="utf-8")
    settings = load(path)
    assert settings.network.proxy.no_proxy == ()
