"""Workspace repository — CRUD over the ``workspace`` table."""

from __future__ import annotations

import json
import sqlite3

from openrag_lab.domain.models.ids import WorkspaceId
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories._common import from_iso, to_iso


class WorkspaceRepository:
    """SQLite-backed workspace store."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add(self, ws: Workspace) -> None:
        self._conn.execute(
            """
            INSERT INTO workspace (id, name, description, tags_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                str(ws.id),
                ws.meta.name,
                ws.meta.description,
                json.dumps(list(ws.meta.tags)),
                to_iso(ws.created_at),
            ),
        )
        self._conn.commit()

    def get(self, workspace_id: WorkspaceId) -> Workspace | None:
        row = self._conn.execute(
            "SELECT id, name, description, tags_json, created_at FROM workspace WHERE id = ?",
            (str(workspace_id),),
        ).fetchone()
        if row is None:
            return None
        return _row_to_workspace(row)

    def list_all(self) -> list[Workspace]:
        rows = self._conn.execute(
            "SELECT id, name, description, tags_json, created_at "
            "FROM workspace ORDER BY created_at DESC"
        ).fetchall()
        return [_row_to_workspace(r) for r in rows]

    def update_meta(self, workspace_id: WorkspaceId, meta: WorkspaceMeta) -> int:
        cur = self._conn.execute(
            """
            UPDATE workspace
               SET name = ?, description = ?, tags_json = ?
             WHERE id = ?
            """,
            (meta.name, meta.description, json.dumps(list(meta.tags)), str(workspace_id)),
        )
        self._conn.commit()
        return cur.rowcount

    def delete(self, workspace_id: WorkspaceId) -> int:
        cur = self._conn.execute("DELETE FROM workspace WHERE id = ?", (str(workspace_id),))
        self._conn.commit()
        return cur.rowcount


def _row_to_workspace(row: sqlite3.Row) -> Workspace:
    tags = tuple(json.loads(row["tags_json"]))
    return Workspace(
        id=WorkspaceId(row["id"]),
        meta=WorkspaceMeta(
            name=row["name"],
            description=row["description"],
            tags=tags,
        ),
        created_at=from_iso(row["created_at"]),
    )
