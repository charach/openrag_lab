/**
 * Document Library — search / filter / select / rename / re-index / delete.
 *
 * Re-index is implemented by calling /index with the selected document_ids
 * and force_reindex=true; that already exists in Phase 4.
 *
 * The 5-stat header up top mirrors the design — Documents / Indexed / In
 * progress / Queued / Total chunks. They're derived from
 * ``DocumentItem.indexing_status`` + ``chunk_count`` so the same list
 * fetch powers both header and table.
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type DocumentItem,
  type PresetResponse,
  type WorkspaceConfig,
} from "../api/client";
import {
  ExportModal,
  mimeFor,
  triggerDownload,
  type ExportFormat,
} from "../components/modals/ExportModal";
import { confirmModal, useModal } from "../components/providers/ModalProvider";
import { useToast } from "../components/providers/ToastProvider";
import { useWorkspaceStore } from "../stores/workspace";
import { FormatTag, Icon, Modal, PageHeader } from "../components/ui";

type PresetEntry = PresetResponse["presets"][number];

export function Library(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();
  const modal = useModal();
  const toast = useToast();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
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

  const stats = useMemo(() => {
    let indexed = 0;
    let inProgress = 0;
    let queued = 0;
    let totalChunks = 0;
    for (const d of documents) {
      totalChunks += d.chunk_count ?? 0;
      switch (d.indexing_status) {
        case "indexed":
          indexed++;
          break;
        case "embedding":
        case "chunking":
        case "parsing":
          inProgress++;
          break;
        case "queued":
        case "not_indexed":
          queued++;
          break;
      }
    }
    return {
      documents: documents.length,
      indexed,
      inProgress,
      queued,
      totalChunks,
    };
  }, [documents]);

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
      toast.push({ eyebrow: "Renamed", message: `${renameDraft} saved.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const askDelete = (targets: DocumentItem[]): void => {
    confirmModal(modal, {
      title:
        targets.length === 1 && targets[0]
          ? `Delete "${targets[0].filename}"?`
          : `Delete ${targets.length} documents?`,
      message:
        "이 작업은 되돌릴 수 없습니다. 인덱스에서 영구 삭제되며 관련된 청크와 임베딩도 함께 삭제됩니다.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        if (!workspaceId) return;
        try {
          for (const d of targets) {
            await api.deleteDocument(workspaceId, d.id);
          }
          await refresh();
          toast.push({
            eyebrow: "Deleted",
            message: `${targets.length} document${targets.length > 1 ? "s" : ""} removed.`,
            kind: "error",
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const askReindex = (targets: DocumentItem[]): void => {
    if (!baseConfig) {
      toast.push({
        eyebrow: "Cannot re-index",
        message: "No workspace config or preset available to drive the re-index.",
        kind: "error",
      });
      return;
    }
    confirmModal(modal, {
      title: `Re-index ${targets.length} document${targets.length > 1 ? "s" : ""}?`,
      message:
        "선택한 문서를 다시 청킹·임베딩합니다. 기존 청크는 새 결과로 덮어쓰여집니다.",
      confirmLabel: "Re-index",
      onConfirm: async () => {
        if (!workspaceId) return;
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
            document_ids: targets.map((d) => d.id),
            force_reindex: true,
          });
          toast.push({
            eyebrow: "Started",
            message: `Re-indexing ${targets.length} files.`,
          });
          navigate("/");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const openExport = (): void => {
    modal.open({
      title: "Export document list",
      eyebrow: `Library · ${documents.length} documents`,
      width: 600,
      render: ({ close }) => (
        <ExportModal
          defaults={{
            format: "csv",
            filename: `library-${workspaceId}`,
            path: `~/openrag-lab/exports/${workspaceId}`,
            formats: ["csv", "json", "yaml"],
            sectionsConfig: [
              {
                id: "meta",
                label: "File metadata",
                note: "name, size, format",
                size: "—",
                required: true,
              },
              {
                id: "status",
                label: "Indexing status",
                note: "indexing_status, chunk_count",
                size: "—",
              },
              {
                id: "checksums",
                label: "Content hashes",
                note: "SHA-256 per file",
                size: "—",
              },
            ],
            includes: { meta: true, status: true, checksums: false },
          }}
          preview={(fmt, inc) => buildPreview(documents, fmt, inc, workspaceId ?? "")}
          onSave={({ format, filename, body }) => {
            triggerDownload(`${filename}.${format}`, body, mimeFor(format));
            toast.push({
              eyebrow: "Exported",
              message: `${filename}.${format} downloaded.`,
            });
          }}
          close={close}
        />
      ),
    });
  };

  const handleUpload = async (files: File[]): Promise<void> => {
    if (!workspaceId || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocuments(workspaceId, files);
      await refresh();
      toast.push({
        eyebrow: "Queued",
        message: `${files.length} file${files.length > 1 ? "s" : ""} added.`,
      });
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
      <div className="row f-between" style={{ alignItems: "flex-start", gap: 24 }}>
        <PageHeader
          eyebrow="Library"
          title="The corpus, every document accountable."
          sub="문서를 검색·정리·재인덱스하세요. 일괄 선택 후 한 번에 처리할 수 있습니다."
        />
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={openExport} disabled={!documents.length}>
            <Icon name="yaml" size={11} /> Export list
          </button>
        </div>
      </div>

      <div className="col gap-16" style={{ marginTop: 32 }}>
        {/* 5-stat strip */}
        <StatStrip stats={stats} />

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
              placeholder="Filter by filename…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
            <span
              style={{
                position: "absolute",
                left: 11,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <Icon name="search" size={12} color="var(--text-2)" />
            </span>
          </div>
          <div className="row gap-1">
            <FilterBtn
              label="All"
              active={formatFilter === null}
              onClick={() => setFormatFilter(null)}
            />
            {formats.map((f) => (
              <FilterBtn
                key={f}
                label={f.toUpperCase()}
                active={formatFilter === f}
                onClick={() => setFormatFilter(f)}
              />
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div
            className="card row f-center fade-in"
            style={{
              padding: "10px 16px",
              gap: 12,
              borderLeft: "2px solid var(--accent)",
            }}
          >
            <span className="t-13">
              <span className="t-mono" style={{ color: "var(--accent)" }}>
                {selected.size}
              </span>{" "}
              selected
            </span>
            <div style={{ flex: 1 }}></div>
            <button
              className="btn btn-sm"
              disabled={!baseConfig}
              onClick={() => askReindex(selectedDocs)}
            >
              <Icon name="play" size={11} /> Re-index
            </button>
            <button
              className="btn btn-sm"
              onClick={() => askDelete(selectedDocs)}
              style={{ color: "var(--error)", borderColor: "var(--error)" }}
            >
              <Icon name="trash" size={11} /> Delete
            </button>
            <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
              Clear
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
              style={{ accentColor: "var(--accent)" }}
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
            <span className="t-label" style={{ width: 80, textAlign: "right" }}>
              Chunks
            </span>
            <span className="t-label" style={{ width: 130 }}>
              Status
            </span>
            <span style={{ width: 80 }}></span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              hasDocs={documents.length > 0}
              onClear={() => {
                setQuery("");
                setFormatFilter(null);
              }}
            />
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
                  style={{ accentColor: "var(--accent)" }}
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
                <span
                  className="t-mono t-13"
                  style={{
                    width: 80,
                    textAlign: "right",
                    color: (d.chunk_count ?? 0) > 0 ? "var(--text-1)" : "var(--text-2)",
                  }}
                >
                  {(d.chunk_count ?? 0) > 0 ? d.chunk_count!.toLocaleString() : "—"}
                </span>
                <span style={{ width: 130 }}>
                  <StatusChip status={d.indexing_status} />
                </span>
                <div className="row gap-4" style={{ width: 80, justifyContent: "flex-end" }}>
                  <button
                    aria-label={`re-index ${d.filename}`}
                    title="Re-index"
                    onClick={() => askReindex([d])}
                    disabled={!baseConfig}
                    className="btn-ghost"
                    style={{
                      border: 0,
                      background: "transparent",
                      cursor: baseConfig ? "pointer" : "not-allowed",
                      padding: 4,
                      opacity: baseConfig ? 1 : 0.4,
                    }}
                  >
                    <Icon name="play" size={11} color="var(--text-2)" />
                  </button>
                  <button
                    aria-label={`rename ${d.filename}`}
                    title="Rename"
                    onClick={() => {
                      setRenameTarget(d);
                      setRenameDraft(d.filename);
                    }}
                    className="btn-ghost"
                    style={{
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <Icon name="settings" size={11} color="var(--text-2)" />
                  </button>
                  <button
                    aria-label={`delete ${d.filename}`}
                    title="Delete"
                    onClick={() => askDelete([d])}
                    className="btn-ghost"
                    style={{
                      border: 0,
                      background: "transparent",
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    <Icon name="trash" size={11} color="var(--text-2)" />
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
          onConfirm={() => {
            if (
              !busy &&
              renameDraft.trim().length > 0 &&
              renameDraft !== renameTarget.filename
            ) {
              void submitRename();
            }
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
          />
        </Modal>
      )}
    </section>
  );
}

function StatStrip({
  stats,
}: {
  stats: { documents: number; indexed: number; inProgress: number; queued: number; totalChunks: number };
}): JSX.Element {
  return (
    <div
      className="card"
      style={{
        padding: "14px 20px",
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
      }}
    >
      <Stat label="Documents" value={stats.documents} accent />
      <Stat label="Indexed" value={stats.indexed} />
      <Stat label="In progress" value={stats.inProgress} />
      <Stat label="Queued" value={stats.queued} />
      <Stat label="Total chunks" value={stats.totalChunks.toLocaleString()} mono />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="col gap-4">
      <span className="t-label" style={{ fontSize: 9 }}>
        {label}
      </span>
      <span
        className={mono ? "t-mono" : ""}
        style={{
          fontSize: 22,
          fontWeight: 300,
          letterSpacing: "0.01em",
          color: accent ? "var(--accent)" : "var(--text-0)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FilterBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      className="btn btn-sm"
      onClick={onClick}
      style={{
        marginRight: -1,
        borderColor: active ? "var(--accent)" : undefined,
        color: active ? "var(--accent)" : "var(--text-1)",
      }}
    >
      {label}
    </button>
  );
}

function EmptyState({
  hasDocs,
  onClear,
}: {
  hasDocs: boolean;
  onClear: () => void;
}): JSX.Element {
  return (
    <div className="row f-center" style={{ padding: "60px 20px", justifyContent: "center" }}>
      <div className="col gap-12 f-center">
        <span className="t-13 t-meta">
          {hasDocs ? "No documents match your filter." : "No documents yet — drop files above."}
        </span>
        {hasDocs && (
          <button className="btn btn-sm" onClick={onClear}>
            Clear filter
          </button>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }): JSX.Element {
  const palette: Record<string, { fg: string; dot: string }> = {
    indexed: { fg: "var(--success)", dot: "var(--success)" },
    embedding: { fg: "var(--accent)", dot: "var(--accent)" },
    chunking: { fg: "var(--text-1)", dot: "var(--text-1)" },
    queued: { fg: "var(--text-2)", dot: "var(--text-2)" },
    not_indexed: { fg: "var(--text-2)", dot: "var(--text-2)" },
    failed: { fg: "var(--error)", dot: "var(--error)" },
  };
  const p = palette[status] ?? palette["not_indexed"]!;
  return (
    <span
      className="chip"
      style={{ color: p.fg, borderColor: p.fg === "var(--text-2)" ? "var(--border)" : p.fg }}
    >
      <span className="dot" style={{ background: p.dot }}></span>
      {status === "not_indexed" ? "queued" : status}
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

function buildPreview(
  docs: DocumentItem[],
  fmt: ExportFormat,
  inc: Record<string, boolean>,
  workspaceId: string,
): string {
  const sample = docs.slice(0, 6);
  if (fmt === "csv") {
    const cols = ["id", "filename", "format"];
    if (inc.meta !== false) cols.push("size_bytes");
    if (inc.status) cols.push("status", "chunks");
    if (inc.checksums) cols.push("content_hash");
    const header = cols.join(",");
    const rows = sample.map((d) => {
      const r: Array<string | number> = [d.id, JSON.stringify(d.filename), d.format];
      if (inc.meta !== false) r.push(d.size_bytes);
      if (inc.status) r.push(d.indexing_status, d.chunk_count ?? 0);
      if (inc.checksums) r.push(d.content_hash);
      return r.join(",");
    });
    if (docs.length > sample.length) rows.push(`# … ${docs.length - sample.length} more rows`);
    return [header, ...rows].join("\n");
  }
  if (fmt === "json") {
    return JSON.stringify(
      {
        workspace: workspaceId,
        exported_at: new Date().toISOString(),
        documents: sample.map((d) => ({
          id: d.id,
          filename: d.filename,
          format: d.format,
          ...(inc.meta !== false ? { size_bytes: d.size_bytes } : {}),
          ...(inc.status
            ? { status: d.indexing_status, chunks: d.chunk_count ?? 0 }
            : {}),
          ...(inc.checksums ? { content_hash: d.content_hash } : {}),
        })),
      },
      null,
      2,
    );
  }
  // yaml
  const lines = [
    `# OpenRAG-Lab document list`,
    `workspace: ${workspaceId}`,
    `total: ${docs.length}`,
    `documents:`,
  ];
  for (const d of sample) {
    lines.push(`  - id: ${d.id}`);
    lines.push(`    filename: "${d.filename}"`);
    lines.push(`    format: ${d.format}`);
    if (inc.meta !== false) lines.push(`    size_bytes: ${d.size_bytes}`);
    if (inc.status) {
      lines.push(`    status: ${d.indexing_status}`);
      lines.push(`    chunks: ${d.chunk_count ?? 0}`);
    }
    if (inc.checksums) lines.push(`    content_hash: "${d.content_hash}"`);
  }
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
