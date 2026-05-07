"""File-backed set of accepted model licenses.

A license acceptance persists across app restarts so users don't have to
re-tick the same checkbox every time they reindex. The store lives at
``layout.root / "accepted_licenses.json"`` — a single JSON list of model
ids the user has previously accepted. The store is small (one entry per
shipped model) and reads/writes are infrequent, so we don't bother with
a proper async lock.
"""

from __future__ import annotations

import json
from pathlib import Path


class LicenseStore:
    """Reads and writes the on-disk accepted-license list."""

    def __init__(self, *, root: Path) -> None:
        self._path = root / "accepted_licenses.json"
        self._cache: set[str] | None = None

    def _load(self) -> set[str]:
        if self._cache is not None:
            return self._cache
        if not self._path.exists():
            self._cache = set()
            return self._cache
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(payload, list):
                self._cache = {str(x) for x in payload}
            else:
                self._cache = set()
        except (json.JSONDecodeError, OSError):
            self._cache = set()
        return self._cache

    def is_accepted(self, model_id: str) -> bool:
        return model_id in self._load()

    def accept(self, model_id: str) -> None:
        accepted = self._load()
        accepted.add(model_id)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(sorted(accepted), ensure_ascii=False), encoding="utf-8"
        )

    def list_accepted(self) -> list[str]:
        return sorted(self._load())
