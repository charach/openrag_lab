"""Chunk repository — bulk-friendly writes over the ``chunk`` table."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from typing import Any

from openrag_lab.domain.models.chunk import Chunk, ChunkMetadata
from openrag_lab.domain.models.ids import ChunkId, DocumentId


class ChunkRepository:
    """SQLite-backed chunk store. Designed for batch insert."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add_many(self, chunks: Iterable[Chunk]) -> int:
        rows = [
            (
                str(c.id),
                str(c.document_id),
                c.chunk_config_key,
                c.sequence,
                c.content,
                c.token_count,
                json.dumps(_metadata_to_dict(c.metadata)),
            )
            for c in chunks
        ]
        if not rows:
            return 0
        self._conn.executemany(
            """
            INSERT INTO chunk (
                id, document_id, chunk_config_key,
                sequence, content, token_count, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        self._conn.commit()
        return len(rows)

    def list_for_document(self, document_id: DocumentId, chunk_config_key: str) -> list[Chunk]:
        rows = self._conn.execute(
            """
            SELECT id, document_id, chunk_config_key,
                   sequence, content, token_count, metadata_json
              FROM chunk
             WHERE document_id = ? AND chunk_config_key = ?
             ORDER BY sequence ASC
            """,
            (str(document_id), chunk_config_key),
        ).fetchall()
        return [_row_to_chunk(r) for r in rows]

    def count_for_document(self, document_id: DocumentId, chunk_config_key: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM chunk WHERE document_id = ? AND chunk_config_key = ?",
            (str(document_id), chunk_config_key),
        ).fetchone()
        return int(row["n"])

    def delete_for_document(
        self, document_id: DocumentId, chunk_config_key: str | None = None
    ) -> int:
        """Delete chunks for a document. If ``chunk_config_key`` is ``None``,
        deletes every chunk regardless of config (used on document delete)."""
        if chunk_config_key is None:
            cur = self._conn.execute("DELETE FROM chunk WHERE document_id = ?", (str(document_id),))
        else:
            cur = self._conn.execute(
                "DELETE FROM chunk WHERE document_id = ? AND chunk_config_key = ?",
                (str(document_id), chunk_config_key),
            )
        self._conn.commit()
        return cur.rowcount


def _metadata_to_dict(meta: ChunkMetadata) -> dict[str, object]:
    return {
        "page_number": meta.page_number,
        "section_path": list(meta.section_path),
        "char_offset": meta.char_offset,
        "char_length": meta.char_length,
    }


def _dict_to_metadata(payload: dict[str, Any]) -> ChunkMetadata:
    return ChunkMetadata(
        page_number=payload.get("page_number"),
        section_path=tuple(payload.get("section_path") or []),
        char_offset=int(payload.get("char_offset") or 0),
        char_length=int(payload.get("char_length") or 0),
    )


def _row_to_chunk(row: sqlite3.Row) -> Chunk:
    return Chunk(
        id=ChunkId(row["id"]),
        document_id=DocumentId(row["document_id"]),
        sequence=row["sequence"],
        content=row["content"],
        token_count=row["token_count"],
        metadata=_dict_to_metadata(json.loads(row["metadata_json"])),
        chunk_config_key=row["chunk_config_key"],
    )
