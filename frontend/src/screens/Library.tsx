/**
 * Document Library — search / filter / select / rename / re-index / delete.
 *
 * Re-index is implemented by calling /index with the selected document_ids
 * and force_reindex=true; that already exists in Phase 4.
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type DocumentItem,
  type PresetResponse,
  type WorkspaceConfig,
} from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { FormatTag, Icon, Modal, PageHeader } from "../components/ui";

type PresetEntry = PresetResponse["presets"][number];

export function Library(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<DocumentItem[] | null>(null);
  const [confirmReindex, setConfirmReindex] = useState<DocumentItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig | null>(null);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);

  const refresh = async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const r = await api.listDocuments(workspaceId);
      setDocuments(r.items);
      setSelected((prev) => {
        const valid = new Set(r.items.map((d) => d.id));
        const next = new Set<string>();
        for (const id of prev) if (valid.has(id)) next.add(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!workspaceId) return;
    refresh();
    api
      .getWorkspace(workspaceId)
      .then((r) => setWorkspaceConfig(r.config))
      .catch(() => undefined);
    api
      .systemPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (formatFilter && d.format !== formatFilter) return false;
      if (q && !d.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [documents, query, formatFilter]);

  const formats = useMemo(
    () => Array.from(new Set(documents.map((d) => d.format))).sort(),
    [documents],
  );

  const baseConfig = useMemo(() => {
    if (workspaceConfig?.embedder_id) {
      return {
        embedder_id: workspaceConfig.embedder_id,
        retrieval_strategy: workspaceConfig.retrieval_strategy,
        top_k: workspaceConfig.top_k,
        llm_id: workspaceConfig.llm_id,
        chunking: {
          strategy: workspaceConfig.chunking.strategy ?? "recursive",
          chunk_size: workspaceConfig.chunking.chunk_size ?? 512,
          chunk_overlap: workspaceConfig.chunking.chunk_overlap ?? 64,
        },
      };
    }
    const recommended = presets.find((p) => p.recommended) ?? presets[0];
    if (recommended) {
      return recommended.config;
    }
    return null;
  }, [workspaceConfig, presets]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const toggleAll = (): void => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.id)));
    }
  };

  const submitRename = async (): Promise<void> => {
    if (!workspaceId || !renameTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.renameDocument(workspaceId, renameTarget.id, renameDraft);
      setRenameTarget(null);
      setRenameDraft("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async (): Promise<void> => {
    if (!workspaceId || !confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      for (const d of confirmDelete) {
        await api.deleteDocument(workspaceId, d.id);
      }
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReindex = async (): Promise<void> => {
    if (!workspaceId || !confirmReindex || !baseConfig) return;
    setBusy(true);
    setError(null);
    try {
      await api.startIndex(workspaceId, {
        config: {
          embedder_id: baseConfig.embedder_id!,
          chunking: {
            strategy: baseConfig.chunking.strategy ?? "recursive",
            chunk_size: baseConfig.chunking.chunk_size ?? 512,
            chunk_overlap: baseConfig.chunking.chunk_overlap ?? 64,
          },
          retrieval_strategy: baseConfig.retrieval_strategy,
          top_k: baseConfig.top_k,
          llm_id: baseConfig.llm_id,
        },
        document_ids: confirmReindex.map((d) => d.id),
        force_reindex: true,
      });
      setConfirmReindex(null);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (files: File[]): Promise<void> => {
    if (!workspaceId || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocuments(workspaceId, files);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  if (!workspaceId)
    return (
      <section className="page">
        <p className="t-meta">워크스페이스를 먼저 선택하세요.</p>
      </section>
    );

  const selectedDocs = documents.filter((d) => selected.has(d.id));

  return (
    <section className="page">
      <PageHeader
        eyebrow="Library"
        title="The corpus, every document accountable."
        sub="문서를 검색·정리·재인덱스하세요. 일괄 선택 후 한 번에 처리할 수 있습니다."
      />

      <div className="col gap-16" style={{ marginTop: 32 }}>
        <DropZone
          drag={drag}
          setDrag={setDrag}
          uploading={uploading}
          onFiles={handleUpload}
        />

        <div className="row gap-12 f-center" style={{ flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <input
              className="input"
              placeholder="Search by filename"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <Icon name="search" size={12} color="var(--text-2)" />
            </span>
          </div>
          <div className="row gap-6">
            <button
              className="btn btn-sm"
              onClick={() => setFormatFilter(null)}
              style={{
                borderColor: formatFilter === null ? "var(--accent)" : undefined,
                color: formatFilter === null ? "var(--accent)" : "var(--text-1)",
              }}
            >
              all
            </button>
            {formats.map((f) => (
              <button
                key={f}
                className="btn btn-sm"
                onClick={() => setFormatFilter(f)}
                style={{
                  borderColor: formatFilter === f ? "var(--accent)" : undefined,
                  color: formatFilter === f ? "var(--accent)" : "var(--text-1)",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div
            className="card row f-center"
            style={{ padding: "10px 16px", gap: 12 }}
          >
            <span className="t-13">{selected.size} selected</span>
            <div style={{ flex: 1 }}></div>
            <button
              className="btn btn-sm"
              disabled={!baseConfig}
              onClick={() => setConfirmReindex(selectedDocs)}
            >
              <Icon name="play" size={11} /> Re-index
            </button>
            <button
              className="btn btn-sm"
              onClick={() => setConfirmDelete(selectedDocs)}
              style={{ color: "var(--error)", borderColor: "var(--error)" }}
            >
              <Icon name="trash" size={11} /> Delete
            </button>
          </div>
        )}

        {error && (
          <div
            className="card"
            style={{
              padding: "10px 14px",
              borderColor: "var(--error)",
              color: "var(--error)",
            }}
          >
            <span className="t-12 t-mono">{error}</span>
          </div>
        )}

        <div className="card">
          <div
            className="row f-center"
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
              gap: 12,
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              aria-label="select all"
            />
            <span className="t-label" style={{ flex: 1 }}>
              Filename
            </span>
            <span className="t-label" style={{ width: 80 }}>
              Format
            </span>
            <span className="t-label" style={{ width: 100, textAlign: "right" }}>
              Size
            </span>
            <span className="t-label" style={{ width: 110 }}>
              Status
            </span>
            <span style={{ width: 80 }}></span>
          </div>
          {filtered.length === 0 ? (
            <div className="row f-center" style={{ padding: 32 }}>
              <span className="t-meta t-13">
                {documents.length === 0 ? "No documents yet — drop files above." : "No matches."}
              </span>
            </div>
          ) : (
            filtered.map((d) => (
              <div
                key={d.id}
                className="row f-center"
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--border)",
                  gap: 12,
                  background: selected.has(d.id) ? "var(--bg-2)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => toggle(d.id)}
                  aria-label={`select ${d.filename}`}
                />
                <span className="t-13" style={{ flex: 1, color: "var(--text-0)" }}>
                  {d.filename}
                </span>
                <span style={{ width: 80 }}>
                  <FormatTag format={d.format} />
                </span>
                <span
                  className="t-12 t-mono t-meta"
                  style={{ width: 100, textAlign: "right" }}
                >
                  {formatBytes(d.size_bytes)}
                </span>
                <span style={{ width: 110 }}>
                  <StatusChip status={d.indexing_status} />
                </span>
                <div className="row gap-4" style={{ width: 80, justifyContent: "flex-end" }}>
                  <button
                    aria-label={`rename ${d.filename}`}
                    className="btn-ghost"
                    onClick={() => {
                      setRenameTarget(d);
                      setRenameDraft(d.filename);
                    }}
                    style={{
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <Icon name="settings" size={12} color="var(--text-2)" />
                  </button>
                  <button
                    aria-label={`delete ${d.filename}`}
                    className="btn-ghost"
                    onClick={() => setConfirmDelete([d])}
                    style={{
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <Icon name="trash" size={12} color="var(--text-2)" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {renameTarget && (
        <Modal
          title="Rename document"
          onClose={() => {
            if (!busy) setRenameTarget(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setRenameTarget(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitRename}
                disabled={
                  busy ||
                  renameDraft.trim().length === 0 ||
                  renameDraft === renameTarget.filename
                }
              >
                Save
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            Filename
          </label>
          <input
            className="input"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title={`Delete ${confirmDelete.length === 1 ? "document" : `${confirmDelete.length} documents`}`}
          onClose={() => {
            if (!busy) setConfirmDelete(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setConfirmDelete(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={submitDelete}
                disabled={busy}
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="t-14">
            {confirmDelete.length === 1 && confirmDelete[0]
              ? `Delete ${confirmDelete[0].filename}? This removes the file and any chunks.`
              : `Delete ${confirmDelete.length} documents? This removes the files and their chunks.`}
          </p>
        </Modal>
      )}

      {confirmReindex && (
        <Modal
          title="Re-index"
          onClose={() => {
            if (!busy) setConfirmReindex(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setConfirmReindex(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitReindex}
                disabled={busy || !baseConfig}
              >
                {busy ? "Starting…" : "Re-index"}
              </button>
            </>
          }
        >
          <p className="t-14">
            Re-index {confirmReindex.length}{" "}
            {confirmReindex.length === 1 ? "document" : "documents"} with the current
            workspace config? Existing chunks for these documents will be replaced.
          </p>
        </Modal>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: string }): JSX.Element {
  const isIndexed = status === "indexed";
  return (
    <span
      className="chip"
      style={{
        color: isIndexed ? "var(--success)" : "var(--text-2)",
        borderColor: isIndexed ? "var(--success)" : "var(--border)",
      }}
    >
      <span
        className="dot"
        style={{ background: isIndexed ? "var(--success)" : "var(--text-2)" }}
      ></span>
      {status}
    </span>
  );
}

function DropZone({
  drag,
  setDrag,
  uploading,
  onFiles,
}: {
  drag: boolean;
  setDrag: (v: boolean) => void;
  uploading: boolean;
  onFiles: (files: File[]) => void;
}): JSX.Element {
  const onDragOver = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setDrag(true);
  };
  const onDragLeave = (): void => setDrag(false);
  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setDrag(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) onFiles(dropped);
  };
  return (
    <label
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: "block",
        border: `1px dashed ${drag ? "var(--accent)" : "var(--border-strong)"}`,
        background: drag ? "var(--accent-faint)" : "var(--bg-1)",
        padding: 20,
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      <input
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files));
          e.currentTarget.value = "";
        }}
      />
      <div className="row f-center" style={{ justifyContent: "center", gap: 8 }}>
        <Icon name="upload" size={14} color="var(--text-1)" />
        <span className="t-13 t-dim">
          {uploading ? "Uploading…" : "Drop files here, or click to browse"}
        </span>
      </div>
    </label>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
