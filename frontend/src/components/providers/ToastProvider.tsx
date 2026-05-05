/**
 * Top-right toast queue. Replaces ad-hoc inline status messages scattered
 * across screens with a single consistent surface (eyebrow + body, gold or
 * red side rule). Toasts auto-dismiss after ``DEFAULT_TTL_MS``.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const DEFAULT_TTL_MS = 3200;

export interface Toast {
  id: string;
  eyebrow?: string;
  message: ReactNode;
  kind?: "info" | "error";
}

interface ToastContextValue {
  push: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string): void => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">): string => {
      const id = `t_${Math.random().toString(36).slice(2, 8)}`;
      setToasts((ts) => [...ts, { ...t, id }]);
      window.setTimeout(() => dismiss(id), DEFAULT_TTL_MS);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 72,
          right: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 4000,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="card fade-in"
            style={{
              padding: "10px 14px",
              minWidth: 240,
              borderLeft:
                "2px solid " + (t.kind === "error" ? "var(--error)" : "var(--accent)"),
              pointerEvents: "auto",
            }}
          >
            <div
              className="t-label"
              style={{
                fontSize: 9,
                color: t.kind === "error" ? "var(--error)" : "var(--accent)",
              }}
            >
              {t.eyebrow ?? (t.kind === "error" ? "Error" : "Saved")}
            </div>
            <div className="t-13" style={{ marginTop: 3 }}>
              {t.message}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
