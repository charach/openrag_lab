"""Cooperative cancellation token for long-running domain tasks.

ARCHITECTURE_v3.md §8.1 — every long task accepts a token and calls
``raise_if_cancelled()`` between stages. Cancellation preserves the
indexing checkpoint so the work can resume later.
"""

from __future__ import annotations

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
