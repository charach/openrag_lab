"""Progress reporter abstraction.

The application layer wires this to a WebSocket pub/sub. Domain code
just calls ``await reporter.emit(...)`` between stages — it never
touches transport.

Two channels:

* ``emit`` — coarse, batch-level progress (overall ratio + stage label).
* ``emit_file`` — per-document progress so the UI can show a row per
  file with its own stage. ``file_stage`` is one of ``parsing``,
  ``chunking``, ``embedding``, ``embedded``, ``skipped``, ``failed``.
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

    async def emit_file(
        self,
        *,
        topic: str,
        file_id: str,
        file_name: str,
        file_stage: str,
        ratio: float,
        chunks: int | None = None,
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

    async def emit_file(
        self,
        *,
        topic: str,
        file_id: str,
        file_name: str,
        file_stage: str,
        ratio: float,
        chunks: int | None = None,
        message: str = "",
    ) -> None:
        return None


class CollectingProgressReporter:
    """Records every emit. Used by tests to assert progress events fired."""

    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []
        self.file_events: list[dict[str, object]] = []

    async def emit(
        self,
        *,
        topic: str,
        stage: str,
        ratio: float,
        message: str = "",
    ) -> None:
        self.events.append({"topic": topic, "stage": stage, "ratio": ratio, "message": message})

    async def emit_file(
        self,
        *,
        topic: str,
        file_id: str,
        file_name: str,
        file_stage: str,
        ratio: float,
        chunks: int | None = None,
        message: str = "",
    ) -> None:
        self.file_events.append(
            {
                "topic": topic,
                "file_id": file_id,
                "file_name": file_name,
                "file_stage": file_stage,
                "ratio": ratio,
                "chunks": chunks,
                "message": message,
            }
        )
