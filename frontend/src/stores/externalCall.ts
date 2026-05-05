/**
 * External-LLM call indicator. The header dot reads this store; the chat
 * screen flips it on while a question is in flight against an external
 * provider so the user can spot when their data leaves local-only mode.
 */

import { create } from "zustand";

export interface ExternalCallState {
  /** Provider id when a call is in flight, else ``null``. */
  call: { provider: string; stage: string } | null;
  begin: (provider: string, stage?: string) => void;
  end: () => void;
}

export const useExternalCallStore = create<ExternalCallState>((set) => ({
  call: null,
  begin: (provider, stage = "generation") => set({ call: { provider, stage } }),
  end: () => set({ call: null }),
}));
