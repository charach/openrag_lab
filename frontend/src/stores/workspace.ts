/**
 * Selected-workspace store. Other screens read ``activeWorkspace`` to know
 * which workspace they should fetch under. Keep this minimal — Zustand is
 * not the place for cached server data, just for navigation state.
 *
 * The active id is persisted to localStorage so reload/restart lands the
 * user back on the workspace they were just using, instead of falling
 * through to whatever the backend returns first.
 */

import { create } from "zustand";

const STORAGE_KEY = "openrag.activeWorkspaceId";

const initial = ((): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
})();

interface WorkspaceState {
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: initial,
  setActiveWorkspace: (id) => {
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
    set({ activeWorkspaceId: id });
  },
}));
