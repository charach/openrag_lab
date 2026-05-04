/**
 * Verifies that useWebSocket suppresses connection-level acks
 * (``subscribed`` / ``unsubscribed``) so they never surface as topic
 * events. Regression for the bug where Auto-Pilot rendered "subscribed"
 * as the indexing stage label.
 */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket, type WSMessage } from "./useWebSocket";

class MockSocket {
  static instances: MockSocket[] = [];
  url: string;
  readyState = 0;
  listeners: Record<string, ((ev: { data?: string }) => void)[]> = {};
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: { data?: string }) => void): void {
    (this.listeners[name] ||= []).push(fn);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* no-op */
  }
  fire(name: string, ev: { data?: string } = {}): void {
    for (const fn of this.listeners[name] ?? []) fn(ev);
  }
}

function Harness({ onMessage }: { onMessage: (m: WSMessage) => void }) {
  useWebSocket({ topics: ["indexing.task_1"], onMessage, enabled: true });
  return null;
}

describe("useWebSocket", () => {
  beforeEach(() => {
    MockSocket.instances = [];
    vi.stubGlobal("WebSocket", MockSocket as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters out 'subscribed' control frames", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} />);
    const socket = MockSocket.instances[0]!;
    act(() => {
      socket.fire("open");
      socket.fire("message", { data: JSON.stringify({ type: "subscribed", topics: ["x"] }) });
    });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("forwards real progress frames", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} />);
    const socket = MockSocket.instances[0]!;
    act(() => {
      socket.fire("open");
      socket.fire("message", {
        data: JSON.stringify({ topic: "indexing.task_1", type: "parsing", ratio: 0.4 }),
      });
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({ type: "parsing", ratio: 0.4 });
  });
});
