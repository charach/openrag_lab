/**
 * Define-Matrix modal — picks the Cartesian product to sweep across when
 * starting an /experiments/batch run. Layout follows the design handoff
 * (screens/experiments.jsx :: MatrixDefineForm), but the option lists
 * are derived from the system preset catalog rather than hardcoded so
 * a new embedder/chunking preset surfaces here automatically.
 */

import { useEffect, useMemo, useState } from "react";
import {
  api,
  type BatchChunkingConfig,
  type BatchRequest,
  type PresetResponse,
} from "../../api/client";
import { Modal } from "../ui";

type PresetEntry = PresetResponse["presets"][number];

const EVALUATORS: Array<{ id: string; label: string; note: string }> = [
  { id: "faithfulness", label: "Faithfulness", note: "answer matches sources" },
  { id: "answer_relevance", label: "Answer relevance", note: "answer addresses question" },
  { id: "context_precision", label: "Context precision", note: "retrieved chunks are on-topic" },
  { id: "context_recall", label: "Context recall", note: "all expected chunks retrieved" },
  { id: "latency_p95", label: "Latency p95", note: "response time tail" },
  { id: "cost_per_query", label: "Cost / query", note: "token spend per ask" },
];

const RETRIEVAL_OPTIONS = ["dense", "hybrid", "bm25"] as const;

function chunkingKey(c: BatchChunkingConfig): string {
  return `${c.strategy}:${c.chunk_size}/${c.chunk_overlap}`;
}

export interface DefineMatrixModalProps {
  workspaceId: string;
  goldenSets: Array<{ id: string; name: string; pair_count: number }>;
  onClose: () => void;
  onSubmit: (body: BatchRequest) => Promise<void>;
  presetsOverride?: PresetEntry[];
}

