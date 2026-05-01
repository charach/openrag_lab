"""Golden-set repository — set + pair storage for retrieval evaluation."""

from __future__ import annotations

import json
import sqlite3

from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.ids import (
    ChunkId,
    GoldenPairId,
    GoldenSetId,
    WorkspaceId,
)


class GoldenPair(BaseModel):
    """A single (question, expected answer/chunks) pair.

    Lives next to the repository (and not in ``domain/models/``) because
    the MVP uses it only for retrieval evaluation glue — promoting it to
    a first-class domain object is P1.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: GoldenPairId
    question: str = Field(min_length=1)
    expected_answer: str | None = None
    expected_chunk_ids: tuple[ChunkId, ...] = Field(default_factory=tuple)


class GoldenSet(BaseModel):
    """A named bundle of pairs scoped to a workspace."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: GoldenSetId
    workspace_id: WorkspaceId
    name: str = Field(min_length=1)


class GoldenSetRepository:
    """SQLite-backed golden-set + pair store."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add_set(self, gs: GoldenSet) -> None:
        self._conn.execute(
            "INSERT INTO golden_set (id, workspace_id, name) VALUES (?, ?, ?)",
            (str(gs.id), str(gs.workspace_id), gs.name),
        )
        self._conn.commit()

    def get_set(self, golden_set_id: GoldenSetId) -> GoldenSet | None:
        row = self._conn.execute(
            "SELECT id, workspace_id, name FROM golden_set WHERE id = ?",
            (str(golden_set_id),),
        ).fetchone()
        if row is None:
            return None
        return GoldenSet(
            id=GoldenSetId(row["id"]),
            workspace_id=WorkspaceId(row["workspace_id"]),
            name=row["name"],
        )

    def list_sets_for_workspace(self, workspace_id: WorkspaceId) -> list[GoldenSet]:
        rows = self._conn.execute(
            "SELECT id, workspace_id, name FROM golden_set "
            "WHERE workspace_id = ? ORDER BY name ASC",
            (str(workspace_id),),
        ).fetchall()
        return [
            GoldenSet(
                id=GoldenSetId(r["id"]),
                workspace_id=WorkspaceId(r["workspace_id"]),
                name=r["name"],
            )
            for r in rows
        ]

    def add_pairs(self, golden_set_id: GoldenSetId, pairs: list[GoldenPair]) -> int:
        rows = [
            (
                str(p.id),
                str(golden_set_id),
                p.question,
                p.expected_answer,
                json.dumps([str(c) for c in p.expected_chunk_ids]),
            )
            for p in pairs
        ]
        if not rows:
            return 0
        self._conn.executemany(
            """
            INSERT INTO golden_pair (
                id, golden_set_id, question, expected_answer, expected_chunk_ids_json
            ) VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )
        self._conn.commit()
        return len(rows)

    def list_pairs(self, golden_set_id: GoldenSetId) -> list[GoldenPair]:
        rows = self._conn.execute(
            """
            SELECT id, question, expected_answer, expected_chunk_ids_json
              FROM golden_pair WHERE golden_set_id = ? ORDER BY id ASC
            """,
            (str(golden_set_id),),
        ).fetchall()
        return [
            GoldenPair(
                id=GoldenPairId(r["id"]),
                question=r["question"],
                expected_answer=r["expected_answer"],
                expected_chunk_ids=tuple(
                    ChunkId(c) for c in json.loads(r["expected_chunk_ids_json"] or "[]")
                ),
            )
            for r in rows
        ]

    def delete_set(self, golden_set_id: GoldenSetId) -> int:
        cur = self._conn.execute("DELETE FROM golden_set WHERE id = ?", (str(golden_set_id),))
        self._conn.commit()
        return cur.rowcount

    def get_pair(self, pair_id: GoldenPairId) -> GoldenPair | None:
        row = self._conn.execute(
            """
            SELECT id, question, expected_answer, expected_chunk_ids_json
              FROM golden_pair WHERE id = ?
            """,
            (str(pair_id),),
        ).fetchone()
        if row is None:
            return None
        return GoldenPair(
            id=GoldenPairId(row["id"]),
            question=row["question"],
            expected_answer=row["expected_answer"],
            expected_chunk_ids=tuple(
                ChunkId(c) for c in json.loads(row["expected_chunk_ids_json"] or "[]")
            ),
        )

    def pair_set_id(self, pair_id: GoldenPairId) -> GoldenSetId | None:
        row = self._conn.execute(
            "SELECT golden_set_id FROM golden_pair WHERE id = ?",
            (str(pair_id),),
        ).fetchone()
        return GoldenSetId(row["golden_set_id"]) if row else None

    def update_pair(self, pair: GoldenPair) -> int:
        cur = self._conn.execute(
            """
            UPDATE golden_pair
               SET question = ?, expected_answer = ?, expected_chunk_ids_json = ?
             WHERE id = ?
            """,
            (
                pair.question,
                pair.expected_answer,
                json.dumps([str(c) for c in pair.expected_chunk_ids]),
                str(pair.id),
            ),
        )
        self._conn.commit()
        return cur.rowcount

    def delete_pair(self, pair_id: GoldenPairId) -> int:
        cur = self._conn.execute("DELETE FROM golden_pair WHERE id = ?", (str(pair_id),))
        self._conn.commit()
        return cur.rowcount
