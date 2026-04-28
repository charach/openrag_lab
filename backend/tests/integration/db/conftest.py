"""Shared pytest fixtures for repository tests."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from openrag_lab.infra.db.sqlite import open_db


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """Fresh SQLite DB on disk; tears down with tmp_path."""
    with open_db(tmp_path / "test.sqlite") as c:
        yield c
