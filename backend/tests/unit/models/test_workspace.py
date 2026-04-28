"""Workspace + WorkspaceMeta — name and tag length enforcement."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from openrag_lab.domain.models.ids import new_workspace_id
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta


def test_workspace_meta_accepts_korean_and_emoji_in_name() -> None:
    meta = WorkspaceMeta(name="변호사 자료실 ⚖️")
    assert meta.name == "변호사 자료실 ⚖️"


def test_workspace_meta_rejects_empty_name() -> None:
    with pytest.raises(ValidationError):
        WorkspaceMeta(name="")


def test_workspace_meta_rejects_name_above_max_length() -> None:
    with pytest.raises(ValidationError):
        WorkspaceMeta(name="a" * 201)


def test_workspace_meta_rejects_oversized_tag() -> None:
    with pytest.raises(ValidationError, match="tag length"):
        WorkspaceMeta(name="ok", tags=("a" * 51,))


def test_workspace_meta_accepts_tag_at_boundary() -> None:
    meta = WorkspaceMeta(name="ok", tags=("a" * 50,))
    assert meta.tags == ("a" * 50,)


def test_workspace_is_frozen() -> None:
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ok"),
        created_at=datetime.now(UTC),
    )
    with pytest.raises(ValidationError):
        ws.meta = WorkspaceMeta(name="other")  # type: ignore[misc]
