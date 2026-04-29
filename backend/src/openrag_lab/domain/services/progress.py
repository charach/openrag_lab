"""Progress reporter abstraction.

The application layer wires this to a WebSocket pub/sub. Domain code
just calls ``await reporter.emit(...)`` between stages — it never
touches transport.
"""

from __future__ import annotations

from typing import Protocol


class ProgressReporter(Protocol):
    """Lightweight async sink for progress events."""

    async def emit(
        self,
        *,
        topic: str,
        stage: str,
        ratio: float,
        message: str = "",
    ) -> None: ...


class NullProgressReporter:
    """A reporter that does nothing — useful for tests + retrieval-only mode."""

    async def emit(
        self,
        *,
        topic: str,
        stage: str,
        ratio: float,
        message: str = "",
    ) -> None:
        return None


class CollectingProgressReporter:
    """Records every emit. Used by tests to assert progress events fired."""

    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    async def emit(
        self,
        *,
        topic: str,
        stage: str,
        ratio: float,
        message: str = "",
    ) -> None:
        self.events.append({"topic": topic, "stage": stage, "ratio": ratio, "message": message})
