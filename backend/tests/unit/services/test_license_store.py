"""Unit tests for ``LicenseStore``."""

from __future__ import annotations

from pathlib import Path

from openrag_lab.app.services.license_store import LicenseStore


def test_unaccepted_initially(tmp_path: Path) -> None:
    store = LicenseStore(root=tmp_path)
    assert store.is_accepted("any-id") is False
    assert store.list_accepted() == []


def test_accept_persists_to_disk(tmp_path: Path) -> None:
    store = LicenseStore(root=tmp_path)
    store.accept("model-a")
    # New instance over the same root sees the prior acceptance.
    fresh = LicenseStore(root=tmp_path)
    assert fresh.is_accepted("model-a") is True
    assert fresh.list_accepted() == ["model-a"]


def test_accept_idempotent(tmp_path: Path) -> None:
    store = LicenseStore(root=tmp_path)
    store.accept("m")
    store.accept("m")
    assert store.list_accepted() == ["m"]


def test_accept_creates_root_dir_if_missing(tmp_path: Path) -> None:
    nested = tmp_path / "openrag-home"
    store = LicenseStore(root=nested)
    store.accept("x")
    assert (nested / "accepted_licenses.json").exists()


def test_corrupt_json_file_treated_as_empty(tmp_path: Path) -> None:
    (tmp_path / "accepted_licenses.json").write_text("{not json", encoding="utf-8")
    store = LicenseStore(root=tmp_path)
    assert store.is_accepted("anything") is False
    # And a subsequent accept() rewrites cleanly.
    store.accept("recovered")
    assert LicenseStore(root=tmp_path).is_accepted("recovered") is True
