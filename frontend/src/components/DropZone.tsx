/**
 * Shared drop-zone surface used by Auto-Pilot, Library, and any modal that
 * needs a click-or-drag file picker. Validation/upload logic stays with the
 * caller — this component only owns the drag UI and the hidden file input.
 */

import { useRef, useState, type DragEvent } from "react";
import { Icon } from "./ui";

export interface DropZoneProps {
  /** Comma-separated accept attribute for the hidden input. */
  accept?: string;
  /** Primary caption. */
  caption?: string;
  /** Optional secondary hint line. Only rendered in `stack` layout. */
  hint?: string;
  /** "stack" centres icon above caption; "row" lays them inline. Defaults to "stack". */
  layout?: "stack" | "row";
  /** Disables interaction. While disabled, `disabledCaption` replaces caption. */
  disabled?: boolean;
  disabledCaption?: string;
  /** Padding around contents. */
  padding?: string;
  /** Idle background color. */
  background?: string;
  iconSize?: number;
  /** Receives dropped or picked files. */
  onFiles: (files: File[]) => void;
  "data-testid"?: string;
}

export function DropZone({
  accept,
  caption = "Drop files here, or click to browse",
  hint,
  layout = "stack",
  disabled = false,
  disabledCaption,
  padding,
  background = "var(--bg-1)",
  iconSize = layout === "row" ? 14 : 20,
  onFiles,
  "data-testid": testId,
}: DropZoneProps): JSX.Element {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const effectivePadding = padding ?? (layout === "row" ? "20px" : "32px 24px");

  const handleDragOver = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    if (!disabled) setDrag(true);
  };
  const handleDragLeave = (): void => setDrag(false);
  const handleDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setDrag(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) onFiles(dropped);
  };

  const text = disabled && disabledCaption ? disabledCaption : caption;

  return (
    <label
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid={testId}
      style={{
        display: "block",
        border: `1px dashed ${drag ? "var(--accent)" : "var(--border-strong)"}`,
        background: drag ? "var(--accent-faint)" : background,
        padding: effectivePadding,
        textAlign: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.7 : 1,
        transition: "background 120ms",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files));
          e.currentTarget.value = "";
        }}
      />
      {layout === "row" ? (
        <div className="row f-center" style={{ justifyContent: "center", gap: 8 }}>
          <Icon name="upload" size={iconSize} color="var(--text-1)" />
          <span className="t-13 t-dim">{text}</span>
        </div>
      ) : (
        <>
          <Icon name="upload" size={iconSize} color="var(--text-2)" />
          <div className="t-14" style={{ marginTop: 10 }}>
            {text}
          </div>
          {hint && (
            <div className="t-12 t-meta" style={{ marginTop: 4 }}>
              {hint}
            </div>
          )}
        </>
      )}
    </label>
  );
}
