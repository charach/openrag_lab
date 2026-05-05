/**
 * Auto-Pilot wizard — preset → workspace+files → indexing.
 *
 * The flow stays linear: a non-expert picks one of the recommended presets,
 * names a workspace, drops files, then watches indexing progress over WS.
 *
 * Three notable design behaviours:
 *
 *   1. Switching a preset whose embedder has a different output dim
 *      surfaces a DimMismatchModal — a future re-index would have to
 *      archive existing experiments.
 *   2. Indexing renders a three-stage breakdown (parsed / chunked /
 *      embedded) derived from the most recent WS stage value, so the
 *      user can see where the job is in the pipeline.
 *   3. Pause is currently a stub (toast) since the backend exposes
 *      Cancel only — checkpoints already let a job resume by re-running
 *      indexing without ``force_reindex``, so the missing pause is a
 *      surface concern, not a data one.
 */

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type DocumentItem,
  type PresetResponse,
  type SystemProfileResponse,
  type WorkspaceSummary,
} from "../api/client";
import { DimMismatchModal } from "../components/modals/DimMismatchModal";
import { confirmModal, useModal } from "../components/providers/ModalProvider";
import { useToast } from "../components/providers/ToastProvider";
import { useWebSocket } from "../hooks/useWebSocket";
import { useIndexingStore } from "../stores/indexing";
import { useWorkspaceStore } from "../stores/workspace";
import { FormatTag, Icon, PageHeader, Step } from "../components/ui";

const ACCEPTED_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown"];

function isAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type PresetEntry = PresetResponse["presets"][number];
type WorkspaceMode = "existing" | "new";

/** Map an arbitrary stage label to one of three known buckets. */
type StageKey = "parse" | "chunk" | "embed";

function bucketStage(stage: string | null): StageKey | null {
  if (!stage) return null;
  const lower = stage.toLowerCase();
  if (lower.startsWith("parse") || lower.startsWith("parsed")) return "parse";
  if (lower.startsWith("chunk")) return "chunk";
  if (lower.startsWith("embed")) return "embed";
  return null;
}

const STAGE_ORDER: StageKey[] = ["parse", "chunk", "embed"];

