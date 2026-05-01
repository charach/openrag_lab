"""Chat-turn repository — persistent per-experiment chat history (5.4)."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.ids import (
    ChatTurnId,
    ExperimentId,
    WorkspaceId,
)
from openrag_lab.infra.db.repositories._common import from_iso, to_iso


class ChatTurnRecord(BaseModel):
    """One persisted chat turn — question + answer + retrieval payload."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: ChatTurnId
    workspace_id: WorkspaceId
    experiment_id: ExperimentId
    question: str = Field(min_length=1)
    answer: str | None = None
    citations: tuple[Any, ...] = Field(default_factory=tuple)
    chunks: tuple[Any, ...] = Field(default_factory=tuple)
    latency_ms: int | None = None
    tokens: int | None = None
    created_at: datetime


class ChatTurnRepository:
    """SQLite-backed chat-turn store."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add(self, turn: ChatTurnRecord) -> None:
        self._conn.execute(
            """
            INSERT INTO chat_turn (
                id, workspace_id, experiment_id, question, answer,
                citations_json, chunks_json, latency_ms, tokens, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(turn.id),
                str(turn.workspace_id),
                str(turn.experiment_id),
                turn.question,
                turn.answer,
                json.dumps(list(turn.citations)),
                json.dumps(list(turn.chunks)),
                turn.latency_ms,
                turn.tokens,
                to_iso(turn.created_at),
            ),
        )
        self._conn.commit()

    def get(self, turn_id: ChatTurnId) -> ChatTurnRecord | None:
        row = self._conn.execute(
            """
            SELECT id, workspace_id, experiment_id, question, answer,
                   citations_json, chunks_json, latency_ms, tokens, created_at
              FROM chat_turn WHERE id = ?
            """,
            (str(turn_id),),
        ).fetchone()
        return _row_to_turn(row) if row else None

    def list_for_experiment(
        self,
        experiment_id: ExperimentId,
        *,
        limit: int = 50,
        before: str | None = None,
    ) -> list[ChatTurnRecord]:
        """Newest-first listing scoped to an experiment.

        ``before`` is an ISO timestamp cursor — when supplied, only turns
        strictly older than it are returned. Combined with ``limit`` this
        gives forward-paging through history.
        """
        if before is None:
            rows = self._conn.execute(
                """
                SELECT id, workspace_id, experiment_id, question, answer,
                       citations_json, chunks_json, latency_ms, tokens, created_at
                  FROM chat_turn
                 WHERE experiment_id = ?
              ORDER BY created_at DESC, id DESC
                 LIMIT ?
                """,
                (str(experiment_id), limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """
                SELECT id, workspace_id, experiment_id, question, answer,
                       citations_json, chunks_json, latency_ms, tokens, created_at
                  FROM chat_turn
                 WHERE experiment_id = ? AND created_at < ?
              ORDER BY created_at DESC, id DESC
                 LIMIT ?
                """,
                (str(experiment_id), before, limit),
            ).fetchall()
        return [_row_to_turn(r) for r in rows]

    def delete(self, turn_id: ChatTurnId) -> int:
        cur = self._conn.execute("DELETE FROM chat_turn WHERE id = ?", (str(turn_id),))
        self._conn.commit()
        return cur.rowcount


def _row_to_turn(row: sqlite3.Row) -> ChatTurnRecord:
    return ChatTurnRecord(
        id=ChatTurnId(row["id"]),
        workspace_id=WorkspaceId(row["workspace_id"]),
        experiment_id=ExperimentId(row["experiment_id"]),
        question=row["question"],
        answer=row["answer"],
        citations=tuple(json.loads(row["citations_json"] or "[]")),
        chunks=tuple(json.loads(row["chunks_json"] or "[]")),
        latency_ms=row["latency_ms"],
        tokens=row["tokens"],
        created_at=from_iso(row["created_at"]),
    )
