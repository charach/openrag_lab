/**
 * UI primitives — distilled from the Chanel-monochrome design bundle.
 * Stroke icons, format tags, score cells, page header, step card.
 */

import type { CSSProperties, ReactNode } from "react";

type IconName =
  | "wand"
  | "scissors"
  | "chat"
  | "grid"
  | "check"
  | "x"
  | "down"
  | "right"
  | "doc"
  | "trash"
  | "alert"
  | "info"
  | "play"
  | "pause"
  | "upload"
  | "cpu"
  | "lock"
  | "yaml"
  | "settings"
  | "search"
  | "ext"
  | "sun"
  | "moon";

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 14, color = "currentColor" }: IconProps): JSX.Element | null {
  const stroke = {
    stroke: color,
    strokeWidth: 1.25,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const v = "0 0 16 16";
  switch (name) {
    case "wand":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M3 13L12 4M11 3L13 5M2 7L4 5M9 11L11 13" {...stroke} />
        </svg>
      );
    case "scissors":
      return (
        <svg width={size} height={size} viewBox={v}>
          <circle cx="4" cy="11" r="2" {...stroke} />
          <circle cx="12" cy="11" r="2" {...stroke} />
          <path d="M5 9L13 2M11 9L3 2" {...stroke} />
        </svg>
      );
    case "chat":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M2 4H14V11H8L5 14V11H2V4Z" {...stroke} />
        </svg>
      );
    case "grid":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M2 2H7V7H2V2ZM9 2H14V7H9V2ZM2 9H7V14H2V9ZM9 9H14V14H9V9Z" {...stroke} />
        </svg>
      );
    case "check":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M3 8L7 12L13 4" {...stroke} />
        </svg>
      );
    case "x":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M3 3L13 13M13 3L3 13" {...stroke} />
        </svg>
      );
    case "down":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M4 6L8 10L12 6" {...stroke} />
        </svg>
      );
    case "right":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M6 4L10 8L6 12" {...stroke} />
        </svg>
      );
    case "doc":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M3 2H10L13 5V14H3V2ZM10 2V5H13" {...stroke} />
        </svg>
      );
    case "trash":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M3 5H13M6 5V3H10V5M5 5L6 14H10L11 5" {...stroke} />
        </svg>
      );
    case "alert":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M8 2L14 13H2L8 2ZM8 7V10M8 12V12.5" {...stroke} />
        </svg>
      );
    case "info":
      return (
        <svg width={size} height={size} viewBox={v}>
          <circle cx="8" cy="8" r="6" {...stroke} />
          <path d="M8 7V11M8 5V5.5" {...stroke} />
        </svg>
      );
    case "play":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M5 3L13 8L5 13V3Z" {...stroke} />
        </svg>
      );
    case "pause":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M5 3V13M11 3V13" {...stroke} />
        </svg>
      );
    case "upload":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M8 11V2M5 5L8 2L11 5M3 11V13H13V11" {...stroke} />
        </svg>
      );
    case "cpu":
      return (
        <svg width={size} height={size} viewBox={v}>
          <rect x="4" y="4" width="8" height="8" {...stroke} />
          <path
            d="M6 1V4M10 1V4M6 12V15M10 12V15M1 6H4M1 10H4M12 6H15M12 10H15"
            {...stroke}
          />
        </svg>
      );
    case "lock":
      return (
        <svg width={size} height={size} viewBox={v}>
          <rect x="3" y="7" width="10" height="7" {...stroke} />
          <path d="M5 7V4.5C5 3 6 2 8 2C10 2 11 3 11 4.5V7" {...stroke} />
        </svg>
      );
    case "yaml":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M3 3H13V13H3V3ZM6 6H10M6 8H10M6 10H8" {...stroke} />
        </svg>
      );
    case "settings":
      return (
        <svg width={size} height={size} viewBox={v}>
          <circle cx="8" cy="8" r="2" {...stroke} />
          <path
            d="M8 1V3M8 13V15M1 8H3M13 8H15M3 3L4.5 4.5M11.5 11.5L13 13M3 13L4.5 11.5M11.5 4.5L13 3"
            {...stroke}
          />
        </svg>
      );
    case "search":
      return (
        <svg width={size} height={size} viewBox={v}>
          <circle cx="7" cy="7" r="4.5" {...stroke} />
          <path d="M10.5 10.5L14 14" {...stroke} />
        </svg>
      );
    case "ext":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M11 3H13V5M13 3L8 8M9 3H4V12H13V7" {...stroke} />
        </svg>
      );
    case "sun":
      return (
        <svg width={size} height={size} viewBox={v}>
          <circle cx="8" cy="8" r="3" {...stroke} />
          <path
            d="M8 1V3M8 13V15M1 8H3M13 8H15M3 3L4.5 4.5M11.5 11.5L13 13M3 13L4.5 11.5M11.5 4.5L13 3"
            {...stroke}
          />
        </svg>
      );
    case "moon":
      return (
        <svg width={size} height={size} viewBox={v}>
          <path d="M13 9.5C12 12 9.5 13.5 7 13C4.5 12.5 3 10 3 7.5C3 5.5 4 3.5 6 2.5C5.5 5 6.5 7.5 8.5 8.5C10 9.2 11.5 9.5 13 9.5Z" {...stroke} />
        </svg>
      );
  }
  return null;
}

