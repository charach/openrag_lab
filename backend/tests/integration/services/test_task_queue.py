"""TaskQueue — concurrency + cancellation + status reporting."""

from __future__ import annotations

import asyncio

from openrag_lab.domain.services.cancellation import CancellationToken
from openrag_lab.domain.services.task_queue import TaskQueue, TaskState


async def test_completed_job_reports_completed() -> None:
    q = TaskQueue(max_concurrent=1)
    finished = asyncio.Event()

    async def job(_: CancellationToken) -> None:
        finished.set()

    handle = q.enqueue(job)
    final = await q.join(handle.id)
    assert finished.is_set()
    assert final is not None
    assert final.state is TaskState.COMPLETED


async def test_failed_job_captures_error_message() -> None:
    q = TaskQueue(max_concurrent=1)

    async def job(_: CancellationToken) -> None:
        raise RuntimeError("boom")

    handle = q.enqueue(job)
    final = await q.join(handle.id)
    assert final is not None
    assert final.state is TaskState.FAILED
    assert final.error == "boom"


async def test_cancellation_marks_task_cancelled() -> None:
    q = TaskQueue(max_concurrent=1)
    started = asyncio.Event()

    async def job(token: CancellationToken) -> None:
        started.set()
        for _ in range(20):
            if token.is_cancelled:
                return
            await asyncio.sleep(0.01)

    handle = q.enqueue(job)
    await started.wait()
    assert q.cancel(handle.id) is True
    final = await q.join(handle.id)
    assert final is not None
    assert final.state is TaskState.CANCELLED


async def test_cancel_finished_returns_false() -> None:
    q = TaskQueue(max_concurrent=1)

    async def job(_: CancellationToken) -> None:
        pass

    handle = q.enqueue(job)
    await q.join(handle.id)
    assert q.cancel(handle.id) is False


async def test_max_concurrent_one_serializes_jobs() -> None:
    q = TaskQueue(max_concurrent=1)
    log: list[str] = []

    async def make_job(label: str):  # type: ignore[no-untyped-def]
        async def job(_: CancellationToken) -> None:
            log.append(f"start:{label}")
            await asyncio.sleep(0.02)
            log.append(f"end:{label}")

        return job

    h1 = q.enqueue(await make_job("a"))
    h2 = q.enqueue(await make_job("b"))
    await q.join(h1.id)
    await q.join(h2.id)
    # No interleaving — both starts before either end means concurrency leaked.
    assert log[:2] == ["start:a", "end:a"] or log[:2] == ["start:b", "end:b"]


async def test_status_returns_handle_for_known_id() -> None:
    q = TaskQueue(max_concurrent=1)

    async def job(_: CancellationToken) -> None:
        pass

    handle = q.enqueue(job)
    assert q.status(handle.id) is handle


async def test_zero_max_concurrent_rejected() -> None:
    import pytest

    with pytest.raises(ValueError):
        TaskQueue(max_concurrent=0)
