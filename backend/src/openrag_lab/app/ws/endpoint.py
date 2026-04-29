"""WebSocket endpoint — exposes the in-process hub at ``/ws``.

Protocol per API_SPEC §14:
* Client sends ``{"action": "subscribe", "topics": [...]}`` after connect.
* Server replies with ``{"type": "subscribed", "topics": [...]}``.
* Server pushes published messages to subscribers as they arrive.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from openrag_lab.app.state import AppState

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    state: AppState = websocket.app.state.app_state
    sub = await state.hub.attach()

    sender = asyncio.create_task(_pump_outgoing(websocket, sub.queue))
    try:
        while True:
            message = await websocket.receive_json()
            await _handle_command(state, sub, websocket, message)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: S110 — defensive against client junk
        pass
    finally:
        sender.cancel()
        with contextlib.suppress(BaseException):
            await sender
        await state.hub.detach(sub)


async def _pump_outgoing(websocket: WebSocket, queue: asyncio.Queue[dict[str, Any]]) -> None:
    while True:
        message = await queue.get()
        try:
            await websocket.send_json(message)
        except Exception:
            return


async def _handle_command(
    state: AppState,
    sub: Any,
    websocket: WebSocket,
    message: dict[str, Any],
) -> None:
    action = message.get("action")
    topics = message.get("topics")
    if not isinstance(topics, list):
        topics = []

    if action == "subscribe":
        active = await state.hub.subscribe(sub, [str(t) for t in topics])
        await websocket.send_json({"type": "subscribed", "topics": active})
    elif action == "unsubscribe":
        active = await state.hub.unsubscribe(sub, [str(t) for t in topics])
        await websocket.send_json({"type": "unsubscribed", "topics": active})
    else:
        await websocket.send_json({"type": "error", "message": f"unknown action: {action}"})
