/**
 * Chunking Lab — slider-driven preview of how a document gets sliced.
 *
 * The slider triggers ``/chunking/preview`` on each change. The endpoint is
 * documented to return in <1 second for typical inputs (API_SPEC §7.1).
 */

import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ChunkPreviewResponse,
  type DocumentItem,
} from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";

export function ChunkingLab(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<"recursive" | "fixed">("recursive");
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [preview, setPreview] = useState<ChunkPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Debounce slider changes so we don't overwhelm the backend.
  useEffect(() => {
    if (!workspaceId || !docId) return;
    const handle = window.setTimeout(() => {
      api
        .chunkingPreview(workspaceId, {
          document_id: docId,
          config: {
            strategy,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
          },
          max_chunks: 20,
        })
        .then(setPreview)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [workspaceId, docId, strategy, chunkSize, chunkOverlap]);

  const stats = useMemo(() => preview?.stats, [preview]);

  if (!workspaceId) return <p>워크스페이스를 먼저 선택하세요.</p>;

  return (
    <section className="chunking-lab">
      <h2>Chunking Lab</h2>
      <fieldset>
        <legend>대상 문서</legend>
        <select value={docId ?? ""} onChange={(e) => setDocId(e.target.value)}>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset>
        <legend>전략</legend>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as "recursive" | "fixed")}
        >
          <option value="recursive">recursive</option>
          <option value="fixed">fixed</option>
        </select>
      </fieldset>

      <label>
        chunk_size {chunkSize}
        <input
          type="range"
          min={32}
          max={2048}
          step={32}
          value={chunkSize}
          onChange={(e) => {
            const v = Number(e.target.value);
            setChunkSize(v);
            if (chunkOverlap > Math.floor(v / 2)) setChunkOverlap(Math.floor(v / 2));
          }}
        />
      </label>
      <label>
        chunk_overlap {chunkOverlap}
        <input
          type="range"
          min={0}
          max={Math.floor(chunkSize / 2)}
          step={8}
          value={chunkOverlap}
          onChange={(e) => setChunkOverlap(Number(e.target.value))}
        />
      </label>

      {stats && (
        <p>
          청크 {preview!.chunks.length} 미리보기 — 평균 {stats.avg_token_count} 글자
        </p>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {preview?.chunks.map((c) => (
          <li
            key={c.sequence}
            style={{
              background: c.color_hint,
              padding: "8px",
              margin: "4px 0",
              borderRadius: "4px",
            }}
          >
            <small>#{c.sequence}</small>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {c.content.slice(0, 280)}
            </pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
