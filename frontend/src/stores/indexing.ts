/**
 * Indexing job store — keeps the active task + last WS progress message
 * across screen navigations. Without this, leaving Auto-Pilot mid-indexing
 * unmounts the wizard and the user loses the running job's UI.
 *
 * Only one job is tracked at a time: the wizard is single-job and the
 * design only ever shows one indexing strip in the header / step 03.
 */

import { create } from "zustand";
import type { IndexAcceptedResponse } from "../api/client";
import type { WSMessage } from "../hooks/useWebSocket";

export type IndexingPhase =
  | "idle"
  | "starting"
  | "running"
  | "done"
  | "cancelled"
  | "error";

interface IndexingState {
  phase: IndexingPhase;
  task: IndexAcceptedResponse | null;
  progress: WSMessage | null;
  workspaceId: string | null;
  error: string | null;
  startStarting: (workspaceId: string) => void;
  setTask: (task: IndexAcceptedResponse) => void;
  setProgress: (msg: WSMessage) => void;
  markDone: () => void;
  markCancelled: () => void;
  markError: (message: string) => void;
  reset: () => void;
}

export const useIndexingStore = create<IndexingState>((set) => ({
  phase: "idle",
  task: null,
  progress: null,
  workspaceId: null,
  error: null,
  startStarting: (workspaceId) =>
    set({
      phase: "starting",
      task: null,
      progress: null,
      workspaceId,
      error: null,
    }),
  setTask: (task) => set({ phase: "running", task }),
  setProgress: (msg) => {
    const ratio = typeof msg.ratio === "number" ? msg.ratio : null;
    set((s) => ({
      progress: msg,
      phase: ratio !== null && ratio >= 0.999 ? "done" : s.phase === "starting" ? "running" : s.phase,
    }));
  },
  markDone: () => set({ phase: "done" }),
  markCancelled: () => set({ phase: "cancelled" }),
  markError: (message) => set({ phase: "error", error: message }),
  reset: () =>
    set({ phase: "idle", task: null, progress: null, workspaceId: null, error: null }),
}));
