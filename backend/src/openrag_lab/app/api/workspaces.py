"""Workspace endpoints (API_SPEC §5)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.workspace_registry import (
    WorkspaceRegistry,
    WorkspaceStats,
)
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.ids import WorkspaceId
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.domain.services.preset import (
    list_presets,
    to_experiment_config,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class CreateWorkspaceBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    preset_id: str | None = None


class RenameWorkspaceBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)


def _registry(state: AppState) -> WorkspaceRegistry:
    return WorkspaceRegistry(state.layout)


def _serialize_summary(ws: Workspace, stats: WorkspaceStats) -> dict[str, Any]:
    return {
        "id": str(ws.id),
        "name": ws.meta.name,
        "created_at": ws.created_at.isoformat(),
        "stats": {
            "document_count": stats.document_count,
            "chunk_count": stats.chunk_count,
            "experiment_count": stats.experiment_count,
        },
    }


def _config_payload(preset_id: str | None) -> dict[str, Any]:
    """Return the ``config`` block for the workspace detail response.

    If a preset is given, materialize its values; otherwise emit a minimal
    placeholder block (the user picks settings later via the chunking lab).
    """
    if preset_id is None:
        return {
            "embedder_id": None,
            "chunking": {"strategy": None, "chunk_size": None, "chunk_overlap": None},
            "retrieval_strategy": "dense",
            "top_k": 5,
            "llm_id": None,
        }
    presets = {p.name: p for p in list_presets()}
    preset = presets.get(preset_id)
    if preset is None:
        raise HttpError(
            status_code=400,
            code="BAD_REQUEST_FIELD",
            message=f"알 수 없는 preset_id: {preset_id}",
            recoverable=True,
            details={"field": "preset_id", "received": preset_id},
        )
    config = to_experiment_config(preset)
    return {
        "embedder_id": config.embedder_id,
        "chunking": {
            "strategy": config.chunking.strategy.value,
            "chunk_size": config.chunking.chunk_size,
            "chunk_overlap": config.chunking.chunk_overlap,
        },
        "retrieval_strategy": config.retrieval_strategy.value,
        "top_k": config.top_k,
        "llm_id": config.llm_id,
    }


def _serialize_detail(
    ws: Workspace,
    stats: WorkspaceStats,
    *,
    preset_id: str | None = None,
) -> dict[str, Any]:
    payload = _serialize_summary(ws, stats)
    payload["config"] = _config_payload(preset_id)
    return payload


def _require_workspace(registry: WorkspaceRegistry, workspace_id: WorkspaceId) -> Workspace:
    ws = registry.get(workspace_id)
    if ws is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": str(workspace_id)},
        )
    return ws


@router.get("")
async def list_workspaces(state: Annotated[AppState, Depends(get_state)]) -> dict[str, Any]:
    registry = _registry(state)
    workspaces = registry.list_all()
    items = [_serialize_summary(ws, registry.stats(ws.id)) for ws in workspaces]
    return {"items": items, "next_cursor": None}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: CreateWorkspaceBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    # Validate preset_id (if provided) before creating any directory.
    config_payload = _config_payload(body.preset_id)
    workspace = registry.create(WorkspaceMeta(name=body.name))
    stats = registry.stats(workspace.id)
    summary = _serialize_summary(workspace, stats)
    summary["config"] = config_payload
    return summary


@router.get("/{workspace_id}")
async def get_workspace(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    workspace = _require_workspace(registry, ws_id)
    stats = registry.stats(ws_id)
    return _serialize_detail(workspace, stats)


@router.patch("/{workspace_id}")
async def rename_workspace(
    workspace_id: str,
    body: RenameWorkspaceBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    updated = registry.rename(ws_id, body.name)
    if updated is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": str(ws_id)},
        )
    return _serialize_detail(updated, registry.stats(ws_id))


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> None:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    registry.delete(ws_id)
