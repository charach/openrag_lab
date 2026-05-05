/**
 * Chunking Lab — slider-driven preview of how a document gets sliced.
 *
 * The lab pairs three live views over the same chunker output:
 *   - a proportional ``ChunkStrip`` mini-map across the full document,
 *   - a token-distribution histogram that flags which chunks land near
 *     the target size,
 *   - a tinted prose render where each chunk's own background colour
 *     reveals its boundary; hovering a chunk activates a floating
 *     inspector with offset/length/tokens.
 *
 * Slider changes are debounced via React.useDeferredValue so dragging
 * stays responsive — a small "computing…" chip surfaces whenever the
 * deferred value lags the live one.
 */

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  type ChunkPreviewItem,
  type ChunkPreviewResponse,
  type DocumentItem,
  type PresetResponse,
  type WorkspaceConfig,
} from "../api/client";
import {
  ExportModal,
  mimeFor,
  triggerDownload,
} from "../components/modals/ExportModal";
import { confirmModal, useModal } from "../components/providers/ModalProvider";
import { useToast } from "../components/providers/ToastProvider";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, PageHeader } from "../components/ui";

type Strategy = "recursive" | "fixed";

type PresetEntry = PresetResponse["presets"][number];

interface OverlapRegion {
  /** Bytes shared with the previous chunk at this chunk's head. */
  head: number;
  /** Bytes shared with the next chunk at this chunk's tail. */
  tail: number;
}

/**
 * Compute overlap regions from chunk char ranges. The chunker emits
 * (offset, length) per chunk; when chunk N+1 starts before chunk N
 * ends, the difference is the overlap region. The result drives the
 * striped overlay in the prose view.
 */
function deriveOverlap(chunks: ChunkPreviewItem[]): OverlapRegion[] {
  const out: OverlapRegion[] = chunks.map(() => ({ head: 0, tail: 0 }));
  for (let i = 0; i < chunks.length - 1; i++) {
    const a = chunks[i]!;
    const b = chunks[i + 1]!;
    const aEnd = a.char_offset + a.char_length;
    if (b.char_offset < aEnd) {
      const len = aEnd - b.char_offset;
      out[i]!.tail = Math.min(a.char_length, len);
      out[i + 1]!.head = Math.min(b.char_length, len);
    }
  }
  return out;
}

