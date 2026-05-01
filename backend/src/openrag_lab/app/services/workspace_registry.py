"""Workspace registry — discover, create, and tear down workspaces on disk.

A workspace is a directory under ``<OPENRAG_HOME>/workspaces/<id>/`` with its
own ``data.sqlite``. There is no central registry DB; we list workspaces by
scanning the directory and opening each per-workspace DB to pull metadata.

This helper centralizes that pattern so individual API handlers don't each
re-implement directory walking + connection management.
"""

from __future__ import annotations

import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from openrag_lab.domain.models.ids import WorkspaceId, new_workspace_id
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository
from openrag_lab.infra.db.sqlite import connect
from openrag_lab.infra.fs.workspace_layout import WorkspaceLayout, WorkspacePaths


class WorkspaceStats:
    __slots__ = ("chunk_count", "document_count", "experiment_count")

    def __init__(self, *, document_count: int, chunk_count: int, experiment_count: int) -> None:
        self.document_count = document_count
        self.chunk_count = chunk_count
        self.experiment_count = experiment_count


class WorkspaceRegistry:
    """Filesystem-backed catalog of workspaces under a ``WorkspaceLayout``."""

    def __init__(self, layout: WorkspaceLayout) -> None:
        self._layout = layout

    @property
    def layout(self) -> WorkspaceLayout:
        return self._layout

    def paths_for(self, workspace_id: WorkspaceId) -> WorkspacePaths:
        return WorkspacePaths(root=self._layout.workspace_dir(str(workspace_id)))

    @contextmanager
    def open(self, workspace_id: WorkspaceId) -> Iterator[sqlite3.Connection]:
        """Yield a connection to the per-workspace DB. Closes on exit."""
        paths = self.paths_for(workspace_id)
        if not paths.db.exists():
            raise WorkspaceNotFoundError(workspace_id)
        conn = connect(paths.db)
        try:
            yield conn
        finally:
            conn.close()

    def create(self, meta: WorkspaceMeta) -> Workspace:
        """Create a new workspace directory + DB + row. Returns the model."""
        ws_id = new_workspace_id()
        paths = self.paths_for(ws_id)
        paths.ensure()

        workspace = Workspace(id=ws_id, meta=meta, created_at=datetime.now(UTC))
        conn = connect(paths.db)
        try:
            WorkspaceRepository(conn).add(workspace)
        finally:
            conn.close()
        return workspace

    def get(self, workspace_id: WorkspaceId) -> Workspace | None:
        paths = self.paths_for(workspace_id)
        if not paths.db.exists():
            return None
        conn = connect(paths.db)
        try:
            return WorkspaceRepository(conn).get(workspace_id)
        finally:
            conn.close()

    def list_all(self) -> list[Workspace]:
        """Scan the workspaces dir and load each workspace row.

        Workspaces with a missing or unreadable DB are skipped silently —
        we never want a single broken workspace to take down the listing.
        """
        result: list[Workspace] = []
        wdir = self._layout.workspaces_dir
        if not wdir.is_dir():
            return result
        for child in sorted(wdir.iterdir()):
            if not child.is_dir():
                continue
            db_path = child / "data.sqlite"
            if not db_path.is_file():
                continue
            try:
                conn = connect(db_path)
            except sqlite3.DatabaseError:
                continue
            try:
                ws = WorkspaceRepository(conn).get(WorkspaceId(child.name))
            finally:
                conn.close()
            if ws is not None:
                result.append(ws)
        result.sort(key=lambda w: w.created_at, reverse=True)
        return result

    def stats(self, workspace_id: WorkspaceId) -> WorkspaceStats:
        paths = self.paths_for(workspace_id)
        if not paths.db.exists():
            return WorkspaceStats(document_count=0, chunk_count=0, experiment_count=0)
        conn = connect(paths.db)
        try:
            doc_repo = DocumentRepository(conn)
            chunk_count_row = conn.execute("SELECT COUNT(*) AS n FROM chunk").fetchone()
            exp_count_row = conn.execute(
                "SELECT COUNT(*) AS n FROM experiment WHERE archived = 0",
            ).fetchone()
            documents = doc_repo.list_for_workspace(workspace_id)
            return WorkspaceStats(
                document_count=len(documents),
                chunk_count=int(chunk_count_row["n"]) if chunk_count_row else 0,
                experiment_count=int(exp_count_row["n"]) if exp_count_row else 0,
            )
        finally:
            conn.close()

    def rename(self, workspace_id: WorkspaceId, new_name: str) -> Workspace | None:
        """Update a workspace's display name. Returns the updated row, or None
        if the workspace does not exist. Validation (length etc.) lives on
        :class:`WorkspaceMeta`; we surface ``ValueError`` as-is to the caller.
        """
        paths = self.paths_for(workspace_id)
        if not paths.db.exists():
            return None
        conn = connect(paths.db)
        try:
            repo = WorkspaceRepository(conn)
            current = repo.get(workspace_id)
            if current is None:
                return None
            new_meta = current.meta.model_copy(update={"name": new_name})
            repo.update_meta(workspace_id, new_meta)
            return current.model_copy(update={"meta": new_meta})
        finally:
            conn.close()

    def delete(self, workspace_id: WorkspaceId) -> bool:
        """Remove the workspace directory recursively. Returns True if found."""
        wsdir = self._layout.workspace_dir(str(workspace_id))
        if not wsdir.exists():
            return False
        shutil.rmtree(wsdir)
        return True


class WorkspaceNotFoundError(Exception):
    def __init__(self, workspace_id: WorkspaceId) -> None:
        super().__init__(f"workspace not found: {workspace_id}")
        self.workspace_id = workspace_id


__all__ = [
    "WorkspaceNotFoundError",
    "WorkspaceRegistry",
    "WorkspaceStats",
]
