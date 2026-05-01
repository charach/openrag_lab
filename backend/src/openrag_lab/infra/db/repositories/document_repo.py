"""Document repository — CRUD over the ``document`` table."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import DocumentId, WorkspaceId
from openrag_lab.infra.db.repositories._common import from_iso, to_iso


class DocumentRepository:
    """SQLite-backed document metadata store."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add(self, doc: Document) -> None:
        # source_path stored in POSIX form (PLATFORM.md §2.4).
        self._conn.execute(
            """
            INSERT INTO document (
                id, workspace_id, source_path, content_hash,
                format, size_bytes, added_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(doc.id),
                str(doc.workspace_id),
                doc.source_path.as_posix(),
                doc.content_hash,
                doc.format.value,
                doc.size_bytes,
                to_iso(doc.added_at),
            ),
        )
        self._conn.commit()

    def get(self, document_id: DocumentId) -> Document | None:
        row = self._conn.execute(
            """
            SELECT id, workspace_id, source_path, content_hash,
                   format, size_bytes, added_at
              FROM document WHERE id = ?
            """,
            (str(document_id),),
        ).fetchone()
        return _row_to_document(row) if row else None

    def get_by_hash(self, workspace_id: WorkspaceId, content_hash: str) -> Document | None:
        row = self._conn.execute(
            """
            SELECT id, workspace_id, source_path, content_hash,
                   format, size_bytes, added_at
              FROM document
             WHERE workspace_id = ? AND content_hash = ?
            """,
            (str(workspace_id), content_hash),
        ).fetchone()
        return _row_to_document(row) if row else None

    def list_for_workspace(self, workspace_id: WorkspaceId) -> list[Document]:
        rows = self._conn.execute(
            """
            SELECT id, workspace_id, source_path, content_hash,
                   format, size_bytes, added_at
              FROM document
             WHERE workspace_id = ?
             ORDER BY added_at DESC
            """,
            (str(workspace_id),),
        ).fetchall()
        return [_row_to_document(r) for r in rows]

    def update_path(self, document_id: DocumentId, source_path: Path) -> int:
        cur = self._conn.execute(
            "UPDATE document SET source_path = ? WHERE id = ?",
            (source_path.as_posix(), str(document_id)),
        )
        self._conn.commit()
        return cur.rowcount

    def delete(self, document_id: DocumentId) -> int:
        cur = self._conn.execute("DELETE FROM document WHERE id = ?", (str(document_id),))
        self._conn.commit()
        return cur.rowcount


def _row_to_document(row: sqlite3.Row) -> Document:
    return Document(
        id=DocumentId(row["id"]),
        workspace_id=WorkspaceId(row["workspace_id"]),
        source_path=Path(row["source_path"]),
        content_hash=row["content_hash"],
        format=DocumentFormat(row["format"]),
        size_bytes=row["size_bytes"],
        added_at=from_iso(row["added_at"]),
    )
