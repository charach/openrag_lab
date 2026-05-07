"""Unit tests for ``WebSocketHub`` — focus on last-message replay semantics."""

from __future__ import annotations

import asyncio

import pytest

from openrag_lab.app.ws.hub import WebSocketHub


@pytest.mark.asyncio
async def test_publish_fans_out_to_subscribed_topic() -> None:
    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, ["t1"])

    await hub.publish("t1", {"type": "ping"})

    msg = sub.queue.get_nowait()
    assert msg == {"type": "ping", "topic": "t1"}


@pytest.mark.asyncio
async def test_late_subscribe_replays_last_message() -> None:
    """A producer that publishes before any subscriber should not strand the UI."""
    hub = WebSocketHub()
    await hub.publish("experiment:exp_1", {"type": "progress", "ratio": 1.0})

    sub = await hub.attach()
    await hub.subscribe(sub, ["experiment:exp_1"])

    msg = sub.queue.get_nowait()
    assert msg["type"] == "progress"
    assert msg["ratio"] == 1.0
    assert msg["topic"] == "experiment:exp_1"


@pytest.mark.asyncio
async def test_replay_is_only_the_last_message() -> None:
    hub = WebSocketHub()
    await hub.publish("t1", {"type": "progress", "ratio": 0.3})
    await hub.publish("t1", {"type": "progress", "ratio": 0.7})
    await hub.publish("t1", {"type": "progress", "ratio": 1.0})

    sub = await hub.attach()
    await hub.subscribe(sub, ["t1"])

    msg = sub.queue.get_nowait()
    assert msg["ratio"] == 1.0
    with pytest.raises(asyncio.QueueEmpty):
        sub.queue.get_nowait()


@pytest.mark.asyncio
async def test_resubscribe_does_not_replay_again() -> None:
    """Subscribing to a topic already in the subscription set is a no-op."""
    hub = WebSocketHub()
    await hub.publish("t1", {"type": "ping"})

    sub = await hub.attach()
    await hub.subscribe(sub, ["t1"])
    sub.queue.get_nowait()  # consume the replay
    await hub.subscribe(sub, ["t1"])

    with pytest.raises(asyncio.QueueEmpty):
        sub.queue.get_nowait()


@pytest.mark.asyncio
async def test_no_replay_for_topic_with_no_history() -> None:
    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, ["fresh-topic"])

    with pytest.raises(asyncio.QueueEmpty):
        sub.queue.get_nowait()


@pytest.mark.asyncio
async def test_subscribe_replays_only_for_newly_added_topics() -> None:
    hub = WebSocketHub()
    await hub.publish("t1", {"type": "a"})
    await hub.publish("t2", {"type": "b"})

    sub = await hub.attach()
    await hub.subscribe(sub, ["t1"])
    sub.queue.get_nowait()  # drain t1 replay

    await hub.subscribe(sub, ["t1", "t2"])  # t1 already subscribed → no replay
    msg = sub.queue.get_nowait()
    assert msg["type"] == "b" and msg["topic"] == "t2"
    with pytest.raises(asyncio.QueueEmpty):
        sub.queue.get_nowait()


@pytest.mark.asyncio
async def test_publish_after_subscribe_still_delivers_live() -> None:
    """Cache must not break live fan-out."""
    hub = WebSocketHub()
    sub = await hub.attach()
    await hub.subscribe(sub, ["t1"])

    await hub.publish("t1", {"type": "first"})
    await hub.publish("t1", {"type": "second"})

    assert sub.queue.get_nowait()["type"] == "first"
    assert sub.queue.get_nowait()["type"] == "second"
