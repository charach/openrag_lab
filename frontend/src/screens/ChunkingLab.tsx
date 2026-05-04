/**
 * Chunking Lab — slider-driven preview of how a document gets sliced.
 * Slider changes hit ``/chunking/preview`` (debounced) and the response
 * paints the chunk strip + token-count stats.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type ChunkPreviewResponse,
  type DocumentItem,
  type PresetResponse,
  type WorkspaceConfig,
} from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, Modal, PageHeader } from "../components/ui";

type Strategy = "recursive" | "fixed";

type PresetEntry = PresetResponse["presets"][number];

export function ChunkingLab(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("recursive");
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [preview, setPreview] = useState<ChunkPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfig | null>(null);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [confirmRun, setConfirmRun] = useState(false);
  const [runPending, setRunPending] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .listDocuments(workspaceId)
      .then((r) => {
        setDocuments(r.items);
        const first = r.items[0];
        if (first) setDocId(first.id);
      })
      .catch((e) => setError(String(e)));
    api
      .getWorkspace(workspaceId)
      .then((r) => setWorkspaceConfig(r.config))
      .catch(() => undefined);
    api
      .systemPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => undefined);
  }, [workspaceId]);

  const baseConfig = useMemo(() => {
    if (workspaceConfig?.embedder_id) {
      return {
        embedder_id: workspaceConfig.embedder_id,
        retrieval_strategy: workspaceConfig.retrieval_strategy,
        top_k: workspaceConfig.top_k,
        llm_id: workspaceConfig.llm_id,
      };
    }
    const recommended = presets.find((p) => p.recommended) ?? presets[0];
    if (recommended) {
      return {
        embedder_id: recommended.config.embedder_id,
        retrieval_strategy: recommended.config.retrieval_strategy,
        top_k: recommended.config.top_k,
        llm_id: recommended.config.llm_id,
      };
    }
    return null;
  }, [workspaceConfig, presets]);

  const runAsExperiment = async (): Promise<void> => {
    if (!workspaceId || !baseConfig) return;
    setRunPending(true);
    setError(null);
    try {
      await api.startIndex(workspaceId, {
        config: {
          embedder_id: baseConfig.embedder_id,
          chunking: {
            strategy,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
          },
          retrieval_strategy: baseConfig.retrieval_strategy,
          top_k: baseConfig.top_k,
          llm_id: baseConfig.llm_id,
        },
        force_reindex: true,
      });
      setConfirmRun(false);
      navigate("/experiments");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunPending(false);
    }
  };

  useEffect(() => {
    if (!workspaceId || !docId) return;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .chunkingPreview(workspaceId, {
          document_id: docId,
          config: { strategy, chunk_size: chunkSize, chunk_overlap: chunkOverlap },
          max_chunks: visibleCount,
        })
        .then((r) => {
          setPreview(r);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [workspaceId, docId, strategy, chunkSize, chunkOverlap, visibleCount]);

  // When config changes, reset paging — old visibleCount is meaningless under
  // a new chunk size.
  useEffect(() => {
    setVisibleCount(50);
  }, [docId, strategy, chunkSize, chunkOverlap]);

  const documentTotalChars = preview?.stats?.document_total_chars ?? 0;
  // #10: cap chunk_size by min(전체 문서, 2000). Default 32-step still applies.
  const dynamicChunkSizeMax = Math.max(
    64,
    Math.min(2000, documentTotalChars > 0 ? documentTotalChars : 2000),
  );
  // Round up to nearest step (32) so the slider hits a clean stop.
  const chunkSizeMax = Math.ceil(dynamicChunkSizeMax / 32) * 32;

  const stats = useMemo(() => preview?.stats, [preview]);

  if (!workspaceId)
    return (
      <section className="page">
        <p className="t-meta">워크스페이스를 먼저 선택하세요.</p>
      </section>
    );

  return (
    <section className="page">
      <PageHeader
        eyebrow="Chunking Lab"
        title="Watch a slider rewrite the corpus."
        sub="전략과 크기를 조정하면서 즉시 청크가 어떻게 잘리는지 확인하세요. 변경 사항은 새 실험으로 저장됩니다."
        right={
          <button
            className="btn btn-primary"
            onClick={() => setConfirmRun(true)}
            disabled={!baseConfig || documents.length === 0}
            title={
              !baseConfig
                ? "no base config — open Auto-Pilot or pick a preset"
                : documents.length === 0
                  ? "upload documents first"
                  : "Run as new experiment"
            }
          >
            <Icon name="play" size={12} /> Run as new experiment
          </button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, marginTop: 32 }}>
        <ControlsPanel
          documents={documents}
          docId={docId}
          setDocId={setDocId}
          strategy={strategy}
          setStrategy={setStrategy}
          chunkSize={Math.min(chunkSize, chunkSizeMax)}
          chunkSizeMax={chunkSizeMax}
          setChunkSize={(v) => {
            setChunkSize(v);
            if (chunkOverlap > Math.floor(v / 2)) setChunkOverlap(Math.floor(v / 2));
          }}
          chunkOverlap={chunkOverlap}
          setChunkOverlap={setChunkOverlap}
        />

        <div className="col gap-16">
          {stats && <StatsStrip stats={stats} count={preview?.chunks.length ?? 0} />}
          {loading && (
            <div className="card" style={{ padding: 12 }}>
              <span className="t-12 t-meta">Updating preview…</span>
            </div>
          )}
          {error && (
            <div
              className="card"
              style={{ padding: "10px 14px", borderColor: "var(--error)", color: "var(--error)" }}
            >
              <span className="t-12 t-mono">{error}</span>
            </div>
          )}
          <ChunkStrip preview={preview} />
          <ChunkProse
            preview={preview}
            visibleCount={visibleCount}
            onLoadMore={() => setVisibleCount((n) => n + 50)}
          />
        </div>
      </div>
      {confirmRun && (
        <Modal
          title="Run as new experiment"
          onClose={() => {
            if (!runPending) setConfirmRun(false);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setConfirmRun(false)}
                disabled={runPending}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={runAsExperiment}
                disabled={runPending}
              >
                {runPending ? "Starting…" : "Run"}
              </button>
            </>
          }
        >
          <p className="t-14">
            현재 슬라이더 값을 청킹 설정으로 새 실험을 시작합니다.
          </p>
          <div
            className="t-mono t-12"
            style={{
              marginTop: 12,
              padding: 12,
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              color: "var(--text-1)",
            }}
          >
            <div>strategy: {strategy}</div>
            <div>chunk_size: {chunkSize}</div>
            <div>chunk_overlap: {chunkOverlap}</div>
            {baseConfig && <div>embedder: {baseConfig.embedder_id}</div>}
            {baseConfig && <div>retrieval: {baseConfig.retrieval_strategy}</div>}
          </div>
          {error && (
            <p style={{ color: "var(--error)", marginTop: 8 }} className="t-12">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

function ControlsPanel(props: {
  documents: DocumentItem[];
  docId: string | null;
  setDocId: (id: string) => void;
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  chunkSize: number;
  chunkSizeMax: number;
  setChunkSize: (n: number) => void;
  chunkOverlap: number;
  setChunkOverlap: (n: number) => void;
}): JSX.Element {
  const { documents, docId, setDocId, strategy, setStrategy } = props;
  return (
    <div className="card col gap-20" style={{ padding: 20 }}>
      <div className="col gap-6">
        <span className="t-label">Document</span>
        {documents.length === 0 ? (
          <span className="t-12 t-meta">No documents — upload one in Auto-Pilot first.</span>
        ) : (
          <select
            className="select"
            value={docId ?? ""}
            onChange={(e) => setDocId(e.target.value)}
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="col gap-8">
        <span className="t-label">Strategy</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {(["recursive", "fixed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className="btn btn-sm"
              style={{
                justifyContent: "center",
                borderColor: strategy === s ? "var(--accent)" : undefined,
                color: strategy === s ? "var(--accent)" : "var(--text-1)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <SliderRow
        label="chunk_size"
        value={props.chunkSize}
        min={32}
        max={props.chunkSizeMax}
        step={32}
        onChange={props.setChunkSize}
      />
      <SliderRow
        label="chunk_overlap"
        value={props.chunkOverlap}
        min={0}
        max={Math.floor(props.chunkSize / 2)}
        step={8}
        onChange={props.setChunkOverlap}
      />

      <div className="col gap-6" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <span className="t-label">Legend</span>
        <p className="t-12 t-meta" style={{ margin: 0, lineHeight: 1.55 }}>
          왼쪽의 색상 띠는 각 청크의 시각적 ID입니다. 인접한 청크는 서로 다른 색을
          받아 경계가 보이게 합니다.
        </p>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}): JSX.Element {
  return (
    <div className="col gap-4">
      <div className="row f-between f-center">
        <span className="t-label">{label}</span>
        <span className="t-12 t-mono" style={{ color: "var(--accent)" }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function StatsStrip({
  stats,
  count,
}: {
  stats: NonNullable<ChunkPreviewResponse["stats"]>;
  count: number;
}): JSX.Element {
  const items = [
    { label: "preview", value: count.toString() },
    { label: "estimated", value: stats.total_chunks_estimated.toString() },
    { label: "avg tokens", value: stats.avg_token_count.toString() },
    { label: "min", value: stats.min_token_count.toString() },
    { label: "max", value: stats.max_token_count.toString() },
  ];
  return (
    <div className="card" style={{ padding: "16px 20px", display: "flex", gap: 28 }}>
      {items.map((it) => (
        <div key={it.label} className="col gap-4">
          <span className="t-label" style={{ fontSize: 9 }}>
            {it.label}
          </span>
          <span className="t-mono t-20" style={{ color: "var(--text-0)", fontWeight: 300 }}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChunkStrip({ preview }: { preview: ChunkPreviewResponse | null }): JSX.Element | null {
  if (!preview || preview.chunks.length === 0) return null;
  const total = preview.chunks.reduce((s, c) => s + c.char_length, 0) || 1;
  return (
    <div
      style={{
        display: "flex",
        height: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-1)",
      }}
    >
      {preview.chunks.map((c) => (
        <div
          key={c.sequence}
          title={`#${c.sequence} · ${c.char_length} chars`}
          style={{
            flex: c.char_length / total,
            background: c.color_hint,
            borderRight: "1px solid var(--bg-0)",
          }}
        ></div>
      ))}
    </div>
  );
}

/**
 * Renders chunk previews as a single flowing prose where each chunk
 * contributes an inline span tinted with its color as a translucent
 * background. Shading (rather than an underline) keeps overlapping
 * regions readable when adjacent chunks duplicate the same text — an
 * underline would draw two lines under the same characters and the
 * eye loses the boundary.
 */
