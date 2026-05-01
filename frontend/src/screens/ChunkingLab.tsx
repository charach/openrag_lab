/**
 * Chunking Lab — slider-driven preview of how a document gets sliced.
 * Slider changes hit ``/chunking/preview`` (debounced) and the response
 * paints the chunk strip + token-count stats.
 */

import { useEffect, useMemo, useState } from "react";
import { api, type ChunkPreviewResponse, type DocumentItem } from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, PageHeader } from "../components/ui";

type Strategy = "recursive" | "fixed";

export function ChunkingLab(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("recursive");
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [preview, setPreview] = useState<ChunkPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !docId) return;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .chunkingPreview(workspaceId, {
          document_id: docId,
          config: { strategy, chunk_size: chunkSize, chunk_overlap: chunkOverlap },
          max_chunks: 24,
        })
        .then((r) => {
          setPreview(r);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [workspaceId, docId, strategy, chunkSize, chunkOverlap]);

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
      />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, marginTop: 32 }}>
        <ControlsPanel
          documents={documents}
          docId={docId}
          setDocId={setDocId}
          strategy={strategy}
          setStrategy={setStrategy}
          chunkSize={chunkSize}
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
          <ChunkList preview={preview} />
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
        max={2048}
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

function ChunkList({ preview }: { preview: ChunkPreviewResponse | null }): JSX.Element | null {
  if (!preview) return null;
  if (preview.chunks.length === 0) {
    return (
      <p className="t-meta t-12" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="info" size={11} /> 미리보기 결과가 없습니다.
      </p>
    );
  }
  return (
    <div className="col gap-8">
      {preview.chunks.map((c) => (
        <div
          key={c.sequence}
          className="card"
          style={{
            padding: "10px 14px",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 12,
            alignItems: "start",
            borderLeft: `3px solid ${c.color_hint}`,
          }}
        >
          <span className="t-mono t-12 t-meta" style={{ minWidth: 32 }}>
            #{c.sequence.toString().padStart(2, "0")}
          </span>
          <pre
            className="t-13"
            style={{
              whiteSpace: "pre-wrap",
              margin: 0,
              fontFamily: "inherit",
              color: "var(--text-0)",
            }}
          >
            {c.content.length > 280 ? `${c.content.slice(0, 280)}…` : c.content}
          </pre>
          <span className="t-mono t-12 t-meta">
            {c.char_offset.toLocaleString()}–{(c.char_offset + c.char_length).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