export function AutoPilotWizard(): JSX.Element {
  const modal = useModal();
  const toast = useToast();
  const [profile, setProfile] = useState<SystemProfileResponse | null>(null);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("existing");
  const [workspaceName, setWorkspaceName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failedDocs, setFailedDocs] = useState<DocumentItem[]>([]);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const indexing = useIndexingStore();
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

  const topics = useMemo(
    () => (indexing.task ? [indexing.task.websocket_topic] : []),
    [indexing.task],
  );
  useWebSocket({
    topics,
    enabled: indexing.task !== null,
    onMessage: (msg) => indexing.setProgress(msg),
  });

  const ratio = typeof indexing.progress?.ratio === "number" ? indexing.progress.ratio : null;
  const stageRaw = typeof indexing.progress?.stage === "string"
    ? indexing.progress.stage
    : typeof indexing.progress?.type === "string"
      ? indexing.progress.type
      : null;
  const stage = bucketStage(stageRaw);
  const isActive =
    indexing.phase === "starting" || indexing.phase === "running" || indexing.phase === "done";
  const isStarting = indexing.phase === "starting";
  const cancelled = indexing.phase === "cancelled";
  const completed = indexing.phase === "done" || (ratio !== null && ratio >= 0.999);

  // Fetch failed-doc list once indexing completes/cancels so the user
  // can see exactly which files didn't make it. The WS doesn't emit per-
  // doc fail events, but the document repo updates on completion.
  useEffect(() => {
    if (!indexing.workspaceId) return;
    if (!completed && !cancelled) return;
    api
      .listDocuments(indexing.workspaceId)
      .then((r) => setFailedDocs(r.items.filter((d) => d.indexing_status === "failed")))
      .catch(() => undefined);
  }, [completed, cancelled, indexing.workspaceId]);

  const stepStatus = (n: 1 | 2 | 3): "todo" | "active" | "done" => {
    if (n === 1) return chosen ? "done" : "active";
    if (n === 2) return isActive ? "done" : chosen ? "active" : "todo";
    return isActive ? "active" : "todo";
  };

  const cancelIndex = async (): Promise<void> => {
    if (!indexing.task) return;
    setError(null);
    try {
      await api.cancelTask(indexing.task.task_id);
      indexing.markCancelled();
      toast.push({
        eyebrow: "Cancelled",
        message: "Indexing job cancelled. Checkpoints preserved.",
        kind: "error",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const askCancel = (): void => {
    confirmModal(modal, {
      title: "Cancel indexing?",
      message:
        "진행 중인 임베딩이 중단됩니다. 체크포인트는 보존되며, 같은 설정으로 다시 시작하면 이어서 진행됩니다.",
      confirmLabel: "Cancel job",
      danger: true,
      onConfirm: cancelIndex,
    });
  };

  const trySetChosen = (nextId: string): void => {
    if (nextId === chosen) return;
    const cur = presets.find((p) => p.id === chosen);
    const next = presets.find((p) => p.id === nextId);
    if (!cur || !next) {
      setChosen(nextId);
      return;
    }
    const curDim = cur.config.embedder_dim;
    const nextDim = next.config.embedder_dim;
    if (curDim && nextDim && curDim !== nextDim && isActive) {
      modal.open({
        title: "Embedder change requires reindex",
        eyebrow: "Dimension mismatch",
        width: 520,
        danger: true,
        render: ({ close }) => (
          <DimMismatchModal
            from={{ name: cur.config.embedder_id, dim: curDim }}
            to={{ name: next.config.embedder_id, dim: nextDim }}
            archivedCount={1}
            onConfirm={() => {
              setChosen(nextId);
              toast.push({
                eyebrow: "Reindex pending",
                message: `Switched to ${next.name}. Existing job will be archived on next start.`,
              });
            }}
            close={close}
          />
        ),
      });
      return;
    }
    setChosen(nextId);
  };

  const launch = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    setPaused(false);
    setFailedDocs([]);
    const preset = presets.find((p) => p.id === chosen);
    if (!preset) {
      setError("preset not chosen");
      setSubmitting(false);
      return;
    }
    const rejected = files.filter((f) => !isAcceptedExtension(f.name));
    if (rejected.length > 0) {
      setError(
        `지원하지 않는 확장자입니다: ${rejected.map((f) => f.name).join(", ")} (허용: ${ACCEPTED_EXTENSIONS.join(", ")})`,
      );
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
      indexing.startStarting(workspaceId);
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
      indexing.setTask(accepted);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      indexing.markError(msg);
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
                  onSelect={() => trySetChosen(p.id)}
                />
              ))}
            </div>
          )}
        </Step>

        <Step
          number="02"
          title="Documents"
          status={stepStatus(2)}
          subtitle={
            files.length > 0 ? `${files.length} files · ${formatTotalSize(files)}` : undefined
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
            <div className="col gap-12">
              <div className="col gap-6">
                <span className="t-label">Target</span>
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
                    Index into current
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm${workspaceMode === "new" ? " btn-primary" : ""}`}
                    onClick={() => setWorkspaceMode("new")}
                  >
                    Create new
                  </button>
                </div>
                {workspaceMode === "existing" ? (
                  <span className="t-12 t-mono" style={{ color: "var(--text-1)" }}>
                    →{" "}
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
                isActive ||
                !chosen ||
                (workspaceMode === "new" && workspaceName.trim().length === 0) ||
                (workspaceMode === "existing" && !activeWorkspaceId && workspaces.length === 0)
              }
            >
              {submitting ? "Starting…" : isActive ? "Indexing…" : "Start indexing"}
            </button>
          </div>
        </Step>

        {isActive && (
          <Step
            number="03"
            title="Indexing"
            status="active"
            subtitle={
              isStarting
                ? "starting…"
                : ratio !== null
                  ? `${(ratio * 100).toFixed(1)}% · ${stage ?? stageRaw ?? "running"}`
                  : "running"
            }
          >
            <div className="col gap-16">
              {/* Overall progress bar */}
              <div className="col gap-8">
                <div className="row f-between f-center">
                  <div className="row gap-8 f-center">
                    <span
                      className={"dot" + (completed ? " dot-success" : " dot-gold pulse-gold")}
                    ></span>
                    <span className="t-13">
                      {completed ? "completed" : isStarting ? "starting…" : stageRaw ?? "queued"}
                    </span>
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

              {/* Stage breakdown */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {STAGE_ORDER.map((s) => (
                  <StageCard
                    key={s}
                    label={s === "parse" ? "Parsed" : s === "chunk" ? "Chunked" : "Embedded"}
                    state={
                      stage === null
                        ? "todo"
                        : STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(stage)
                          ? "done"
                          : stage === s
                            ? "active"
                            : "todo"
                    }
                    ratio={stage === s ? ratio : stage === null ? null : 1}
                  />
                ))}
              </div>

              {/* Failed file panel */}
              {failedDocs.length > 0 && <FailedFiles items={failedDocs} />}

              {/* Action row */}
              <div className="row gap-12 f-center" style={{ marginTop: 4 }}>
                {indexing.task && (
                  <>
                    <span className="t-12 t-meta t-mono">
                      task_id {indexing.task.task_id}
                    </span>
                    <span className="t-12 t-meta t-mono">
                      exp {indexing.task.experiment_id}
                    </span>
                  </>
                )}
                {cancelled && (
                  <span className="chip" style={{ color: "var(--error)" }}>
                    cancelled
                  </span>
                )}
                {paused && (
                  <span className="chip" style={{ color: "var(--accent)" }}>
                    paused
                  </span>
                )}
                <div style={{ flex: 1 }}></div>
                <button
                  className="btn btn-sm"
                  disabled={isStarting || cancelled || completed}
                  onClick={() => {
                    setPaused((p) => !p);
                    toast.push({
                      eyebrow: paused ? "Resumed" : "Paused",
                      message: paused
                        ? "Indexing continues — checkpoints picked up where they left off."
                        : "True pause is on the roadmap. Cancel + restart preserves checkpoints today.",
                    });
                  }}
                >
                  <Icon name={paused ? "play" : "pause"} size={11} />
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={askCancel}
                  disabled={isStarting || cancelled || completed}
                  style={{ borderColor: "var(--border-strong)", color: "var(--text-1)" }}
                >
                  <Icon name="x" size={12} /> Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!completed}
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
      value:
        profile.ram.available_gb !== null && profile.ram.available_gb !== undefined
          ? `${profile.ram.available_gb} / ${profile.ram.total_gb} GB`
          : `${profile.ram.total_gb} GB`,
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
        {preset.config.embedder_dim && (
          <KV label="dim" value={String(preset.config.embedder_dim)} />
        )}
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

function StageCard({
  label,
  state,
  ratio,
}: {
  label: string;
  state: "todo" | "active" | "done";
  ratio: number | null;
}): JSX.Element {
  const isActive = state === "active";
  const isDone = state === "done";
  const pct = isDone ? 100 : isActive && ratio !== null ? ratio * 100 : 0;
  return (
    <div
      style={{
        background: "var(--bg-0)",
        border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
        padding: 14,
      }}
    >
      <div className="row f-between f-center">
        <span className="t-label">{label}</span>
        {isActive ? (
          <span className="dot dot-gold pulse-gold"></span>
        ) : isDone ? (
          <Icon name="check" size={11} color="var(--success)" />
        ) : (
          <span className="dot"></span>
        )}
      </div>
      <div
        className="t-20 t-mono"
        style={{
          marginTop: 6,
          color: isActive ? "var(--accent)" : isDone ? "var(--text-0)" : "var(--text-2)",
        }}
      >
        {isDone ? "100" : isActive && ratio !== null ? (ratio * 100).toFixed(0) : "—"}
        <span className="t-12 t-meta" style={{ marginLeft: 4 }}>
          {isDone || (isActive && ratio !== null) ? "%" : ""}
        </span>
      </div>
      <div
        style={{
          height: 1,
          background: "var(--bg-3)",
          marginTop: 10,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: isActive ? "var(--accent)" : isDone ? "var(--text-1)" : "transparent",
            transition: "width 220ms linear",
          }}
        ></div>
      </div>
    </div>
  );
}

function FailedFiles({ items }: { items: DocumentItem[] }): JSX.Element {
  return (
    <div
      className="card"
      style={{
        background: "var(--bg-0)",
        padding: 12,
        borderLeft: "2px solid var(--error)",
      }}
    >
      <div className="row gap-8 f-center" style={{ marginBottom: 8 }}>
        <Icon name="alert" size={12} color="var(--error)" />
        <span className="t-12 t-label" style={{ color: "var(--error)" }}>
          {items.length} file{items.length > 1 ? "s" : ""} failed · 다른 파일은 정상 진행됨
        </span>
      </div>
      {items.map((doc) => (
        <div
          key={doc.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 12,
            alignItems: "center",
            padding: "6px 0",
          }}
        >
          <span className="t-13">{doc.filename}</span>
          <span className="t-mono t-12 t-meta">indexing failed</span>
        </div>
      ))}
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
  const [rejected, setRejected] = useState<string[]>([]);
  const accept = (incoming: File[]): void => {
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of incoming) {
      if (isAcceptedExtension(f.name)) ok.push(f);
      else bad.push(f.name);
    }
    if (ok.length > 0) setFiles([...files, ...ok]);
    setRejected(bad);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) accept(dropped);
  };
  return (
    <div className="col gap-6">
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
          클릭하거나 파일·폴더를 끌어다 놓으세요. 허용 확장자: {ACCEPTED_EXTENSIONS.join(", ")}
        </div>
        <input
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => accept(e.target.files ? Array.from(e.target.files) : [])}
          style={{ display: "none" }}
        />
      </label>
      {rejected.length > 0 && (
        <span className="t-12" style={{ color: "var(--error)" }}>
          지원하지 않는 확장자가 무시되었습니다: {rejected.join(", ")}
        </span>
      )}
    </div>
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
          <FormatTag format={(f.name.split(".").pop() ?? "?").toLowerCase()} />
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