export function DefineMatrixModal({
  workspaceId: _workspaceId,
  goldenSets,
  onClose,
  onSubmit,
  presetsOverride,
}: DefineMatrixModalProps): JSX.Element {
  const [presets, setPresets] = useState<PresetEntry[]>(presetsOverride ?? []);
  const [embedders, setEmbedders] = useState<Set<string>>(new Set());
  const [chunkings, setChunkings] = useState<BatchChunkingConfig[]>([]);
  const [retrievals, setRetrievals] = useState<Set<string>>(new Set(["dense"]));
  const [evaluators, setEvaluators] = useState<Set<string>>(
    new Set(["faithfulness", "context_precision", "context_recall"]),
  );
  const [goldenId, setGoldenId] = useState(goldenSets[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (presetsOverride) return;
    api
      .systemPresets()
      .then((r) => setPresets(r.presets))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load presets"));
  }, [presetsOverride]);

  // Derive option lists from preset catalog. Each preset contributes its
  // embedder + chunking config; duplicates (same embedder id, same chunking
  // signature) collapse so the user doesn't see two checkboxes for them.
  const embedderOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; dim: number | null }> = [];
    for (const p of presets) {
      if (seen.has(p.config.embedder_id)) continue;
      seen.add(p.config.embedder_id);
      out.push({ id: p.config.embedder_id, dim: p.config.embedder_dim ?? null });
    }
    return out;
  }, [presets]);

  const chunkingOptions = useMemo(() => {
    const seen = new Map<string, BatchChunkingConfig>();
    for (const p of presets) {
      const c: BatchChunkingConfig = {
        strategy: p.config.chunking.strategy,
        chunk_size: p.config.chunking.chunk_size,
        chunk_overlap: p.config.chunking.chunk_overlap,
      };
      const k = chunkingKey(c);
      if (!seen.has(k)) seen.set(k, c);
    }
    return Array.from(seen.values());
  }, [presets]);

  const total =
    embedders.size * chunkings.length * retrievals.size * Math.max(1, evaluators.size);

  const canSubmit =
    !pending &&
    embedders.size > 0 &&
    chunkings.length > 0 &&
    retrievals.size > 0 &&
    evaluators.size > 0 &&
    goldenId !== "";

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        embedders: Array.from(embedders),
        chunkings,
        retrievals: Array.from(retrievals),
        evaluators: Array.from(evaluators),
        golden_set_id: goldenId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  const toggleSet = (set: Set<string>, setter: (s: Set<string>) => void) =>
    (id: string): void => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setter(next);
    };

  const toggleChunking = (c: BatchChunkingConfig): void => {
    const k = chunkingKey(c);
    setChunkings((prev) => {
      const idx = prev.findIndex((x) => chunkingKey(x) === k);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, c];
    });
  };

  return (
    <Modal
      title="Define matrix"
      width={620}
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            data-testid="define-matrix-submit"
            onClick={submit}
            disabled={!canSubmit}
          >
            Run batch ({total})
          </button>
        </>
      }
    >
      <div className="col gap-16" style={{ padding: 4 }}>
        {error && (
          <div
            className="card"
            style={{ padding: "10px 14px", borderColor: "var(--error)", color: "var(--error)" }}
          >
            <span className="t-12 t-mono">{error}</span>
          </div>
        )}

        <Section label="Embedders" hint="Which embedders to compare">
          {embedderOptions.length === 0 ? (
            <span className="t-12 t-meta">Loading presets…</span>
          ) : (
            <div className="row gap-8 f-wrap">
              {embedderOptions.map((opt) => (
                <Toggle
                  key={opt.id}
                  testId={`matrix-embedder-${opt.id}`}
                  on={embedders.has(opt.id)}
                  onClick={() => toggleSet(embedders, setEmbedders)(opt.id)}
                >
                  {opt.id}
                  {opt.dim ? ` · ${opt.dim}d` : ""}
                </Toggle>
              ))}
            </div>
          )}
        </Section>

        <Section label="Chunkings" hint="Each combination becomes a separate experiment">
          {chunkingOptions.length === 0 ? (
            <span className="t-12 t-meta">Loading presets…</span>
          ) : (
            <div className="row gap-8 f-wrap">
              {chunkingOptions.map((c) => {
                const k = chunkingKey(c);
                const on = chunkings.some((x) => chunkingKey(x) === k);
                return (
                  <Toggle
                    key={k}
                    testId={`matrix-chunking-${k}`}
                    on={on}
                    onClick={() => toggleChunking(c)}
                  >
                    {c.strategy} {c.chunk_size}/{c.chunk_overlap}
                  </Toggle>
                );
              })}
            </div>
          )}
        </Section>

        <Section label="Retrieval" hint="Vector strategy used to fetch chunks">
          <div className="row gap-8 f-wrap">
            {RETRIEVAL_OPTIONS.map((r) => (
              <Toggle
                key={r}
                testId={`matrix-retrieval-${r}`}
                on={retrievals.has(r)}
                onClick={() => toggleSet(retrievals, setRetrievals)(r)}
              >
                {r}
              </Toggle>
            ))}
          </div>
        </Section>

        <Section label="Evaluators" hint="RAGAS metrics to compute on each combo">
          <div className="row gap-8 f-wrap">
            {EVALUATORS.map((m) => (
              <Toggle
                key={m.id}
                testId={`matrix-eval-${m.id}`}
                on={evaluators.has(m.id)}
                onClick={() => toggleSet(evaluators, setEvaluators)(m.id)}
                title={m.note}
              >
                {m.label}
              </Toggle>
            ))}
          </div>
        </Section>

        <Section label="Golden set" hint="Pairs used to score every combo">
          {goldenSets.length === 0 ? (
            <span className="t-12" style={{ color: "var(--error)" }}>
              No golden set in this workspace yet — create one before running batch.
            </span>
          ) : (
            <select
              className="input"
              data-testid="matrix-golden-select"
              value={goldenId}
              onChange={(e) => setGoldenId(e.target.value)}
            >
              {goldenSets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.pair_count} pairs)
                </option>
              ))}
            </select>
          )}
        </Section>

        <div
          className="card"
          style={{
            padding: "12px 16px",
            background: "var(--bg-2)",
            borderColor: "var(--accent)",
          }}
        >
          <div className="row f-between f-center">
            <span className="t-label">Total runs</span>
            <span className="t-mono t-20" style={{ color: "var(--accent)" }} data-testid="matrix-total">
              {total}
            </span>
          </div>
          <span className="t-12 t-meta">
            {embedders.size} embedders × {chunkings.length} chunkings × {retrievals.size}{" "}
            retrievals × {evaluators.size} evaluators
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="col gap-6">
      <div className="row f-between f-center">
        <span className="t-label">{label}</span>
        {hint && <span className="t-12 t-meta">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
  title,
  testId,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      title={title}
      aria-pressed={on}
      className="btn btn-sm"
      style={{
        background: on ? "var(--bg-2)" : "var(--bg-0)",
        border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
        color: on ? "var(--accent)" : "var(--text-1)",
      }}
    >
      {children}
    </button>
  );
}
