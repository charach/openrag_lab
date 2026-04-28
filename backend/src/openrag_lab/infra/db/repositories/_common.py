"""Shared helpers for the repositories.

All repositories take an open ``sqlite3.Connection`` and never own its
lifecycle. Application code creates a connection (via ``infra/db/sqlite.connect``),
hands it to repositories, and closes it on shutdown.

Datetimes are persisted as ISO-8601 strings (``T``-separated, with
timezone). ``_to_iso`` always produces a string with a tzinfo suffix —
SQLite is happy to round-trip these.
"""

from __future__ import annotations

from datetime import UTC, datetime


def to_iso(dt: datetime) -> str:
    """ISO-8601 with explicit tz (defaults to UTC if naive)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat()


def from_iso(value: str) -> datetime:
    """Parse an ISO-8601 string previously produced by :func:`to_iso`."""
    return datetime.fromisoformat(value)