export function ChunkingLab(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();
  const modal = useModal();
  const toast = useToast();
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
  const [visibleCount, setVisibleCount] = useState(50);
  const [hoverChunk, setHoverChunk] = useState<number | null>(null);
  const [showOverlap, setShowOverlap] = useState(true);

  const deferredSize = useDeferredValue(chunkSize);
  const deferredOverlap = useDeferredValue(chunkOverlap);
  const computing = deferredSize !== chunkSize || deferredOverlap !== chunkOverlap;

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

  const askRunExperiment = (): void => {
    if (!workspaceId || !baseConfig) return;
    confirmModal(modal, {
      title: "Run as new experiment?",
      message: `현재 청킹 설정 (${strategy} · ${chunkSize}/${chunkOverlap}) 으로 다시 인덱싱하고 새 실험을 만듭니다. 기존 실험은 보존됩니다.`,
      confirmLabel: "Run experiment",
      onConfirm: async () => {
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
          toast.push({
            eyebrow: "Started",
            message: "새 실험 — 인덱싱 진행 중. Experiments 화면에서 추적하세요.",
          });
          navigate("/experiments");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const openExport = (): void => {
    if (!preview) return;
    const stats = preview.stats;
    const filename = `chunking-${strategy}-${chunkSize}-${chunkOverlap}`;
    modal.open({
      title: "Export chunking config",
      eyebrow: "Reproducible YAML",
      width: 600,
      render: ({ close }) => (
        <ExportModal
          defaults={{
            format: "yaml",
            filename,
            path: `~/openrag-lab/exports/${workspaceId ?? ""}`,
            formats: ["yaml", "json"],
            sectionsConfig: [
              {
                id: "chunking",
                label: "Chunking parameters",
                note: "strategy, size, overlap",
                size: "0.4 KB",
                required: true,
              },
              {
                id: "stats",
                label: "Resulting stats",
                note: `${preview.chunks.length} chunks, distribution`,
                size: "0.6 KB",
              },
              {
                id: "samples",
                label: "Sample chunks (first 3)",
                note: "for human verification",
                size: "1.4 KB",
              },
            ],
            includes: { chunking: true, stats: true, samples: false },
          }}
          preview={(fmt, inc) => {
            if (fmt === "yaml") {
              const lines = [
                `# OpenRAG-Lab chunking config`,
                `# Generated ${new Date().toISOString()}`,
                ``,
                `chunking:`,
                `  strategy: ${strategy}`,
                `  chunk_size: ${chunkSize}`,
                `  overlap: ${chunkOverlap}`,
              ];
              if (inc.stats) {
                lines.push(``, `stats:`);
                lines.push(`  preview_chunks: ${preview.chunks.length}`);
                lines.push(`  total_chunks_estimated: ${stats.total_chunks_estimated}`);
                lines.push(`  avg_token_count: ${stats.avg_token_count}`);
                lines.push(`  min_token_count: ${stats.min_token_count}`);
                lines.push(`  max_token_count: ${stats.max_token_count}`);
              }
              if (inc.samples) {
                lines.push(``, `samples:`);
                for (const c of preview.chunks.slice(0, 3)) {
                  lines.push(`  - sequence: ${c.sequence}`);
                  lines.push(
                    `    content: "${c.content.replace(/"/g, '\\"').slice(0, 80)}…"`,
                  );
                  lines.push(`    chars: ${c.char_length}`);
                }
              }
              return lines.join("\n");
            }
            return JSON.stringify(
              {
                chunking: {
                  strategy,
                  chunk_size: chunkSize,
                  chunk_overlap: chunkOverlap,
                },
                ...(inc.stats ? { stats } : {}),
                ...(inc.samples
                  ? { samples: preview.chunks.slice(0, 3) }
                  : {}),
              },
              null,
              2,
            );
          }}
          onSave={({ format, filename: fname, body }) => {
            triggerDownload(`${fname}.${format}`, body, mimeFor(format));
            toast.push({
              eyebrow: "Exported",
              message: `${fname}.${format} downloaded.`,
            });
          }}
          close={close}
        />
      ),
    });
  };

  useEffect(() => {
    if (!workspaceId || !docId) return;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .chunkingPreview(workspaceId, {
          document_id: docId,
          config: {
            strategy,
            chunk_size: deferredSize,
            chunk_overlap: deferredOverlap,
          },
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
  }, [workspaceId, docId, strategy, deferredSize, deferredOverlap, visibleCount]);

  // When config changes, reset paging — old visibleCount is meaningless under
  // a new chunk size.
  useEffect(() => {
    setVisibleCount(50);
  }, [docId, strategy, chunkSize, chunkOverlap]);

  const documentTotalChars = preview?.stats?.document_total_chars ?? 0;
  // Cap chunk_size by min(전체 문서, 2000). Default 32-step still applies.
  const dynamicChunkSizeMax = Math.max(
    64,
    Math.min(2000, documentTotalChars > 0 ? documentTotalChars : 2000),
  );
  const chunkSizeMax = Math.ceil(dynamicChunkSizeMax / 32) * 32;

  const stats = preview?.stats;
  const chunks = preview?.chunks ?? [];
  const overlap = useMemo(() => deriveOverlap(chunks), [chunks]);

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
        title="See how splits change retrieval."
        sub="전략과 크기를 조정하면서 즉시 청크가 어떻게 잘리는지 확인하세요. 변경 사항은 새 실험으로 저장됩니다."
        right={
          <div className="row gap-8">
            <button
              className="btn btn-sm"
              onClick={openExport}
              disabled={!preview || preview.chunks.length === 0}
            >
              <Icon name="yaml" size={11} /> Export YAML
            </button>
            <button
              className="btn btn-primary"
              onClick={askRunExperiment}
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
          </div>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 24,
          marginTop: 32,
        }}
      >
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
          stats={stats}
          chunkCount={preview?.chunks.length ?? 0}
          computing={computing}
          showOverlap={showOverlap}
          setShowOverlap={setShowOverlap}
        />

        <div className="col gap-16">
          <div className="row f-between f-center">
            <div className="row gap-12 f-center">
              <span className="t-label">
                Preview ·{" "}
                {documents.find((d) => d.id === docId)?.filename ?? "—"}
              </span>
              <span className="chip chip-mono">
                {strategy} · {chunkSize}/{chunkOverlap}
              </span>
              <span className="chip chip-mono">
                {chunks.length} chunks
              </span>
            </div>
            {loading && (
              <span className="chip chip-gold" style={{ fontSize: 9 }}>
                <span className="dot dot-gold pulse-gold"></span>updating
              </span>
            )}
          </div>

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

          <ChunkStrip
            chunks={chunks}
            documentTotalChars={documentTotalChars}
            hoverIndex={hoverChunk}
            setHoverIndex={setHoverChunk}
          />

          <ChunkProse
            chunks={chunks}
            overlap={overlap}
            visibleCount={visibleCount}
            onLoadMore={() => setVisibleCount((n) => n + 50)}
            hoverIndex={hoverChunk}
            setHoverIndex={setHoverChunk}
            showOverlap={showOverlap}
          />

          {hoverChunk !== null && chunks[hoverChunk] && (
            <ChunkInspector
              index={hoverChunk}
              chunk={chunks[hoverChunk]}
              overlap={overlap[hoverChunk] ?? { head: 0, tail: 0 }}
            />
          )}
        </div>
      </div>
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
  stats: ChunkPreviewResponse["stats"] | undefined;
  chunkCount: number;
  computing: boolean;
  showOverlap: boolean;
  setShowOverlap: (v: boolean) => void;
}): JSX.Element {
  const { documents, docId, setDocId, strategy, setStrategy } = props;
  return (
    <div className="card col gap-20" style={{ padding: 20 }}>
      <div className="col gap-6">
        <span className="t-label">Document</span>
        {documents.length === 0 ? (
          <span className="t-12 t-meta">
            No documents — upload one in Auto-Pilot first.
          </span>
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
        <div className="col gap-1">
          {[
            { id: "fixed", label: "Fixed", note: "char window" },
            { id: "recursive", label: "Recursive", note: "sentence-aware" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setStrategy(s.id as Strategy)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                background:
                  strategy === s.id ? "var(--bg-2)" : "var(--bg-0)",
                border:
                  "1px solid " +
                  (strategy === s.id ? "var(--accent)" : "var(--border-strong)"),
                color: "var(--text-0)",
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: -1,
              }}
            >
              <div className="row gap-8 f-center">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    border:
                      "1px solid " +
                      (strategy === s.id ? "var(--accent)" : "var(--text-2)"),
                    background:
                      strategy === s.id ? "var(--accent)" : "transparent",
                  }}
                ></span>
                <span className="t-13">{s.label}</span>
              </div>
              <span className="t-mono t-12 t-meta">{s.note}</span>
            </button>
          ))}
        </div>
        <span className="t-12 t-meta" style={{ lineHeight: 1.5 }}>
          {strategy === "fixed"
            ? "고정 크기 윈도우 — 의미 경계 무시, 연산 빠름."
            : "문장 단위로 누적, 토큰 한도 도달 시 분할 — 한국어 종결어미 기준."}
        </span>
      </div>

      <SliderRow
        label="Chunk size"
        value={props.chunkSize}
        min={32}
        max={props.chunkSizeMax}
        step={32}
        unit="tokens"
        onChange={props.setChunkSize}
      />
      <SliderRow
        label="Overlap"
        value={props.chunkOverlap}
        min={0}
        max={Math.floor(props.chunkSize / 2)}
        step={8}
        unit="tokens"
        onChange={props.setChunkOverlap}
      />

      <label className="row gap-6 f-center t-12 t-meta" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={props.showOverlap}
          onChange={(e) => props.setShowOverlap(e.target.checked)}
          style={{ accentColor: "var(--accent)" }}
        />
        Show overlap stripes
      </label>

      <div className="col gap-8">
        <div className="row f-between f-center">
          <span className="t-label">Live metrics</span>
          {props.computing && (
            <span className="chip chip-gold" style={{ fontSize: 9 }}>
              <span className="dot dot-gold pulse-gold"></span>computing…
            </span>
          )}
        </div>
        <div
          className="card"
          style={{
            padding: "14px 16px",
            background: "var(--bg-0)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
            }}
          >
            <Metric
              label="Chunks"
              value={props.chunkCount}
              accent
            />
            <Metric
              label="Avg tokens"
              value={props.stats?.avg_token_count ?? 0}
            />
            <Metric label="Min" value={props.stats?.min_token_count ?? 0} />
            <Metric label="Max" value={props.stats?.max_token_count ?? 0} />
          </div>
          {props.stats && props.chunkCount > 0 && (
            <>
              <div
                style={{
                  height: 1,
                  background: "var(--border)",
                  margin: "12px 0",
                }}
              ></div>
              <DistributionBar
                avg={props.stats.avg_token_count}
                min={props.stats.min_token_count}
                max={props.stats.max_token_count}
                target={props.chunkSize}
              />
            </>
          )}
        </div>
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
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (n: number) => void;
}): JSX.Element {
  return (
    <div className="col gap-4">
      <div className="row f-between f-center">
        <span className="t-label">{label}</span>
        <span className="t-mono t-13" style={{ color: "var(--accent)" }}>
          {value}
          {unit && (
            <span className="t-meta t-12" style={{ marginLeft: 4 }}>
              {unit}
            </span>
          )}
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
      <div className="row f-between t-12 t-meta t-mono">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="col gap-2">
      <span className="t-label" style={{ fontSize: 9 }}>
        {label}
      </span>
      <span
        className="t-mono"
        style={{
          fontSize: 18,
          fontWeight: 300,
          color: accent ? "var(--accent)" : "var(--text-0)",
        }}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

/**
 * Mini-histogram of token counts. We don't have per-chunk tokens in the
 * preview response (only min/avg/max stats), so the bar reflects the
 * statistical envelope: a stack of three vertical strokes for min /
 * avg / max plus a horizontal target rule. Conveys whether chunks are
 * landing near the requested size without needing full distribution
 * data.
 */
function DistributionBar({
  avg,
  min,
  max,
  target,
}: {
  avg: number;
  min: number;
  max: number;
  target: number;
}): JSX.Element {
  const ceiling = Math.max(max, target, 1);
  const bar = (label: string, value: number, color: string): JSX.Element => (
    <div className="row gap-8 f-center">
      <span className="t-mono t-12 t-meta" style={{ width: 36 }}>
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--bg-1)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${(value / ceiling) * 100}%`,
            background: color,
            opacity: 0.7,
          }}
        ></div>
        <div
          style={{
            position: "absolute",
            top: -2,
            bottom: -2,
            left: `${(target / ceiling) * 100}%`,
            width: 1,
            background: "var(--accent)",
          }}
          title={`target ${target}`}
        ></div>
      </div>
      <span
        className="t-mono t-12"
        style={{ width: 44, textAlign: "right", color: "var(--text-1)" }}
      >
        {value}
      </span>
    </div>
  );
  return (
    <div className="col gap-4">
      <span className="t-label" style={{ fontSize: 9 }}>
        Token distribution
      </span>
      {bar("min", min, "var(--text-2)")}
      {bar("avg", avg, "var(--text-1)")}
      {bar("max", max, "var(--accent)")}
      <span className="t-12 t-meta">
        Vertical rule = target ({target}). Closer to the rule = more uniform chunks.
      </span>
    </div>
  );
}

function ChunkStrip({
  chunks,
  documentTotalChars,
  hoverIndex,
  setHoverIndex,
}: {
  chunks: ChunkPreviewItem[];
  documentTotalChars: number;
  hoverIndex: number | null;
  setHoverIndex: (i: number | null) => void;
}): JSX.Element | null {
  if (chunks.length === 0) return null;
  const totalChars =
    documentTotalChars > 0
      ? documentTotalChars
      : chunks.reduce((s, c) => s + c.char_length, 0) || 1;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row f-between f-center" style={{ marginBottom: 8 }}>
        <span className="t-label" style={{ fontSize: 9 }}>
          Chunk map · proportional
        </span>
        <span className="t-12 t-mono t-meta">
          {totalChars.toLocaleString()} chars total
        </span>
      </div>
      <div style={{ display: "flex", height: 14, gap: 1, overflow: "hidden" }}>
        {chunks.map((c, i) => {
          const w = (c.char_length / totalChars) * 100;
          const isHover = hoverIndex === i;
          return (
            <div
              key={c.sequence}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              title={`Chunk ${String(i).padStart(2, "0")} · offset ${c.char_offset} · ${c.char_length} chars`}
              style={{
                width: `${w}%`,
                background: c.color_hint,
                opacity: isHover ? 1 : 0.65,
                borderTop: isHover
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                cursor: "pointer",
                transition: "all 120ms",
              }}
            ></div>
          );
        })}
      </div>
      <div className="row f-between t-12 t-mono t-meta" style={{ marginTop: 6 }}>
        <span>0</span>
        <span>{Math.round(totalChars / 2).toLocaleString()}</span>
        <span>{totalChars.toLocaleString()}</span>
      </div>
    </div>
  );
}

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
  chunks,
  overlap,
  visibleCount,
  onLoadMore,
  hoverIndex,
  setHoverIndex,
  showOverlap,
}: {
  chunks: ChunkPreviewItem[];
  overlap: OverlapRegion[];
  visibleCount: number;
  onLoadMore: () => void;
  hoverIndex: number | null;
  setHoverIndex: (i: number | null) => void;
  showOverlap: boolean;
}): JSX.Element | null {
  if (chunks.length === 0) {
    return (
      <p className="t-meta t-12" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="info" size={11} /> 미리보기 결과가 없습니다.
      </p>
    );
  }

  const total = chunks.length;
  const shown = Math.min(visibleCount, total);
  const visibleChunks = chunks.slice(0, shown);

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
        {visibleChunks.map((c, i) => {
          const o = overlap[i] ?? { head: 0, tail: 0 };
          const isHover = hoverIndex === i;
          const baseTint = tintFromColor(c.color_hint, isHover ? 0.42 : 0.22);
          return (
            <ChunkSpan
              key={c.sequence}
              chunk={c}
              index={i}
              tint={baseTint}
              overlap={o}
              prevColor={
                i > 0 ? chunks[i - 1]!.color_hint : null
              }
              nextColor={
                i < chunks.length - 1 ? chunks[i + 1]!.color_hint : null
              }
              showOverlap={showOverlap}
              hovered={isHover}
              onEnter={() => setHoverIndex(i)}
              onLeave={() => setHoverIndex(null)}
            />
          );
        })}
      </div>
      <div className="row f-between f-center">
        <span className="t-12 t-meta">
          {shown} / {total} chunks
        </span>
        {total > shown && (
          <button className="btn btn-sm" onClick={onLoadMore}>
            <Icon name="down" size={11} /> 더 보기 (+50)
          </button>
        )}
      </div>
    </div>
  );
}

function ChunkSpan({
  chunk,
  index,
  tint,
  overlap,
  prevColor,
  nextColor,
  showOverlap,
  hovered,
  onEnter,
  onLeave,
}: {
  chunk: ChunkPreviewItem;
  index: number;
  tint: string;
  overlap: OverlapRegion;
  prevColor: string | null;
  nextColor: string | null;
  showOverlap: boolean;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}): JSX.Element {
  const headLen = showOverlap ? Math.min(overlap.head, chunk.content.length) : 0;
  const tailLen = showOverlap
    ? Math.min(overlap.tail, Math.max(0, chunk.content.length - headLen))
    : 0;
  const head = chunk.content.slice(0, headLen);
  const body = chunk.content.slice(headLen, chunk.content.length - tailLen);
  const tail = chunk.content.slice(chunk.content.length - tailLen);

  const stripeWith = (a: string, b: string): string =>
    `repeating-linear-gradient(135deg, ${tintFromColor(a, 0.4)} 0 4px, ${tintFromColor(b, 0.4)} 4px 8px)`;

  return (
    <span
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        display: "inline",
        cursor: "default",
        outline: hovered ? "1px solid var(--accent)" : "none",
        outlineOffset: 1,
        transition: "outline 120ms",
      }}
    >
      <sup
        className="t-mono"
        style={{
          fontSize: 9,
          color: hovered ? "var(--accent)" : "var(--text-2)",
          marginRight: 2,
          userSelect: "none",
        }}
      >
        {String(index).padStart(2, "0")}
      </sup>
      {head && prevColor && (
        <span
          style={{
            background: stripeWith(prevColor, chunk.color_hint),
            padding: "2px 0",
          }}
        >
          {head}
        </span>
      )}
      <span
        style={{
          background: tint,
          padding: "2px 0",
          whiteSpace: "pre-wrap",
          transition: "background 120ms",
        }}
      >
        {body}
      </span>
      {tail && nextColor && (
        <span
          style={{
            background: stripeWith(chunk.color_hint, nextColor),
            padding: "2px 0",
          }}
        >
          {tail}
        </span>
      )}
    </span>
  );
}

function ChunkInspector({
  index,
  chunk,
  overlap,
}: {
  index: number;
  chunk: ChunkPreviewItem;
  overlap: OverlapRegion;
}): JSX.Element {
  const preview = chunk.content.slice(0, 80);
  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        background: "var(--bg-1)",
        border: "1px solid var(--border-strong)",
        padding: "14px 16px",
        minWidth: 320,
        maxWidth: 360,
        zIndex: 30,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="row f-between f-center" style={{ marginBottom: 10 }}>
        <span className="t-label">Chunk inspector</span>
        <span className="t-mono t-12" style={{ color: "var(--accent)" }}>
          {String(index).padStart(2, "0")}
        </span>
      </div>
      <div
        className="col gap-4 t-12 t-mono"
        style={{ marginBottom: 10 }}
      >
        <div className="row f-between">
          <span className="t-meta">char range</span>
          <span>
            {chunk.char_offset}–{chunk.char_offset + chunk.char_length}
          </span>
        </div>
        <div className="row f-between">
          <span className="t-meta">length</span>
          <span>{chunk.char_length} chars</span>
        </div>
        <div className="row f-between">
          <span className="t-meta">overlap (prev/next)</span>
          <span>
            {overlap.head} / {overlap.tail}
          </span>
        </div>
      </div>
      <div
        style={{
          background: "var(--bg-0)",
          border: "1px solid var(--border)",
          padding: "8px 10px",
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text-1)",
        }}
      >
        {preview}
        {chunk.content.length > 80 ? "…" : ""}
      </div>
    </div>
  );
}