/**
 * Mix a hex color (``#rrggbb``) with a translucent overlay suitable for
 * inline text shading. Returns an ``rgba(...)`` string so the alpha is
 * portable across browsers regardless of the source format.
 */
export function tintFromColor(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(120,120,120,${alpha})`;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function ChunkProse({
  preview,
  visibleCount,
  onLoadMore,
}: {
  preview: ChunkPreviewResponse | null;
  visibleCount: number;
  onLoadMore: () => void;
}): JSX.Element | null {
  if (!preview) return null;
  if (preview.chunks.length === 0) {
    return (
      <p className="t-meta t-12" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="info" size={11} /> 미리보기 결과가 없습니다.
      </p>
    );
  }

  const total = preview.chunks.length;
  const shown = Math.min(visibleCount, total);
  const visibleChunks = preview.chunks.slice(0, shown);
  const hasMore = total > shown;

  return (
    <div className="col gap-12">
      <div
        className="card"
        style={{
          padding: 20,
          background: "var(--bg-1)",
          lineHeight: 1.95,
          fontSize: 14,
          color: "var(--text-0)",
        }}
      >
        {visibleChunks.map((c) => (
          <span
            key={c.sequence}
            title={`#${c.sequence} · offset ${c.char_offset} · ${c.char_length} chars`}
            style={{
              background: tintFromColor(c.color_hint, 0.22),
              padding: "2px 0",
              whiteSpace: "pre-wrap",
            }}
          >
            <sup
              className="t-mono"
              style={{
                fontSize: 9,
                color: "var(--text-2)",
                marginRight: 2,
                userSelect: "none",
              }}
            >
              {c.sequence}
            </sup>
            {c.content}
          </span>
        ))}
      </div>
      <div className="row f-between f-center">
        <span className="t-12 t-meta">
          {shown} / {total} chunks
        </span>
        {hasMore && (
          <button className="btn btn-sm" onClick={onLoadMore}>
            <Icon name="down" size={11} /> 더 보기 (+50)
          </button>
        )}
      </div>
    </div>
  );
}
