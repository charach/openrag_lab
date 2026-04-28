"""Workspace model — the top-level user-facing container."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from openrag_lab.domain.models.ids import WorkspaceId


_NAME_MIN = 1
_NAME_MAX = 200
_TAG_MIN = 1
_TAG_MAX = 50


class WorkspaceMeta(BaseModel):
    """Free-form descriptive fields. Mutable in spirit (rename, retag)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = Field(min_length=_NAME_MIN, max_length=_NAME_MAX)
    description: str = ""
    tags: tuple[str, ...] = Field(default_factory=tuple)

    @field_validator("tags")
    @classmethod
    def _tag_lengths(cls, v: tuple[str, ...]) -> tuple[str, ...]:
        for tag in v:
            if not (_TAG_MIN <= len(tag) <= _TAG_MAX):
                raise ValueError(
                    f"tag length must be {_TAG_MIN}~{_TAG_MAX} chars; got {len(tag)!r}",
                )
        return v


class Workspace(BaseModel):
    """A user workspace: a corpus + its experiments + its config history."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: WorkspaceId
    meta: WorkspaceMeta
    created_at: datetime
