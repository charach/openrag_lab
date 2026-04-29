/**
 * Selected-workspace store. Other screens read ``activeWorkspace`` to know
 * which workspace they should fetch under. Keep this minimal — Zustand is
 * not the place for cached server data, just for navigation state.
 */

import { create } from "zustand";

interface WorkspaceState {
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: null,
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
}));
