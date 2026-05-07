/**
 * Floating progress bar for an active /experiments/batch run. Mounted at
 * the App level so it survives navigation between pages — the user can
 * leave the Experiments screen mid-batch and still see ETA + cancel.
 */

import { useMemo } from "react";
import { api } from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";
import { useBatchSessionStore } from "../stores/batchSession";
import { Icon } from "./ui";

export function BatchSessionBar(): JSX.Element | null {
  const { phase, active, applyMessage, markCancelled, markError, dismiss } =
    useBatchSessionStore();

  const topics = useMemo(
    () => (active ? [active.websocketTopic] : []),
    [active],
  );
  useWebSocket({
    topics,
    enabled: active !== null,
    onMessage: (msg) => applyMessage(msg),
  });

  if (!active || phase === "idle") return null;

  const { done, total, startedAtMs, current, taskId, batchId } = active;
  const ratio = total === 0 ? 0 : done / total;
  const elapsedMs = Date.now() - startedAtMs;
  const remainingMs = done === 0 ? null : (elapsedMs / done) * (total - done);
  const eta = remainingMs === null ? "—" : formatMs(remainingMs);
  const isFinished = phase === "done" || phase === "cancelled" || phase === "error";

  const cancel = async (): Promise<void> => {
    try {
      await api.cancelTask(taskId);
      markCancelled();
    } catch (e) {
      markError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      data-testid="batch-session-bar"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        background: "var(--bg-1)",
        border: `1px solid ${phase === "error" ? "var(--error)" : "var(--border-strong)"}`,
        padding: "12px 18px",
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <span
        className={
          isFinished ? "dot dot-success" : "dot dot-gold pulse-gold"
        }
      ></span>
      <div className="col" style={{ flex: 1, gap: 4 }}>
        <div className="row f-between f-center">
          <span className="t-13">
            Batch sweep · {done} / {total}
            {current && phase === "running" ? (
              <span className="t-12 t-mono t-meta" style={{ marginLeft: 12 }}>
                {current.embedder_id} · {current.chunking.strategy}{" "}
                {current.chunking.chunk_size}/{current.chunking.chunk_overlap} ·{" "}
                {current.retrieval_strategy}
              </span>
            ) : null}
          </span>
          <span className="t-12 t-mono t-meta">
            {phase === "running" ? `ETA ${eta}` : phase}
          </span>
        </div>
        <div style={{ height: 2, background: "var(--bg-3)", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${Math.min(100, ratio * 100)}%`,
              background: phase === "error" ? "var(--error)" : "var(--accent)",
              transition: "width 220ms linear",
            }}
          />
        </div>
      </div>
      <span className="t-12 t-mono t-meta" title={`task ${taskId}`}>
        {batchId.slice(0, 14)}
      </span>
      {phase === "running" ? (
        <button
          className="btn btn-sm"
          onClick={() => void cancel()}
          data-testid="batch-cancel"
          style={{ borderColor: "var(--border-strong)", color: "var(--text-1)" }}
        >
          <Icon name="x" size={11} /> Cancel
        </button>
      ) : (
        <button
          className="btn btn-sm"
          onClick={dismiss}
          data-testid="batch-dismiss"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
