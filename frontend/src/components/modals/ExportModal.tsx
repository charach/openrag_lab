/**
 * Reusable export modal — used by:
 *   - Chat thread export (yaml/json/md)
 *   - Chunking Lab config export (yaml/json)
 *   - Library document-list export (csv/json/yaml)
 *   - Experiment A/B export (yaml/json/csv)
 *   - Golden set export (csv/json/yaml)
 *
 * The same shell handles format selection, save-to picker (browsers can't
 * actually pick a path — we surface the configured ``OPENRAG_HOME``
 * exports dir as the default and offer ``~/Downloads`` / ``~/Desktop`` as
 * quick presets), section toggles, and a live preview pane.
 *
 * Saving is intentionally a faux confirmation (Saving → Done with copy
 * path / reveal-in-finder). The actual write happens via the caller's
 * ``onSave`` — typically by handing off to the browser download flow
 * since OpenRAG-Lab ships without a desktop shell yet.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useToast } from "../providers/ToastProvider";
import { Icon } from "../ui";

export type ExportFormat = "yaml" | "json" | "csv" | "md";

export interface ExportSection {
  id: string;
  label: string;
  /** Short human-readable hint about what bytes this section would write. */
  note?: string;
  /** Pre-rendered size string, e.g. ``"1.2 KB"``. */
  size?: string;
  /** Required sections cannot be unchecked. */
  required?: boolean;
}

export interface ExportModalDefaults {
  format: ExportFormat;
  /** Filename without extension. Combined with ``format`` → final filename. */
  filename: string;
  /** Path component shown to the user. The picker is informational only. */
  path: string;
  /** Available format chips. Order is preserved in the UI. */
  formats: ExportFormat[];
  sectionsConfig?: ExportSection[];
  /** Initial checked state per section id. */
  includes?: Record<string, boolean>;
}

export interface ExportModalProps {
  defaults: ExportModalDefaults;
  /**
   * Returns a previewable string for the chosen format. Optional — when
   * omitted the preview pane is hidden.
   */
  preview?: (format: ExportFormat, includes: Record<string, boolean>) => string;
  /**
   * Called when the user confirms. Receives the resolved filename, format
   * path, included sections, and the rendered preview (when applicable).
   * The caller is responsible for the actual export (download, fetch, etc).
   */
  onSave?: (args: {
    format: ExportFormat;
    filename: string;
    path: string;
    fullPath: string;
    includes: Record<string, boolean>;
    body: string;
  }) => void | Promise<void>;
  close: () => void;
}

const DEFAULT_PATH_PRESETS = ["~/openrag-lab/exports", "~/Downloads", "~/Desktop"];

