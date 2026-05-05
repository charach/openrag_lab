/**
 * Reusable upload modal — the same drop-zone-plus-queue surface for:
 *   - Library document upload (pdf/txt/md)
 *   - Chunking Lab one-off test document
 *   - Golden set CSV/JSON import
 *
 * The actual upload logic stays with the caller; this component is
 * pure UI plus the file selection state. Upload happens on Confirm —
 * onUpload receives the queued File objects.
 */

import { useRef, useState, type DragEvent } from "react";
import { FormatTag, Icon } from "../ui";

export interface UploadModalProps {
  /** Comma-separated accept list, e.g. ".pdf,.txt,.md". */
  accept?: string;
  /** Hint shown under the drop-zone caption. */
  hint?: string;
  /** Confirm-button label. Defaults to "Upload". */
  confirmLabel?: string;
  /**
   * Show the "auto-index after upload" toggle. Caller reads the second
   * arg in onUpload to decide whether to enqueue indexing.
   */
  autoIndexToggle?: boolean;
  onUpload: (files: File[], autoIndex: boolean) => void | Promise<void>;
  close: () => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function UploadModal({
  accept,
  hint,
  confirmLabel = "Upload",
  autoIndexToggle = true,
  onUpload,
  close,
}: UploadModalProps): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [autoIndex, setAutoIndex] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const merge = (next: File[]): void => {
    setFiles((cur) => {
      const seen = new Set(cur.map((f) => f.name + ":" + f.size));
      const filtered = next.filter((f) => !seen.has(f.name + ":" + f.size));
      return [...cur, ...filtered];
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files) merge(Array.from(e.dataTransfer.files));
  };

  const submit = async (): Promise<void> => {
    if (!files.length) return;
    setBusy(true);
    try {
      await onUpload(files, autoIndex);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col gap-14">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1px dashed ${drag ? "var(--accent)" : "var(--border-strong)"}`,
          padding: "36px 20px",
          textAlign: "center",
          background: drag ? "var(--accent-faint)" : "var(--bg-0)",
          cursor: "pointer",
          transition: "background 120ms",
        }}
      >
        <Icon name="upload" size={20} color="var(--text-2)" />
        <div className="t-14" style={{ marginTop: 10 }}>
          Drop files or click to browse
        </div>
        <div className="t-12 t-meta" style={{ marginTop: 4 }}>
          {hint ?? "PDF · TXT · Markdown · 폴더 단위 가능"}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) merge(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <div className="col gap-1">
          <span className="t-label">Queued · {files.length}</span>
          {files.map((f, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr 80px 60px 24px",
                padding: "8px 4px",
                borderBottom: "1px solid var(--border)",
                alignItems: "center",
              }}
            >
              <Icon name="doc" size={13} color="var(--text-2)" />
              <span className="t-13">{f.name}</span>
              <span className="t-mono t-12 t-meta">{fmtSize(f.size)}</span>
              <FormatTag format={fmtFromName(f.name)} />
              <button
                onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                aria-label={`remove ${f.name}`}
                style={{
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text-2)",
                }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {autoIndexToggle && (
        <label className="row gap-8 f-center t-12 t-dim">
          <input
            type="checkbox"
            checked={autoIndex}
            onChange={(e) => setAutoIndex(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          업로드 후 자동으로 인덱싱 시작
        </label>
      )}
      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!files.length || busy}
          onClick={submit}
        >
          {confirmLabel} {files.length > 0 && `(${files.length})`}
        </button>
      </div>
    </div>
  );
}
