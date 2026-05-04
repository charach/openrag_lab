/**
 * Auto-Pilot wizard — preset → workspace+files → indexing.
 *
 * The flow stays linear: a non-expert picks one of the recommended presets,
 * names a workspace, drops files, then watches indexing progress over WS.
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type IndexAcceptedResponse,
  type PresetResponse,
  type SystemProfileResponse,
  type WorkspaceSummary,
} from "../api/client";
import { useWebSocket, type WSMessage } from "../hooks/useWebSocket";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, Modal, PageHeader, Step } from "../components/ui";

type PresetEntry = PresetResponse["presets"][number];
type WorkspaceMode = "existing" | "new";

export function AutoPilotWizard(): JSX.Element {
  const [profile, setProfile] = useState<SystemProfileResponse | null>(null);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("existing");
  const [workspaceName, setWorkspaceName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [task, setTask] = useState<IndexAcceptedResponse | null>(null);
  const [progress, setProgress] = useState<WSMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const navigate = useNavigate();

  useEffect(() => {
    api.systemProfile().then(setProfile).catch((e) => setError(String(e)));
    api.systemPresets().then((r) => {
      setPresets(r.presets);
      const recommended = r.presets.find((p) => p.recommended);
      if (recommended) setChosen(recommended.id);
    });
    api
      .listWorkspaces()
      .then((r) => {
        setWorkspaces(r.items);
        if (r.items.length === 0) setWorkspaceMode("new");
      })
      .catch(() => undefined);
  }, []);

  const topics = useMemo(() => (task ? [task.websocket_topic] : []), [task]);
  useWebSocket({ topics, enabled: task !== null, onMessage: setProgress });

  const ratio = typeof progress?.ratio === "number" ? progress.ratio : null;
  const stage = typeof progress?.type === "string" ? progress.type : null;
  const indexing = task !== null;
  const stepStatus = (n: 1 | 2 | 3): "todo" | "active" | "done" => {
    if (n === 1) return chosen ? "done" : "active";
    if (n === 2) return indexing ? "done" : chosen ? "active" : "todo";
    return indexing ? "active" : "todo";
  };

  const cancelIndex = async (): Promise<void> => {
    if (!task) return;
    setCancelling(true);
    setError(null);
    try {
      await api.cancelTask(task.task_id);
      setCancelled(true);
      setConfirmCancel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  };

  const launch = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    const preset = presets.find((p) => p.id === chosen);
    if (!preset) {
      setError("preset not chosen");
      setSubmitting(false);
      return;
    }
    try {
      let workspaceId: string;
      if (workspaceMode === "existing") {
        if (!activeWorkspaceId) {
          setError("선택된 워크스페이스가 없습니다. 헤더에서 선택하거나 새로 만드세요.");
          setSubmitting(false);
          return;
        }
        workspaceId = activeWorkspaceId;
      } else {
        const trimmed = workspaceName.trim();
        if (trimmed.length === 0) {
          setError("워크스페이스 이름을 입력하세요.");
          setSubmitting(false);
          return;
        }
        const ws = await api.createWorkspace(trimmed, preset.id);
        setActiveWorkspace(ws.id);
        workspaceId = ws.id;
      }
      if (files.length > 0) await api.uploadDocuments(workspaceId, files);
      const accepted = await api.startIndex(workspaceId, {
        config: {
          embedder_id: preset.config.embedder_id,
          chunking: preset.config.chunking,
          retrieval_strategy: preset.config.retrieval_strategy,
          top_k: preset.config.top_k,
          llm_id: preset.config.llm_id,
        },
      });
      setTask(accepted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page">
      <PageHeader
        eyebrow="Auto-Pilot"
        title="Drag your folder, click once, chat in five minutes."
        sub="시스템이 하드웨어를 보고 임베더·청킹·LLM을 자동으로 결정합니다. 비전문가도 설정 없이 채팅까지 도달할 수 있습니다."
      />

      <div className="col gap-16" style={{ marginTop: 32 }}>
        {profile && <DiagnosticStrip profile={profile} />}

        {error && (
          <div
            className="card"
            style={{ padding: "12px 16px", borderColor: "var(--error)", color: "var(--error)" }}
          >
            <span className="t-12 t-mono">{error}</span>
          </div>
        )}

        <Step number="01" title="Preset" status={stepStatus(1)} subtitle="Recommended for this hardware">
          {presets.length === 0 ? (
            <p className="t-meta t-13">Detecting hardware…</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  selected={chosen === p.id}
                  onSelect={() => setChosen(p.id)}
                />
              ))}
            </div>
          )}
        </Step>

        <Step
          number="02"
          title="Workspace + Documents"
          status={stepStatus(2)}
          subtitle={
            files.length > 0 ? `${files.length} files · ${formatTotalSize(files)}` : undefined
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
            <div className="col gap-12">
              <div className="col gap-6">
                <span className="t-label">Workspace</span>
                <div className="row gap-6">
                  <button
                    type="button"
                    className={`btn btn-sm${workspaceMode === "existing" ? " btn-primary" : ""}`}
                    onClick={() => setWorkspaceMode("existing")}
                    disabled={workspaces.length === 0}
                    title={
                      workspaces.length === 0 ? "기존 워크스페이스가 없습니다" : undefined
                    }
                  >
                    기존 사용
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm${workspaceMode === "new" ? " btn-primary" : ""}`}
                    onClick={() => setWorkspaceMode("new")}
                  >
                    새로 만들기
                  </button>
                </div>
                {workspaceMode === "existing" ? (
                  <span className="t-12 t-mono" style={{ color: "var(--text-1)" }}>
                    {workspaces.find((w) => w.id === activeWorkspaceId)?.name ??
                      (workspaces[0]?.name ?? "—")}
                  </span>
                ) : (
                  <input
                    className="input"
                    placeholder="새 워크스페이스 이름"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                  />
                )}
              </div>
              {chosen && (
                <div className="col gap-6">
                  <span className="t-label">Backend</span>
                  <span className="t-13 t-mono" style={{ color: "var(--text-1)" }}>
                    {presetBackendLine(presets.find((p) => p.id === chosen))}
                  </span>
                </div>
              )}
            </div>

            <div className="col gap-12">
              <DropZone files={files} setFiles={setFiles} />
              {files.length > 0 && <FileList files={files} setFiles={setFiles} />}
            </div>
          </div>

          <div className="row gap-12 f-center" style={{ marginTop: 20 }}>
            <span className="t-12 t-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="lock" size={11} /> Resumable — 단계별 체크포인트가 보존됩니다.
            </span>
            <div style={{ flex: 1 }}></div>
            <button
              className="btn btn-primary"
              onClick={launch}
              disabled={
                submitting ||
                indexing ||
                !chosen ||
                (workspaceMode === "new" && workspaceName.trim().length === 0) ||
                (workspaceMode === "existing" && !activeWorkspaceId && workspaces.length === 0)
              }
            >
              {submitting ? "Starting…" : indexing ? "Indexing…" : "Start indexing"}
            </button>
          </div>
        </Step>

        {confirmCancel && (
          <Modal
            title="Cancel indexing"
            onClose={() => {
              if (!cancelling) setConfirmCancel(false);
            }}
            footer={
              <>
                <button
                  className="btn"
                  onClick={() => setConfirmCancel(false)}
                  disabled={cancelling}
                >
                  Keep running
                </button>
                <button
                  className="btn"
                  onClick={cancelIndex}
                  disabled={cancelling}
                  style={{ borderColor: "var(--error)", color: "var(--error)" }}
                >
                  {cancelling ? "Cancelling…" : "Cancel indexing"}
                </button>
              </>
            }
          >
            <p className="t-14">
              현재 작업을 중단합니다. 체크포인트가 보존되어 같은 설정으로 다시
              인덱싱하면 이어서 진행됩니다.
            </p>
          </Modal>
        )}

        {indexing && task && (
          <Step
            number="03"
            title="Indexing"
            status="active"
            subtitle={ratio !== null ? `${(ratio * 100).toFixed(1)}% · ${stage ?? "running"}` : "running"}
          >
            <div className="col gap-16">
              <div className="col gap-8">
                <div className="row f-between f-center">
                  <div className="row gap-8 f-center">
                    <span className="dot dot-gold pulse-gold"></span>
                    <span className="t-13">{stage ?? "queued"}</span>
                  </div>
                  <span className="t-mono t-12" style={{ color: "var(--accent)" }}>
                    {ratio !== null ? `${(ratio * 100).toFixed(1)}%` : "…"}
                  </span>
                </div>
                <div style={{ height: 2, background: "var(--bg-3)", position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${(ratio ?? 0) * 100}%`,
                      background: "var(--accent)",
                      transition: "width 220ms linear",
                    }}
                  ></div>
                </div>
              </div>

              <div className="row gap-12 f-center" style={{ marginTop: 4 }}>
                <span className="t-12 t-meta t-mono">task_id {task.task_id}</span>
                <span className="t-12 t-meta t-mono">exp {task.experiment_id}</span>
                {cancelled && (
                  <span className="chip" style={{ color: "var(--error)" }}>
                    cancelled
                  </span>
                )}
                <div style={{ flex: 1 }}></div>
                <button
                  className="btn btn-sm"
                  onClick={() => setConfirmCancel(true)}
                  disabled={cancelled || (ratio !== null && ratio >= 0.999)}
                  style={{ borderColor: "var(--border-strong)", color: "var(--text-1)" }}
                >
                  <Icon name="x" size={12} /> Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={ratio === null || ratio < 0.999}
                  onClick={() => navigate("/chat")}
                >
                  <Icon name="right" size={12} color="#0A0A0A" /> Go to Chat
                </button>
              </div>
            </div>
          </Step>
        )}
      </div>
    </section>
  );
}

function DiagnosticStrip({ profile }: { profile: SystemProfileResponse }): JSX.Element {
  const platform = profile.os.platform === "darwin" ? "macOS" : profile.os.platform;
  const items: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: "OS", value: `${platform} ${profile.os.version}` },
    { label: "CPU", value: profile.cpu.model },
    {
      label: "RAM",
      value: `${profile.ram.available_gb ?? "?"} / ${profile.ram.total_gb} GB`,
    },
    { label: "GPU", value: profile.gpu.name ?? "—" },
    { label: "Backend", value: profile.gpu.acceleration_backend, accent: true },
  ];
  return (
    <div className="card" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 28 }}>
      <span className="t-label">System</span>
      {items.map((it) => (
        <div key={it.label} className="col gap-4">
          <span className="t-label" style={{ fontSize: 9 }}>
            {it.label}
          </span>
          <span
            className="t-12 t-mono"
            style={{ color: it.accent ? "var(--accent)" : "var(--text-0)" }}
          >
            {it.value}
          </span>
        </div>
      ))}
      <div style={{ flex: 1 }}></div>
      <span className="chip">
        <span className="dot dot-success"></span>Hardware ready
      </span>
    </div>
  );
}

function PresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: PresetEntry;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      disabled={!preset.available}
      style={{
        textAlign: "left",
        padding: 18,
        background: selected ? "var(--bg-2)" : "var(--bg-0)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
        cursor: preset.available ? "pointer" : "not-allowed",
        opacity: preset.available ? 1 : 0.45,
        fontFamily: "inherit",
        color: "var(--text-0)",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 180,
      }}
    >
      <div className="row f-between f-center">
        <span className="t-label">{preset.id}</span>
        {preset.recommended && (
          <span className="chip chip-gold" style={{ fontSize: 9 }}>
            Recommended
          </span>
        )}
      </div>
      <div className="t-20">{preset.name}</div>
      <p className="t-12 t-meta" style={{ margin: 0, lineHeight: 1.5 }}>
        {preset.rationale ?? ""}
      </p>
      <div style={{ flex: 1 }}></div>
      <div style={{ height: 1, background: "var(--border)" }}></div>
      <div className="col gap-4">
        <KV label="embedder" value={preset.config.embedder_id} />
        <KV
          label="chunking"
          value={`${preset.config.chunking.strategy} ${preset.config.chunking.chunk_size}/${preset.config.chunking.chunk_overlap}`}
        />
        <KV label="llm" value={preset.config.llm_id ?? "retrieval-only"} />
      </div>
      {selected && (
        <span
          style={{
            position: "absolute",
            top: -1,
            left: -1,
            width: 7,
            height: 7,
            background: "var(--accent)",
          }}
        ></span>
      )}
    </button>
  );
}

function KV({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="row f-between" style={{ gap: 10 }}>
      <span className="t-meta t-12" style={{ minWidth: 64 }}>
        {label}
      </span>
      <span
        className="t-12 t-mono"
        style={{
          color: "var(--text-1)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function DropZone({
  files,
  setFiles,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
}): JSX.Element {
  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) setFiles([...files, ...dropped]);
  };
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        border: "1px dashed var(--border-strong)",
        padding: "32px 24px",
        textAlign: "center",
        background: "var(--bg-0)",
        cursor: "pointer",
        display: "block",
      }}
    >
      <Icon name="upload" size={20} color="var(--text-2)" />
      <div className="t-14" style={{ marginTop: 10 }}>
        Drop PDF · TXT · Markdown anywhere here
      </div>
      <div className="t-12 t-meta" style={{ marginTop: 4 }}>
        클릭하거나 파일·폴더를 끌어다 놓으세요.
      </div>
      <input
        type="file"
        multiple
        onChange={(e) =>
          setFiles([...files, ...(e.target.files ? Array.from(e.target.files) : [])])
        }
        style={{ display: "none" }}
      />
    </label>
  );
}

function FileList({
  files,
  setFiles,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
}): JSX.Element {
  return (
    <div className="col" style={{ borderTop: "1px solid var(--border)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 80px 60px 28px",
          padding: "8px 4px",
        }}
      >
        <span></span>
        <span className="t-label">Filename</span>
        <span className="t-label">Size</span>
        <span className="t-label">Type</span>
        <span></span>
      </div>
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          style={{
            display: "grid",
            gridTemplateColumns: "32px 1fr 80px 60px 28px",
            padding: "10px 4px",
            borderTop: "1px solid var(--border)",
            alignItems: "center",
          }}
        >
          <Icon name="doc" size={14} color="var(--text-2)" />
          <span className="t-13">{f.name}</span>
          <span className="t-12 t-mono t-meta">{formatBytes(f.size)}</span>
          <span className="t-12 t-mono t-meta">{f.name.split(".").pop() ?? "?"}</span>
          <button
            className="btn-ghost"
            aria-label={`remove ${f.name}`}
            onClick={() => setFiles(files.filter((_, j) => j !== i))}
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              color: "var(--text-2)",
              padding: 4,
            }}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

function presetBackendLine(p: PresetEntry | undefined): string {
  if (!p) return "";
  return `${p.config.embedder_id} · ${p.config.chunking.strategy} ${p.config.chunking.chunk_size}/${p.config.chunking.chunk_overlap}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTotalSize(files: File[]): string {
  return formatBytes(files.reduce((s, f) => s + f.size, 0));
}
