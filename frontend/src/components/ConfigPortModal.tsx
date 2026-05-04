/**
 * Config export / import modal.
 *
 * Export: download the workspace config as YAML or JSON via a normal anchor.
 * Import: paste or upload a YAML/JSON file; POST to /config/import.
 *
 * Save-to path picking is delegated to the browser's download mechanism;
 * a desktop shell can replace this in a later phase.
 */

import { useEffect, useState } from "react";
import { Modal } from "./ui";

interface Props {
  workspaceId: string;
  onClose: () => void;
  onImported?: () => void;
}

type Mode = "export" | "import";
type Format = "yaml" | "json";

export function ConfigPortModal({ workspaceId, onClose, onImported }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>("export");
  const [format, setFormat] = useState<Format>("yaml");
  const [preview, setPreview] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importBody, setImportBody] = useState<string>("");
  const [importStatus, setImportStatus] = useState<
    | null
    | { kind: "ok"; message: string }
    | { kind: "err"; message: string }
  >(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (mode !== "export") return;
    setPreviewLoading(true);
    setPreviewError(null);
    fetch(`/api/workspaces/${workspaceId}/config/export?format=${format}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          let friendly: string | null = null;
          try {
            const parsed = JSON.parse(body);
            friendly = parsed?.error?.message ?? parsed?.detail ?? null;
          } catch {
            /* not json */
          }
          throw new Error(friendly ?? `HTTP ${r.status}`);
        }
        return r.text();
      })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPreviewLoading(false));
  }, [mode, format, workspaceId]);

  const exportUrl = `/api/workspaces/${workspaceId}/config/export?format=${format}`;

  const submitImport = async (): Promise<void> => {
    setImporting(true);
    setImportStatus(null);
    try {
      const isJson = importBody.trim().startsWith("{");
      const resp = await fetch(`/api/workspaces/${workspaceId}/config/import`, {
        method: "POST",
        headers: {
          "content-type": isJson ? "application/json" : "application/yaml",
        },
        body: importBody,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        const msg = err?.error?.message ?? `HTTP ${resp.status}`;
        setImportStatus({ kind: "err", message: msg });
        return;
      }
      const body = await resp.json();
      const note = body.requires_reindex
        ? " (재인덱스 필요)"
        : body.config_changed
          ? " (변경 적용됨)"
          : " (변경 없음)";
      setImportStatus({ kind: "ok", message: `Applied${note}` });
      onImported?.();
    } catch (e) {
      setImportStatus({
        kind: "err",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setImporting(false);
    }
  };

  const onPickFile = (file: File): void => {
    file.text().then(setImportBody);
  };

  return (
    <Modal title="Config" onClose={onClose} width={640}>
      <div className="row gap-8" style={{ marginBottom: 16 }}>
        {(["export", "import"] as const).map((m) => (
          <button
            key={m}
            className="btn btn-sm"
            onClick={() => setMode(m)}
            style={{
              borderColor: mode === m ? "var(--accent)" : undefined,
              color: mode === m ? "var(--accent)" : "var(--text-1)",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "export" ? (
        <>
          <div className="row gap-8 f-center" style={{ marginBottom: 12 }}>
            <span className="t-label">Format</span>
            {(["yaml", "json"] as const).map((f) => (
              <button
                key={f}
                className="btn btn-sm"
                onClick={() => setFormat(f)}
                style={{
                  borderColor: format === f ? "var(--accent)" : undefined,
                  color: format === f ? "var(--accent)" : "var(--text-1)",
                }}
              >
                {f}
              </button>
            ))}
            <div style={{ flex: 1 }}></div>
            <a
              className="btn btn-primary btn-sm"
              href={exportUrl}
              download={`workspace-config.${format}`}
            >
              Download
            </a>
          </div>
          <span className="t-label" style={{ display: "block", marginBottom: 6 }}>
            Preview
          </span>
          {previewLoading ? (
            <p className="t-meta t-13">Loading…</p>
          ) : previewError ? (
            <p style={{ color: "var(--error)" }} className="t-12">
              {previewError}
            </p>
          ) : (
            <pre
              className="t-mono t-12"
              style={{
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                padding: 12,
                margin: 0,
                whiteSpace: "pre-wrap",
                maxHeight: 360,
                overflow: "auto",
              }}
            >
              {preview}
            </pre>
          )}
        </>
      ) : (
        <>
          <div className="row gap-8 f-center" style={{ marginBottom: 12 }}>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              <input
                type="file"
                accept=".yaml,.yml,.json,application/yaml,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                  e.currentTarget.value = "";
                }}
              />
              Pick file…
            </label>
            <div style={{ flex: 1 }}></div>
            <button
              className="btn btn-primary btn-sm"
              onClick={submitImport}
              disabled={importing || importBody.trim().length === 0}
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
          <textarea
            className="input t-mono"
            rows={14}
            placeholder="Paste YAML or JSON here, or pick a file."
            value={importBody}
            onChange={(e) => setImportBody(e.target.value)}
          />
          {importStatus && (
            <p
              className="t-12"
              style={{
                color:
                  importStatus.kind === "ok" ? "var(--success)" : "var(--error)",
                marginTop: 8,
              }}
            >
              {importStatus.message}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
