"""Indexing checkpoint repository — drives PARSED → CHUNKED → EMBEDDED resume.

Reference: ARCHITECTURE_v3.md §6.1. The (workspace_id, document_id,
config_fingerprint) triple is the natural primary key — same fingerprint
+ same doc means we already did this work, possibly partially.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from openrag_lab.domain.models.enums import IndexingStage
from openrag_lab.domain.models.ids import DocumentId, WorkspaceId
from openrag_lab.infra.db.repositories._common import from_iso, to_iso


class IndexingCheckpointRepository:
    """SQLite-backed per-document indexing checkpoint."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def upsert(
        self,
        *,
        workspace_id: WorkspaceId,
        document_id: DocumentId,
        config_fingerprint: str,
        status: IndexingStage,
        updated_at: datetime | None = None,
    ) -> None:
        ts = to_iso(updated_at if updated_at is not None else datetime.now(UTC))
        self._conn.execute(
            """
            INSERT INTO indexing_checkpoint (
                workspace_id, document_id, config_fingerprint, status, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, document_id, config_fingerprint)
            DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
            """,
            (
                str(workspace_id),
                str(document_id),
                config_fingerprint,
                status.value,
                ts,
            ),
        )
        self._conn.commit()

    def get(
        self,
        *,
        workspace_id: WorkspaceId,
        document_id: DocumentId,
        config_fingerprint: str,
    ) -> tuple[IndexingStage, datetime] | None:
        row = self._conn.execute(
            """
            SELECT status, updated_at FROM indexing_checkpoint
             WHERE workspace_id = ? AND document_id = ? AND config_fingerprint = ?
            """,
            (str(workspace_id), str(document_id), config_fingerprint),
        ).fetchone()
        if row is None:
            return None
        return IndexingStage(row["status"]), from_iso(row["updated_at"])

    def list_for_run(
        self, workspace_id: WorkspaceId, config_fingerprint: str
    ) -> list[tuple[DocumentId, IndexingStage]]:
        rows = self._conn.execute(
            """
            SELECT document_id, status FROM indexing_checkpoint
             WHERE workspace_id = ? AND config_fingerprint = ?
            """,
            (str(workspace_id), config_fingerprint),
        ).fetchall()
        return [(DocumentId(r["document_id"]), IndexingStage(r["status"])) for r in rows]

    def clear_for_workspace(self, workspace_id: WorkspaceId) -> int:
        cur = self._conn.execute(
            "DELETE FROM indexing_checkpoint WHERE workspace_id = ?",
            (str(workspace_id),),
        )
        self._conn.commit()
        return cur.rowcount
