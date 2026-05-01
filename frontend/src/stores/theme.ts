/**
 * Theme store — switches the document's `data-theme` attribute between
 * "noir" (dark) and "pearl" (light). Persists to localStorage so the next
 * boot lands on the user's last choice.
 */

import { useEffect } from "react";
import { create } from "zustand";

export type ThemeName = "noir" | "pearl";

const STORAGE_KEY = "openrag.theme";

const initial = ((): ThemeName => {
  if (typeof window === "undefined") return "noir";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "noir" || stored === "pearl") return stored;
  return "noir";
})();

interface ThemeState {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial,
  setTheme: (next) => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
    set({ theme: next });
  },
  toggle: () => {
    const next = get().theme === "noir" ? "pearl" : "noir";
    get().setTheme(next);
  },
}));

/** Apply the persisted theme on mount. Use once at the app root. */
export function useApplyTheme(): void {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
}
