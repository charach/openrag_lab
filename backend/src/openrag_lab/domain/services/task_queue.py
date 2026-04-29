"""TaskQueue — single-user asyncio-based job queue.

Reference: docs/ARCHITECTURE_v3.md §8.1. Concurrency policy:

* indexing: max_concurrent=1 (SQLite + Chroma write contention)
* search/chat: many (read-only)
* evaluation: max_concurrent=1 (resource cost)

The queue is intentionally minimal: enqueue, status, cancel. The application
layer wraps each job into an ``asyncio.Task`` and exposes status via the
``TaskHandle`` view.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

from openrag_lab.domain.models.ids import TaskId, new_task_id
from openrag_lab.domain.services.cancellation import CancellationToken


class TaskState(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskHandle:
    """Externally-visible task record."""

    id: TaskId
    state: TaskState = TaskState.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    token: CancellationToken = field(default_factory=CancellationToken)


JobFn = Callable[[CancellationToken], Awaitable[None]]


class TaskQueue:
    """``asyncio.Semaphore``-bounded queue."""

    def __init__(self, *, max_concurrent: int = 1) -> None:
        if max_concurrent < 1:
            raise ValueError(f"max_concurrent must be >= 1, got {max_concurrent}")
        self._sem = asyncio.Semaphore(max_concurrent)
        self._handles: dict[TaskId, TaskHandle] = {}
        self._tasks: dict[TaskId, asyncio.Task[None]] = {}

    def enqueue(self, job: JobFn) -> TaskHandle:
        handle = TaskHandle(id=new_task_id())
        self._handles[handle.id] = handle
        self._tasks[handle.id] = asyncio.create_task(self._run(handle, job))
        return handle

    def status(self, task_id: TaskId) -> TaskHandle | None:
        return self._handles.get(task_id)

    def cancel(self, task_id: TaskId) -> bool:
        handle = self._handles.get(task_id)
        if handle is None or handle.state in {
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELLED,
        }:
            return False
        handle.token.cancel()
        return True

    async def join(self, task_id: TaskId) -> TaskHandle | None:
        """Wait for a task to finish; returns its final handle (or None)."""
        task = self._tasks.get(task_id)
        if task is None:
            return None
        # Failures are captured into the handle by ``_run`` — the awaiter
        # only needs to wait for completion, not re-raise.
        with contextlib.suppress(BaseException):
            await task
        return self._handles.get(task_id)

    async def _run(self, handle: TaskHandle, job: JobFn) -> None:
        async with self._sem:
            handle.state = TaskState.RUNNING
            handle.started_at = datetime.now(UTC)
            try:
                await job(handle.token)
            except asyncio.CancelledError:
                handle.state = TaskState.CANCELLED
                raise
            except Exception as e:
                handle.state = TaskState.FAILED
                handle.error = str(e)
            else:
                if handle.token.is_cancelled:
                    handle.state = TaskState.CANCELLED
                else:
                    handle.state = TaskState.COMPLETED
            finally:
                handle.completed_at = datetime.now(UTC)
