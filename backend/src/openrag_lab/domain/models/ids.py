"""Typed ID values used across the domain layer.

We use ``NewType`` aliases over ``str`` rather than wrapper classes because
the IDs are opaque tokens — no behavior, just identity. ``NewType`` gives
mypy enough teeth to catch accidental mixing (passing a ``DocumentId`` where
a ``ChunkId`` is expected) without runtime cost.

ID format: ``<prefix>_<12 hex chars>`` (16 hex chars for chunks).
The prefix and length budget are fixed by docs/PLATFORM.md §2.5 to keep
Windows path lengths under MAX_PATH.
"""

from __future__ import annotations

import secrets
from typing import NewType

WorkspaceId = NewType("WorkspaceId", str)
DocumentId = NewType("DocumentId", str)
ChunkId = NewType("ChunkId", str)
ExperimentId = NewType("ExperimentId", str)
GoldenSetId = NewType("GoldenSetId", str)
GoldenPairId = NewType("GoldenPairId", str)
TaskId = NewType("TaskId", str)
ChatTurnId = NewType("ChatTurnId", str)


_WORKSPACE_PREFIX = "ws"
_DOCUMENT_PREFIX = "doc"
_CHUNK_PREFIX = "chk"
_EXPERIMENT_PREFIX = "exp"
_GOLDEN_SET_PREFIX = "gs"
_GOLDEN_PAIR_PREFIX = "gp"
_TASK_PREFIX = "task"
_CHAT_TURN_PREFIX = "turn"


def _new(prefix: str, *, hex_chars: int = 12) -> str:
    return f"{prefix}_{secrets.token_hex(hex_chars // 2)}"


def new_workspace_id() -> WorkspaceId:
    return WorkspaceId(_new(_WORKSPACE_PREFIX))


def new_document_id() -> DocumentId:
    return DocumentId(_new(_DOCUMENT_PREFIX))


def new_chunk_id() -> ChunkId:
    # 16 hex chars — chunks dominate path length, but we still want enough entropy.
    return ChunkId(_new(_CHUNK_PREFIX, hex_chars=16))


def new_experiment_id() -> ExperimentId:
    return ExperimentId(_new(_EXPERIMENT_PREFIX))


def new_golden_set_id() -> GoldenSetId:
    return GoldenSetId(_new(_GOLDEN_SET_PREFIX))


def new_golden_pair_id() -> GoldenPairId:
    return GoldenPairId(_new(_GOLDEN_PAIR_PREFIX))


def new_task_id() -> TaskId:
    return TaskId(_new(_TASK_PREFIX))


def new_chat_turn_id() -> ChatTurnId:
    return ChatTurnId(_new(_CHAT_TURN_PREFIX))
