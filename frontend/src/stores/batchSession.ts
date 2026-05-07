/**
 * Tracks the single active batch run so the BatchSessionBar can stay
 * mounted across navigations. Mirrors ``indexingStore`` in spirit but
 * for ``/experiments/batch`` runs.
 */

import { create } from "zustand";

export interface BatchCombo {
  embedder_id: string;
  chunking: { strategy: string; chunk_size: number; chunk_overlap: number };
  retrieval_strategy: string;
}

export interface BatchProgressCombo extends BatchCombo {
  index: number;
  experiment_id: string;
  scores: Record<string, number | null>;
}

export type BatchPhase = "idle" | "running" | "done" | "cancelled" | "error";

export interface ActiveBatch {
  batchId: string;
  taskId: string;
  websocketTopic: string;
  workspaceId: string;
  combos: BatchCombo[];
  done: number;
  total: number;
  current: BatchProgressCombo | null;
  startedAtMs: number;
  results: Array<{ experiment_id: string; scores: Record<string, number | null> }>;
}

interface BatchSessionState {
  phase: BatchPhase;
  active: ActiveBatch | null;
  error: string | null;
  start: (init: {
    batchId: string;
    taskId: string;
    websocketTopic: string;
    workspaceId: string;
    total: number;
  }) => void;
  applyMessage: (msg: { type: string; [k: string]: unknown }) => void;
  markCancelled: () => void;
  markError: (message: string) => void;
  dismiss: () => void;
}

export const useBatchSessionStore = create<BatchSessionState>((set) => ({
  phase: "idle",
  active: null,
  error: null,
  start: ({ batchId, taskId, websocketTopic, workspaceId, total }) =>
    set({
      phase: "running",
      error: null,
      active: {
        batchId,
        taskId,
        websocketTopic,
        workspaceId,
        combos: [],
        done: 0,
        total,
        current: null,
        startedAtMs: Date.now(),
        results: [],
      },
    }),
  applyMessage: (msg) =>
    set((s) => {
      if (!s.active) return {};
      if (msg.type === "started") {
        const combos = Array.isArray(msg.combos) ? (msg.combos as BatchCombo[]) : [];
        const total = typeof msg.total === "number" ? msg.total : s.active.total;
        return { active: { ...s.active, combos, total } };
      }
      if (msg.type === "progress") {
        const done = typeof msg.done === "number" ? msg.done : s.active.done;
        const total = typeof msg.total === "number" ? msg.total : s.active.total;
        const current =
          typeof msg.current_combo === "object" && msg.current_combo
            ? (msg.current_combo as BatchProgressCombo)
            : s.active.current;
        const next = { ...s.active, done, total, current };
        if (current) {
          next.results = [
            ...s.active.results,
            { experiment_id: current.experiment_id, scores: current.scores },
          ];
        }
        return { active: next };
      }
      if (msg.type === "completed") {
        const cancelled = msg.cancelled === true;
        return {
          phase: cancelled ? "cancelled" : "done",
          active: {
            ...s.active,
            done: s.active.total,
            results: Array.isArray(msg.results)
              ? (msg.results as ActiveBatch["results"])
              : s.active.results,
          },
        };
      }
      return {};
    }),
  markCancelled: () => set({ phase: "cancelled" }),
  markError: (message) => set({ phase: "error", error: message }),
  dismiss: () => set({ phase: "idle", active: null, error: null }),
}));
