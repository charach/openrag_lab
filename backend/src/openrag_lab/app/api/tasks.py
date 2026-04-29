"""Task management endpoints (API_SPEC §13)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.ids import TaskId
from openrag_lab.domain.services.task_queue import TaskHandle, TaskState

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _serialize(handle: TaskHandle, kind: str) -> dict[str, Any]:
    return {
        "id": str(handle.id),
        "kind": kind,
        "status": _public_status(handle.state),
        "started_at": handle.started_at.isoformat() if handle.started_at else None,
        "completed_at": handle.completed_at.isoformat() if handle.completed_at else None,
        "estimated_completion_at": None,
        "result_ref": None,
        "error": handle.error,
    }


def _public_status(state: TaskState) -> str:
    """Map ``TaskState`` to API_SPEC §13.1 status strings."""
    return state.value


@router.get("/{task_id}")
async def get_task(
    task_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    handle = state.task_queue.status(TaskId(task_id))
    if handle is None:
        raise HttpError(
            status_code=404,
            code="TASK_NOT_FOUND",
            message="작업을 찾을 수 없습니다.",
            recoverable=False,
            details={"task_id": task_id},
        )
    meta = state.task_metadata.get(TaskId(task_id))
    kind = meta.kind if meta is not None else "unknown"
    return _serialize(handle, kind)


@router.post("/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    handle = state.task_queue.status(TaskId(task_id))
    if handle is None:
        raise HttpError(
            status_code=404,
            code="TASK_NOT_FOUND",
            message="작업을 찾을 수 없습니다.",
            recoverable=False,
            details={"task_id": task_id},
        )
    if handle.state in {TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED}:
        raise HttpError(
            status_code=409,
            code="TASK_ALREADY_COMPLETED",
            message="이미 종료된 작업입니다.",
            recoverable=False,
            details={"task_id": task_id, "status": handle.state.value},
        )
    state.task_queue.cancel(TaskId(task_id))
    return {"cancelled": True, "task_id": task_id}
