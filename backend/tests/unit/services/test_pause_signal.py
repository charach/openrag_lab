"""Unit tests for ``PauseSignal``."""

from __future__ import annotations

import asyncio

import pytest

from openrag_lab.domain.services.cancellation import PauseSignal


async def test_default_is_running_so_wait_returns_immediately() -> None:
    signal = PauseSignal()
    assert signal.is_paused is False
    # Should resolve before the timeout — we're not paused.
    await asyncio.wait_for(signal.wait_if_paused(), timeout=0.1)


async def test_paused_wait_blocks_until_resume() -> None:
    signal = PauseSignal()
    signal.pause()
    assert signal.is_paused is True

    waiter = asyncio.create_task(signal.wait_if_paused())
    # Give the loop a tick — the waiter must still be pending.
    await asyncio.sleep(0.01)
    assert not waiter.done()

    signal.resume()
    await asyncio.wait_for(waiter, timeout=0.1)
    assert signal.is_paused is False


async def test_resume_idempotent_when_already_running() -> None:
    signal = PauseSignal()
    signal.resume()  # already running
    signal.resume()  # still running
    assert signal.is_paused is False


async def test_pause_idempotent() -> None:
    signal = PauseSignal()
    signal.pause()
    signal.pause()  # second pause is a no-op
    assert signal.is_paused is True
    signal.resume()
    assert signal.is_paused is False


async def test_concurrent_waiters_all_resume() -> None:
    signal = PauseSignal()
    signal.pause()
    waiters = [asyncio.create_task(signal.wait_if_paused()) for _ in range(5)]
    await asyncio.sleep(0.01)
    assert all(not w.done() for w in waiters)
    signal.resume()
    await asyncio.wait_for(asyncio.gather(*waiters), timeout=0.2)


@pytest.mark.parametrize("toggle_count", [1, 3, 7])
async def test_pause_resume_cycles(toggle_count: int) -> None:
    signal = PauseSignal()
    for _ in range(toggle_count):
        signal.pause()
        assert signal.is_paused is True
        signal.resume()
        assert signal.is_paused is False
