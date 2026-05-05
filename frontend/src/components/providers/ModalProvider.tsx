/**
 * Global modal stack. Lets any screen open a modal without owning the
 * open/close state itself, and lets a modal open another modal on top
 * (e.g. Library row → ExportModal → confirm dialog). ESC closes the top
 * of the stack; clicks on the backdrop close the clicked modal.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../ui";

export interface ModalSpec {
  /** Bold caption above the title — uppercase, gold (or red when ``danger``). */
  eyebrow?: string;
  title: string;
  /** Modal body. Receives a ``close`` callback so children can dismiss themselves. */
  render: (ctx: { close: () => void }) => ReactNode;
  /** Optional sticky footer. Receives the same ``close`` callback. */
  footer?: (ctx: { close: () => void }) => ReactNode;
  width?: number;
  /** Renders a red top-rule and a red eyebrow. Use for destructive actions. */
  danger?: boolean;
}

interface ModalContextValue {
  open: (spec: ModalSpec) => string;
  close: (id: string) => void;
  closeAll: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

interface StackEntry extends ModalSpec {
  id: string;
}

export function ModalProvider({ children }: { children: ReactNode }): JSX.Element {
  const [stack, setStack] = useState<StackEntry[]>([]);

  const open = useCallback((spec: ModalSpec): string => {
    const id = `m_${Math.random().toString(36).slice(2, 9)}`;
    setStack((s) => [...s, { ...spec, id }]);
    return id;
  }, []);

  const close = useCallback((id: string): void => {
    setStack((s) => s.filter((m) => m.id !== id));
  }, []);

  const closeAll = useCallback((): void => setStack([]), []);

  // ESC closes the top of the stack only — leaves any modals beneath open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const top = stack[stack.length - 1];
      if (top) close(top.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack, close]);

  const value = useMemo(() => ({ open, close, closeAll }), [open, close, closeAll]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {stack.map((m, i) => (
        <ModalShell
          key={m.id}
          spec={m}
          z={1000 + i * 10}
          onClose={() => close(m.id)}
        />
      ))}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used inside <ModalProvider>");
  return ctx;
}

interface ModalShellProps {
  spec: StackEntry;
  z: number;
  onClose: () => void;
}

function ModalShell({ spec, z, onClose }: ModalShellProps): JSX.Element {
  const { width = 480, title, eyebrow, danger, render, footer } = spec;
  return (
    <div
      role="dialog"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: z,
        animation: "fade-in 120ms ease-out",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "92vw",
          maxHeight: "88vh",
          background: "var(--bg-1)",
          border: "1px solid var(--border-strong)",
          borderTop: `2px solid ${danger ? "var(--error)" : "var(--accent)"}`,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)" }}>
          {eyebrow && (
            <div
              className="t-label"
              style={{
                color: danger ? "var(--error)" : "var(--accent)",
                marginBottom: 6,
              }}
            >
              {eyebrow}
            </div>
          )}
          <div className="row f-between f-center">
            <h3 className="t-20" style={{ margin: 0, fontWeight: 300 }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              aria-label="close"
              className="btn-ghost"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                padding: 6,
                color: "var(--text-2)",
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <div style={{ padding: "18px 24px", overflowY: "auto", flex: 1 }}>
          {render({ close: onClose })}
        </div>
        {footer && (
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            {footer({ close: onClose })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Helper: open a Cancel / Confirm dialog without writing the boilerplate
 * each time. ``danger=true`` swaps the primary button to a red ghost button
 * matching the existing destructive style (see Shell delete modal).
 */
export function confirmModal(
  modal: ModalContextValue,
  args: {
    title: string;
    message: ReactNode;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm?: () => void | Promise<void>;
  },
): string {
  const { title, message, confirmLabel = "Confirm", danger = false, onConfirm } = args;
  return modal.open({
    title,
    eyebrow: danger ? "Confirm — destructive" : "Confirm",
    danger,
    width: 440,
    render: () => (
      <p className="t-13 t-dim" style={{ margin: 0, lineHeight: 1.6 }}>
        {message}
      </p>
    ),
    footer: ({ close }) => (
      <>
        <button className="btn btn-sm" onClick={close}>
          Cancel
        </button>
        <button
          className={"btn btn-sm " + (danger ? "" : "btn-primary")}
          style={
            danger
              ? { borderColor: "var(--error)", color: "var(--error)" }
              : undefined
          }
          onClick={() => {
            void onConfirm?.();
            close();
          }}
        >
          {confirmLabel}
        </button>
      </>
    ),
  });
}