export function ExportModal({
  defaults,
  preview,
  onSave,
  close,
}: ExportModalProps): JSX.Element {
  const [format, setFormat] = useState<ExportFormat>(defaults.format);
  const [filename, setFilename] = useState(defaults.filename);
  const [path, setPath] = useState(defaults.path);
  const [includes, setIncludes] = useState<Record<string, boolean>>(
    defaults.includes ?? {},
  );
  const [phase, setPhase] = useState<"config" | "saving" | "done">("config");
  const toast = useToast();

  const fullPath = `${path.replace(/\/$/, "")}/${filename}.${format}`;
  const previewText = useMemo(
    () => (preview ? preview(format, includes) : ""),
    [preview, format, includes],
  );
  const sizeBytes = previewText.length || 1024;
  const sizeLabel =
    sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`;

  const submit = async (): Promise<void> => {
    setPhase("saving");
    try {
      await onSave?.({ format, filename, path, fullPath, includes, body: previewText });
      window.setTimeout(() => setPhase("done"), 600);
    } catch {
      setPhase("config");
    }
  };

  const copyPath = (): void => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullPath).catch(() => undefined);
    }
    toast.push({ eyebrow: "Copied", message: "경로를 클립보드에 복사했습니다." });
  };

  if (phase === "saving") {
    return (
      <div className="col gap-14" style={{ padding: "20px 0" }}>
        <div className="row gap-12 f-center">
          <span
            className="dot dot-gold pulse-gold"
            style={{ width: 10, height: 10 }}
          ></span>
          <span className="t-13">
            Writing {filename}.{format}…
          </span>
        </div>
        <div
          style={{
            height: 1,
            background: "var(--border-strong)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--accent)",
              transformOrigin: "left",
              animation: "fade-in 600ms ease-out",
            }}
          />
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="col gap-14">
        <div
          className="card"
          style={{
            padding: 14,
            background: "var(--bg-0)",
            borderLeft: "2px solid var(--success)",
          }}
        >
          <div className="row gap-10 f-center" style={{ marginBottom: 8 }}>
            <span
              style={{
                width: 18,
                height: 18,
                border: "1px solid var(--success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="check" size={10} color="var(--success)" />
            </span>
            <span className="t-13">Saved successfully</span>
          </div>
          <div
            className="t-12 t-mono t-meta"
            style={{ wordBreak: "break-all" }}
          >
            {fullPath}
          </div>
          <div
            className="row gap-12 t-12 t-mono t-meta"
            style={{ marginTop: 8 }}
          >
            <span>{sizeLabel}</span>
            <span>·</span>
            <span>{format.toUpperCase()}</span>
            <span>·</span>
            <span>{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
        <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={copyPath}>
            <Icon name="doc" size={11} /> Copy path
          </button>
          <button className="btn btn-sm btn-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      {/* Format chips */}
      <div className="col gap-6">
        <span className="t-label">Format</span>
        <div className="row gap-1">
          {defaults.formats.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className="btn btn-sm"
              style={{
                marginRight: -1,
                textTransform: "uppercase",
                borderColor: format === f ? "var(--accent)" : undefined,
                color: format === f ? "var(--accent)" : undefined,
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Path picker — informational, browsers can't actually pick a path */}
      <div className="col gap-6">
        <span className="t-label">Save to</span>
        <div className="row gap-0" style={{ alignItems: "stretch" }}>
          <input
            className="input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            style={{ flex: 2, marginRight: -1 }}
          />
          <span
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              background: "var(--bg-0)",
              border: "1px solid var(--border-strong)",
              borderLeftWidth: 0,
              borderRightWidth: 0,
              color: "var(--text-2)",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
            }}
          >
            /
          </span>
          <input
            className="input"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            style={{ flex: 1, marginRight: -1 }}
          />
          <span
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              background: "var(--bg-0)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-2)",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
            }}
          >
            .{format}
          </span>
        </div>
        <div className="row gap-12 f-center" style={{ flexWrap: "wrap" }}>
          {DEFAULT_PATH_PRESETS.map((p) => (
            <button key={p} className="btn btn-sm" onClick={() => setPath(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Section toggles */}
      {defaults.sectionsConfig && defaults.sectionsConfig.length > 0 && (
        <div className="col gap-6">
          <span className="t-label">Include</span>
          <div
            className="card"
            style={{ padding: "6px 12px", background: "var(--bg-0)" }}
          >
            {defaults.sectionsConfig.map((s, i) => (
              <SectionRow
                key={s.id}
                section={s}
                first={i === 0}
                checked={!!includes[s.id]}
                onChange={(v) =>
                  setIncludes((cur) => ({ ...cur, [s.id]: v }))
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      {previewText && (
        <div className="col gap-6">
          <div className="row f-between f-center">
            <span className="t-label">Preview</span>
            <span className="t-mono t-12 t-meta">
              {sizeLabel} · {previewText.split("\n").length} lines
            </span>
          </div>
          <pre
            style={{
              background: "var(--bg-0)",
              border: "1px solid var(--border)",
              padding: "12px 14px",
              maxHeight: 200,
              overflowY: "auto",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--text-1)",
              margin: 0,
              whiteSpace: "pre",
              tabSize: 2,
            }}
          >
            {previewText}
          </pre>
        </div>
      )}

      {/* Resolved path strip */}
      <div
        className="card"
        style={{ padding: "10px 14px", background: "var(--bg-0)" }}
      >
        <div className="row f-between t-12 t-mono">
          <span className="t-meta">Resolves to</span>
          <span
            style={{
              color: "var(--accent)",
              wordBreak: "break-all",
              textAlign: "right",
            }}
          >
            {fullPath}
          </span>
        </div>
      </div>

      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={submit}>
          <Icon name="upload" size={11} color="#0A0A0A" /> Save
        </button>
      </div>
    </div>
  );
}

function SectionRow({
  section,
  first,
  checked,
  onChange,
}: {
  section: ExportSection;
  first: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label
      className="row gap-10 f-center"
      style={{
        padding: "8px 0",
        cursor: section.required ? "default" : "pointer",
        borderTop: first ? "none" : "1px solid var(--border)",
      }}
    >
      <input
        type="checkbox"
        checked={section.required ? true : checked}
        disabled={section.required}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      <div className="col gap-2" style={{ flex: 1 }}>
        <span className="t-13">
          {section.label}
          {section.required && (
            <span className="t-12 t-meta" style={{ marginLeft: 6 }}>
              (필수)
            </span>
          )}
        </span>
        {section.note && (
          <span className="t-12 t-meta">{section.note}</span>
        )}
      </div>
      {section.size && (
        <span className="t-mono t-12 t-meta">{section.size}</span>
      )}
    </label>
  );
}

// Re-export a small ``triggerDownload`` helper so screens can wire the
// modal's onSave to a browser download with one line.
export function triggerDownload(filename: string, body: string, mime: string): void {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case "yaml":
      return "application/x-yaml";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "md":
      return "text/markdown";
  }
}

export type _ExportModalChildren = ReactNode;