export function FormatTag({ format }: { format: string }): JSX.Element {
  const labels: Record<string, string> = {
    pdf: "PDF",
    txt: "TXT",
    md: "MD",
    docx: "DOCX",
    html: "HTML",
  };
  return (
    <span
      className="t-mono"
      style={{
        fontSize: 9,
        letterSpacing: "0.08em",
        padding: "2px 5px",
        border: "1px solid var(--border-strong)",
        color: "var(--text-1)",
        minWidth: 28,
        textAlign: "center",
      }}
    >
      {labels[format] ?? format.toUpperCase()}
    </span>
  );
}

export function RetrievalOnlyBadge({ size = "sm" }: { size?: "sm" | "lg" }): JSX.Element {
  return (
    <span
      className="chip"
      style={{
        borderColor: "var(--text-1)",
        color: "var(--text-0)",
        fontSize: size === "lg" ? 11 : 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      Retrieval-only
    </span>
  );
}

/**
 * Renders a 0..1 score with a charcoal→gold tint. Higher values get warmer
 * backgrounds and a gold rule on the right; null renders an em-dash.
 */
export function ScoreCell({ value }: { value: number | null }): JSX.Element {
  if (value === null) {
    return (
      <span className="t-meta t-mono" title="retrieval-only mode">
        —
      </span>
    );
  }
  const t = Math.max(0, Math.min(1, value));
  const l = 0.3 + t * 0.4;
  const c = t * 0.1;
  const h = 70 + t * 18;
  const bg = `oklch(${l} ${c} ${h} / 0.18)`;
  const fg = t > 0.85 ? "var(--accent)" : t > 0.6 ? "var(--text-0)" : "var(--text-1)";
  return (
    <span
      className="t-mono t-num"
      style={{
        display: "inline-block",
        minWidth: 56,
        padding: "4px 8px",
        textAlign: "right",
        background: bg,
        color: fg,
        fontSize: 13,
        borderRight: t > 0.85 ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      {value.toFixed(2)}
    </span>
  );
}

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}

export function PageHeader({ eyebrow, title, sub, right }: PageHeaderProps): JSX.Element {
  return (
    <div className="row f-between" style={{ alignItems: "flex-start", gap: 24 }}>
      <div className="col gap-12">
        <span className="t-label" style={{ color: "var(--accent)" }}>
          {eyebrow}
        </span>
        <h1 className="t-28" style={{ maxWidth: 720 }}>
          {title}
        </h1>
        {sub && (
          <p className="t-14 t-dim" style={{ margin: 0, maxWidth: 720 }}>
            {sub}
          </p>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

interface StepProps {
  number: string;
  title: string;
  subtitle?: string | undefined;
  status: "todo" | "active" | "done";
  children?: ReactNode;
}

export function Step({ number, title, subtitle, status, children }: StepProps): JSX.Element {
  const isActive = status === "active";
  const isDone = status === "done";
  return (
    <section className="card" style={{ padding: "20px 24px" }}>
      <div className="row f-between f-center" style={{ marginBottom: 16 }}>
        <div className="row gap-16 f-center">
          <span
            className="t-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              color: isActive
                ? "var(--accent)"
                : isDone
                  ? "var(--text-1)"
                  : "var(--text-2)",
            }}
          >
            STEP {number}
          </span>
          <span className="t-20" style={{ color: "var(--text-0)" }}>
            {title}
          </span>
          {subtitle && (
            <span className="t-meta t-12" style={{ marginLeft: 4 }}>
              · {subtitle}
            </span>
          )}
        </div>
        {isDone && <Icon name="check" size={14} color="var(--success)" />}
        {isActive && (
          <span className="chip chip-gold">
            <span className="dot dot-gold"></span>In progress
          </span>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

interface DrawerProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}

export function Drawer({ title, children, onClose, width = 540 }: DrawerProps): JSX.Element {
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
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width,
          maxWidth: "90vw",
          height: "100vh",
          background: "var(--bg-1)",
          borderLeft: "1px solid var(--border-strong)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="row f-between f-center"
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span className="t-13" style={{ color: "var(--text-0)" }}>
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="close"
            className="btn-ghost"
            style={{
              border: 0,
              background: "transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ padding: 20, overflow: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /**
   * Optional confirm shortcut. When set, pressing Enter anywhere inside
   * the modal (except multi-line text areas) fires this handler. Lets
   * dismiss-on-Esc / confirm-on-Enter behave consistently across every
   * modal without each callsite re-binding the same key handler.
   */
  onConfirm?: () => void;
  footer?: ReactNode;
  width?: number;
}

export function Modal({
  title,
  children,
  onClose,
  onConfirm,
  footer,
  width = 480,
}: ModalProps): JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "Enter" && onConfirm) {
      const target = e.target as HTMLElement;
      // Don't hijack newline-in-textarea or multi-line composers.
      if (target.tagName === "TEXTAREA") return;
      // IME composition shouldn't trigger the confirm.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      onConfirm();
    }
  };
  return (
    <div
      role="dialog"
      aria-label={title}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      tabIndex={-1}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        className="card"
        style={{
          width,
          maxWidth: "90vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-1)",
          border: "1px solid var(--border-strong)",
        }}
      >
        <div
          className="row f-between f-center"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span className="t-13" style={{ color: "var(--text-0)" }}>
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="close"
            className="btn-ghost"
            style={{
              border: 0,
              background: "transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ padding: 18, overflow: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div
            className="row gap-8"
            style={{
              justifyContent: "flex-end",
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span className="t-label" style={style}>
      {children}
    </span>
  );
}
