"""Unit tests for the cooperative runtime.lock (PLATFORM.md §5.4)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from openrag_lab.app.runtime_lock import (
    InstanceAlreadyRunningError,
    acquire,
    release,
)


def _write(path: Path, *, pid: int, started: str = "2026-04-29T00:00:00Z") -> None:
    path.write_text(json.dumps({"pid": pid, "started_at": started}), encoding="utf-8")


def test_acquire_creates_lock_file(tmp_path: Path) -> None:
    lock = tmp_path / "runtime.lock"
    acquire(lock)
    try:
        record = json.loads(lock.read_text(encoding="utf-8"))
        assert record["pid"] == os.getpid()
        assert record["started_at"]
    finally:
        release(lock)
    assert not lock.exists()


def test_acquire_reclaims_stale_lock(tmp_path: Path) -> None:
    lock = tmp_path / "runtime.lock"
    # Pid 1 exists on POSIX but is not us; on Windows the conservative
    # branch treats foreign pids as alive, so use an obviously-dead pid.
    dead_pid = 99_999_999
    _write(lock, pid=dead_pid)
    acquire(lock)
    try:
        record = json.loads(lock.read_text(encoding="utf-8"))
        assert record["pid"] == os.getpid()
    finally:
        release(lock)


def test_acquire_raises_when_live_lock_exists(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    lock = tmp_path / "runtime.lock"
    _write(lock, pid=12345)

    # Force the liveness check to claim 12345 is alive.
    monkeypatch.setattr("openrag_lab.app.runtime_lock._is_alive", lambda _pid: True)

    with pytest.raises(InstanceAlreadyRunningError) as exc:
        acquire(lock)
    assert exc.value.record.pid == 12345


def test_acquire_idempotent_for_same_pid(tmp_path: Path) -> None:
    lock = tmp_path / "runtime.lock"
    acquire(lock)
    try:
        # Second acquire from the same process must not raise.
        acquire(lock)
    finally:
        release(lock)


def test_release_ignores_missing_lock(tmp_path: Path) -> None:
    release(tmp_path / "runtime.lock")  # no exception


def test_release_does_not_remove_foreign_lock(tmp_path: Path) -> None:
    lock = tmp_path / "runtime.lock"
    _write(lock, pid=os.getpid() + 9999)
    release(lock)
    assert lock.exists()


def test_acquire_creates_parent_dirs(tmp_path: Path) -> None:
    lock = tmp_path / "deep" / "nested" / "runtime.lock"
    acquire(lock)
    try:
        assert lock.exists()
    finally:
        release(lock)
