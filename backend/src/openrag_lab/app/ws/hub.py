"""In-process WebSocket pub/sub hub.

Topics are free-form strings; subscribers receive every payload published
on any topic they have subscribed to. The hub is asyncio-native and assumes
a single event loop (the FastAPI server's). It is not a distributed bus.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Any


@dataclass(eq=False)
class _Subscriber:
    queue: asyncio.Queue[dict[str, Any]]
    topics: set[str] = field(default_factory=set)


class WebSocketHub:
    """Tracks subscribers per topic and fan-outs published payloads.

    The hub never blocks publishers: a slow subscriber's queue grows up to
    ``queue_max`` items, then older messages are dropped (per API_SPEC §14.5
    backpressure rules). The lock guards subscription mutations only.
    """

    def __init__(self, *, queue_max: int = 100) -> None:
        self._queue_max = queue_max
        self._subscribers: set[_Subscriber] = set()
        self._lock = asyncio.Lock()

    async def attach(self) -> _Subscriber:
        sub = _Subscriber(queue=asyncio.Queue(maxsize=self._queue_max))
        async with self._lock:
            self._subscribers.add(sub)
        return sub

    async def detach(self, sub: _Subscriber) -> None:
        async with self._lock:
            self._subscribers.discard(sub)

    async def subscribe(self, sub: _Subscriber, topics: list[str]) -> list[str]:
        async with self._lock:
            sub.topics.update(topics)
            return sorted(sub.topics)

    async def unsubscribe(self, sub: _Subscriber, topics: list[str]) -> list[str]:
        async with self._lock:
            sub.topics.difference_update(topics)
            return sorted(sub.topics)

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        message = dict(payload)
        message.setdefault("topic", topic)
        # Snapshot to avoid holding the lock while iterating queues.
        async with self._lock:
            targets = [s for s in self._subscribers if topic in s.topics]
        for sub in targets:
            try:
                sub.queue.put_nowait(message)
            except asyncio.QueueFull:
                # Drop the oldest then enqueue the new one.
                with contextlib.suppress(asyncio.QueueEmpty):
                    sub.queue.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    sub.queue.put_nowait(message)


class WebSocketProgressReporter:
    """``ProgressReporter`` implementation that publishes to a hub topic."""

    def __init__(self, hub: WebSocketHub) -> None:
        self._hub = hub

    async def emit(
        self,
        *,
        topic: str,
        stage: str,
        ratio: float,
        message: str = "",
    ) -> None:
        await self._hub.publish(
            topic,
            {
                "type": "progress",
                "stage": stage,
                "ratio": ratio,
                "message": message,
            },
        )

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
        await self._hub.publish(
            topic,
            {
                "type": "file_progress",
                "file_id": file_id,
                "file_name": file_name,
                "file_stage": file_stage,
                "ratio": ratio,
                "chunks": chunks,
                "message": message,
            },
        )
