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

export type FileStage =
  | "queued"
  | "parsing"
  | "chunking"
  | "embedding"
  | "embedded"
  | "skipped"
  | "failed";

export interface FileProgress {
  fileId: string;
  fileName: string;
  stage: FileStage;
  ratio: number;
  chunks: number | null;
  message: string;
}

interface IndexingState {
  phase: IndexingPhase;
  task: IndexAcceptedResponse | null;
  progress: WSMessage | null;
  files: Record<string, FileProgress>;
  workspaceId: string | null;
  error: string | null;
  startStarting: (workspaceId: string) => void;
  setTask: (task: IndexAcceptedResponse) => void;
  setProgress: (msg: WSMessage) => void;
  setFileProgress: (msg: WSMessage) => void;
  markDone: () => void;
  markCancelled: () => void;
  markError: (message: string) => void;
  reset: () => void;
}

const FILE_STAGES = new Set<FileStage>([
  "queued",
  "parsing",
  "chunking",
  "embedding",
  "embedded",
  "skipped",
  "failed",
]);

export const useIndexingStore = create<IndexingState>((set) => ({
  phase: "idle",
  task: null,
  progress: null,
  files: {},
  workspaceId: null,
  error: null,
  startStarting: (workspaceId) =>
    set({
      phase: "starting",
      task: null,
      progress: null,
      files: {},
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
  setFileProgress: (msg) => {
    const fileId = typeof msg.file_id === "string" ? msg.file_id : null;
    const fileName = typeof msg.file_name === "string" ? msg.file_name : null;
    const fileStage = typeof msg.file_stage === "string" ? msg.file_stage : null;
    const ratio = typeof msg.ratio === "number" ? msg.ratio : 0;
    const chunks = typeof msg.chunks === "number" ? msg.chunks : null;
    const message = typeof msg.message === "string" ? msg.message : "";
    if (!fileId || !fileName || !fileStage) return;
    if (!FILE_STAGES.has(fileStage as FileStage)) return;
    set((s) => ({
      files: {
        ...s.files,
        [fileId]: {
          fileId,
          fileName,
          stage: fileStage as FileStage,
          ratio,
          chunks,
          message,
        },
      },
    }));
  },
  markDone: () => set({ phase: "done" }),
  markCancelled: () => set({ phase: "cancelled" }),
  markError: (message) => set({ phase: "error", error: message }),
  reset: () =>
    set({
      phase: "idle",
      task: null,
      progress: null,
      files: {},
      workspaceId: null,
      error: null,
    }),
}));
