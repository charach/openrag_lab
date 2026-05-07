"""Cooperative cancellation + pause primitives for long-running domain tasks.

ARCHITECTURE_v3.md §8.1 — every long task accepts a token and calls
``raise_if_cancelled()`` between stages. Cancellation preserves the
indexing checkpoint so the work can resume later.

``PauseSignal`` is the second cooperation primitive: a stage-boundary
pause that awaits ``wait_if_paused()`` until ``resume()`` is called.
Pause is opt-in — services that want it call ``await
signal.wait_if_paused()`` between stages, just as they call
``token.raise_if_cancelled()``. The two primitives are independent:
pause does not imply cancel.
"""

from __future__ import annotations

import asyncio

from openrag_lab.domain.errors import CancelledError


class CancellationToken:
    """Plain-old flag the caller flips with :meth:`cancel`."""

    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    def raise_if_cancelled(self, *, stage: str | None = None) -> None:
        if self._cancelled:
            raise CancelledError(
                f"Operation cancelled at stage={stage!r}" if stage else "Operation cancelled.",
                code="OPERATION_CANCELLED",
                recoverable=False,
                details={"stage": stage} if stage else None,
            )


class PauseSignal:
    """Cooperative pause flag — stage-boundary only.

    ``wait_if_paused()`` returns immediately when not paused and otherwise
    awaits the next ``resume()``. Implemented over ``asyncio.Event``: the
    event is *set* when running, *cleared* when paused, so the wait is
    cheap and signals propagate without polling.
    """

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self._event.set()

    @property
    def is_paused(self) -> bool:
        return not self._event.is_set()

    def pause(self) -> None:
        self._event.clear()

    def resume(self) -> None:
        self._event.set()

    async def wait_if_paused(self) -> None:
        await self._event.wait()
