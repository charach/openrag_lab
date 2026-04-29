/**
 * Tiny ``/ws`` subscription hook.
 *
 * Opens one connection per mount, lets the caller subscribe to topics, and
 * pushes received payloads through a callback. Reconnects with exponential
 * backoff up to 30 seconds (API_SPEC §14.4). Designed to be thin — apps
 * that need richer behaviour wrap this in their own store.
 */

import { useEffect, useRef } from "react";

export interface WSMessage {
  topic: string;
  type: string;
  [key: string]: unknown;
}

export interface UseWebSocketOptions {
  topics: string[];
  onMessage: (message: WSMessage) => void;
  enabled?: boolean;
}

export function useWebSocket({
  topics,
  onMessage,
  enabled = true,
}: UseWebSocketOptions): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!enabled || topics.length === 0) return;
    let backoff = 1000;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = (): void => {
      if (cancelled) return;
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        backoff = 1000;
        socket?.send(JSON.stringify({ action: "subscribe", topics }));
      });
      socket.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data) as WSMessage;
          handlerRef.current(data);
        } catch {
          // ignore malformed payloads
        }
      });
      socket.addEventListener("close", () => {
        if (cancelled) return;
        reconnectTimer = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      });
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled, topics.join("|")]);
}
