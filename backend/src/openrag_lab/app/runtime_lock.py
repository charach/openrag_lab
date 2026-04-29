"""Single-instance ``runtime.lock`` enforcement (PLATFORM.md §5.4).

We write a small JSON record (pid, started_at) to ``<OPENRAG_HOME>/runtime.lock``
on startup and remove it on shutdown. A fresh start refuses to come up if a
*live* lock exists; a stale lock (process gone) is reclaimed.

This is intentionally cooperative — there is no OS-level file lock, since
that varies wildly across platforms. The pid liveness check is enough for
the local-first MVP.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class LockRecord:
    pid: int
    started_at: str


def _read(path: Path) -> LockRecord | None:
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        data: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        return None
    pid = data.get("pid")
    started_at = data.get("started_at")
    if not isinstance(pid, int) or not isinstance(started_at, str):
        return None
    return LockRecord(pid=pid, started_at=started_at)


def _is_alive(pid: int) -> bool:
    """Best-effort liveness check, cross-platform.

    POSIX: ``kill(pid, 0)`` raises ``ProcessLookupError`` if the pid is gone.
    Windows: ``OpenProcess`` is heavier; for the lock we accept the false
    positive of treating any non-zero pid as alive — the user can delete
    the file manually. (See PLATFORM.md §5.4 — explicit user-fix is fine.)
    """
    if pid <= 0:
        return False
    if os.name == "nt":
        # Conservative on Windows: treat as alive unless pid is current process.
        return pid != os.getpid()
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists, owned by someone else.
        return True
    except OSError:
        return False
    return True


class InstanceAlreadyRunningError(Exception):
    """Raised when a live ``runtime.lock`` blocks startup."""

    def __init__(self, lock_path: Path, record: LockRecord) -> None:
        super().__init__(
            f"another OpenRAG-Lab instance is already running (pid={record.pid}); see {lock_path}"
        )
        self.lock_path = lock_path
        self.record = record


def acquire(lock_path: Path) -> None:
    """Take the runtime lock. Reclaim if stale; raise if still live.

    Idempotent within a single process: if the lock record's pid matches
    ``os.getpid()`` (e.g. tests calling ``acquire`` twice), this is a no-op.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    existing = _read(lock_path)
    if existing is not None:
        if existing.pid == os.getpid():
            return
        if _is_alive(existing.pid):
            raise InstanceAlreadyRunningError(lock_path, existing)

    record = LockRecord(pid=os.getpid(), started_at=datetime.now(UTC).isoformat())
    lock_path.write_text(
        json.dumps({"pid": record.pid, "started_at": record.started_at}),
        encoding="utf-8",
    )


def release(lock_path: Path) -> None:
    """Drop the lock if we own it. Silent on absence."""
    existing = _read(lock_path)
    if existing is None:
        return
    if existing.pid != os.getpid():
        return
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass
