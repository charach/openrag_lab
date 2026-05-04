/**
 * Experiment matrix view — sortable list of all experiments in the active
 * workspace with their RAGAS scores. The Recharts grouped bar chart below
 * supports A/B comparison at a glance.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWebSocket, type WSMessage } from "../hooks/useWebSocket";
import { Icon, Modal } from "../components/ui";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  type ExperimentDetail,
  type ExperimentSummary,
  type PresetResponse,
  type WorkspaceConfig,
} from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { useIndexingStore } from "../stores/indexing";
import { Drawer, PageHeader, ScoreCell } from "../components/ui";

type PresetEntry = PresetResponse["presets"][number];
type Strategy = "recursive" | "fixed";

const METRICS = [
  "faithfulness",
  "answer_relevance",
  "context_precision",
  "context_recall",
] as const;
type Metric = (typeof METRICS)[number];
type SortKey = "started_at" | Metric;

export function ExperimentMatrix(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("started_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openExp, setOpenExp] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [evalExp, setEvalExp] = useState<string | null>(null);
  const [goldenSets, setGoldenSets] = useState<Array<{ id: string; name: string; pair_count: number }>>([]);
  const [evalGoldenId, setEvalGoldenId] = useState<string>("");
  const [evalTopic, setEvalTopic] = useState<string | null>(null);
  const [evalStatus, setEvalStatus] = useState<string>("");
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId || !openExp) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    api
      .getExperiment(workspaceId, openExp)
      .then(setDetail)
      .catch((e) => setDetailError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDetailLoading(false));
  }, [workspaceId, openExp]);

  const refreshExperiments = async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const r = await api.listExperiments(workspaceId);
      setExperiments(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refreshExperiments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !evalExp) return;
    api
      .listGoldenSets(workspaceId)
      .then((r) => {
        setGoldenSets(r.items);
        setEvalGoldenId(r.items[0]?.id ?? "");
      })
      .catch((e) => setEvalError(e instanceof Error ? e.message : String(e)));
  }, [workspaceId, evalExp]);

  const handleEvalMessage = (msg: WSMessage): void => {
    if (msg.type === "started") {
      setEvalStatus(`Started — ${msg.total_pairs ?? "?"} pairs`);
    } else if (msg.type === "progress") {
      setEvalStatus(`Progress — ${msg.completed ?? "?"} / ${msg.total ?? "?"}`);
    } else if (msg.type === "completed") {
      setEvalStatus("Completed.");
      setEvalBusy(false);
      setEvalTopic(null);
      refreshExperiments();
      if (openExp && workspaceId) {
        api.getExperiment(workspaceId, openExp).then(setDetail).catch(() => {});
      }
    } else if (msg.type === "failed" || msg.type === "error") {
      setEvalError(typeof msg.message === "string" ? msg.message : "Evaluation failed.");
      setEvalBusy(false);
      setEvalTopic(null);
    }
  };

  useWebSocket({
    topics: evalTopic ? [evalTopic] : [],
    enabled: evalTopic !== null,
    onMessage: handleEvalMessage,
  });

  const submitEvaluate = async (): Promise<void> => {
    if (!workspaceId || !evalExp || !evalGoldenId) return;
    setEvalBusy(true);
    setEvalError(null);
    setEvalStatus("Submitting…");
    try {
      const r = await api.evaluateExperiment(workspaceId, evalExp, {
        golden_set_id: evalGoldenId,
      });
      setEvalTopic(r.websocket_topic);
      setEvalStatus(`Queued — task ${r.task_id.slice(0, 8)}`);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : String(e));
      setEvalBusy(false);
    }
  };

  const closeEvalModal = (): void => {
    if (evalBusy) return;
    setEvalExp(null);
    setEvalGoldenId("");
    setEvalTopic(null);
    setEvalStatus("");
    setEvalError(null);
  };

  const sorted = useMemo(() => {
    const rows = [...experiments];
    rows.sort((a, b) => {
      const av =
        sortKey === "started_at" ? Date.parse(a.started_at) : (a.scores[sortKey] ?? -1);
      const bv =
        sortKey === "started_at" ? Date.parse(b.started_at) : (b.scores[sortKey] ?? -1);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [experiments, sortKey, sortDir]);

  const onSort = (k: SortKey): void => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  if (!workspaceId)
    return (
      <section className="page">
        <p className="t-meta">워크스페이스를 먼저 선택하세요.</p>
      </section>
    );

  const chartData = METRICS.map((metric) => {
    const row: Record<string, number | string> = { metric };
    sorted.slice(0, 5).forEach((exp) => {
      const value = exp.scores[metric];
      if (value !== null) row[exp.id.slice(0, 10)] = value;
    });
    return row;
  });

  return (
    <section className="page">
      <PageHeader
        eyebrow="Experiments"
        title="Compare runs side by side."
        sub="모든 실험의 구성 지문(fingerprint)과 RAGAS 점수를 한눈에 비교합니다."
        right={
          <Link to="/golden-sets" className="btn btn-sm">
            Golden sets →
          </Link>
        }
      />

      {error && (
        <div
          className="card"
          style={{
            padding: "10px 14px",
            marginTop: 24,
            borderColor: "var(--error)",
            color: "var(--error)",
          }}
        >
          <span className="t-12 t-mono">{error}</span>
        </div>
      )}

      <NewExperimentPanel
        workspaceId={workspaceId}
        onLaunched={refreshExperiments}
      />

      <div className="card" style={{ marginTop: 32, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th label="Experiment" />
              <Th label="Status" />
              <Th label="Fingerprint" />
              <Th
                label="started"
                sortable
                active={sortKey === "started_at"}
                dir={sortDir}
                onClick={() => onSort("started_at")}
                align="right"
              />
              {METRICS.map((m) => (
                <Th
                  key={m}
                  label={m}
                  sortable
                  active={sortKey === m}
                  dir={sortDir}
                  onClick={() => onSort(m)}
                  align="right"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={3 + 1 + METRICS.length} style={{ padding: 24 }}>
                  <p className="t-meta t-13">아직 실험이 없습니다.</p>
                </td>
              </tr>
            ) : (
              sorted.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setOpenExp(e.id)}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    background: openExp === e.id ? "var(--bg-2)" : undefined,
                  }}
                >
                  <Td>
                    <span className="t-13">{e.id.slice(0, 14)}</span>
                  </Td>
                  <Td>
                    <span className="chip" style={{ color: statusColor(e.status) }}>
                      <span className="dot" style={{ background: statusColor(e.status) }}></span>
                      {e.status}
                    </span>
                  </Td>
                  <Td>
                    <span className="t-mono t-12 t-meta">
                      {e.config_fingerprint.slice(0, 12)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="t-mono t-12 t-meta">
                      {formatDate(e.started_at)}
                    </span>
                  </Td>
                  {METRICS.map((m) => (
                    <Td key={m} align="right">
                      <ScoreCell value={e.scores[m]} />
                    </Td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {openExp && (
        <Drawer
          title={`Experiment ${openExp.slice(0, 14)}`}
          onClose={() => setOpenExp(null)}
        >
          {detailLoading && <p className="t-meta t-13">Loading…</p>}
          {detailError && (
            <p style={{ color: "var(--error)" }} className="t-12">
              {detailError}
            </p>
          )}
          {detail && (
            <>
              <div className="row gap-8" style={{ marginBottom: 16 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setEvalExp(openExp)}
                >
                  Evaluate with golden set
                </button>
              </div>
              <DetailBody detail={detail} />
            </>
          )}
        </Drawer>
      )}

      {evalExp && (
        <Modal
          title={`Evaluate ${evalExp.slice(0, 14)}`}
          onClose={closeEvalModal}
          footer={
            <>
              <button className="btn" onClick={closeEvalModal} disabled={evalBusy}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={submitEvaluate}
                disabled={evalBusy || !evalGoldenId}
              >
                {evalBusy ? "Running…" : "Run"}
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            Golden set
          </label>
          {goldenSets.length === 0 ? (
            <p className="t-meta t-13">
              No golden sets in this workspace. <Link to="/golden-sets">Create one →</Link>
            </p>
          ) : (
            <select
              className="input"
              value={evalGoldenId}
              onChange={(e) => setEvalGoldenId(e.target.value)}
              disabled={evalBusy}
            >
              {goldenSets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.pair_count} pairs)
                </option>
              ))}
            </select>
          )}
          {evalStatus && (
            <p className="t-12 t-meta" style={{ marginTop: 12 }} role="status">
              {evalStatus}
            </p>
          )}
          {evalError && (
            <p className="t-12" style={{ color: "var(--error)", marginTop: 12 }}>
              {evalError}
            </p>
          )}
        </Modal>
      )}

      {sorted.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 20 }}>
          <div className="row f-between f-center" style={{ marginBottom: 12 }}>
            <span className="t-label">A / B Compare</span>
            <span className="t-12 t-meta">top 5 by sort order</span>
          </div>
          <GoldenSetPreview workspaceId={workspaceId} />
          <div style={{ height: 1, background: "var(--border)", margin: "16px 0" }}></div>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="metric"
                  stroke="var(--text-2)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  fontSize={11}
                />
                <YAxis
                  domain={[0, 1]}
                  stroke="var(--text-2)"
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-1)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 0,
                    fontSize: 12,
                  }}
                  cursor={{ fill: "var(--accent-faint)" }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: "var(--text-1)" }}
                  iconType="square"
                />
                {sorted.slice(0, 5).map((exp, idx) => (
                  <Bar
                    key={exp.id}
                    dataKey={exp.id.slice(0, 10)}
                    fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}

function DetailBody({ detail }: { detail: ExperimentDetail }): JSX.Element {
  return (
    <div className="col gap-20">
      <div className="col gap-8">
        <span className="t-label">Status</span>
        <span className="chip" style={{ color: statusColor(detail.status) }}>
          <span className="dot" style={{ background: statusColor(detail.status) }}></span>
          {detail.status}
        </span>
      </div>
      <div className="col gap-8">
        <span className="t-label">Fingerprint</span>
        <span className="t-mono t-12 t-meta" style={{ wordBreak: "break-all" }}>
          {detail.config_fingerprint}
        </span>
      </div>
      <div className="col gap-8">
        <span className="t-label">Config</span>
        <div
          className="t-mono t-12"
          style={{
            padding: 12,
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            color: "var(--text-1)",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 16,
            rowGap: 4,
          }}
        >
          <span className="t-meta">embedder</span>
          <span>{detail.config.embedder_id}</span>
          <span className="t-meta">retrieval</span>
          <span>{detail.config.retrieval_strategy}</span>
          <span className="t-meta">top_k</span>
          <span>{detail.config.top_k}</span>
          <span className="t-meta">llm</span>
          <span>{detail.config.llm_id ?? "—"}</span>
          <span className="t-meta">strategy</span>
          <span>{detail.config.chunking.strategy}</span>
          <span className="t-meta">chunk_size</span>
          <span>{detail.config.chunking.chunk_size}</span>
          <span className="t-meta">chunk_overlap</span>
          <span>{detail.config.chunking.chunk_overlap}</span>
        </div>
      </div>
      <div className="col gap-8">
        <span className="t-label">Scores</span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          {(
            [
              "faithfulness",
              "answer_relevance",
              "context_precision",
              "context_recall",
            ] as const
          ).map((m) => (
            <div
              key={m}
              className="card"
              style={{
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="t-12 t-meta">{m}</span>
              <ScoreCell value={detail.scores[m]} />
            </div>
          ))}
        </div>
      </div>
      <div className="col gap-8">
        <span className="t-label">Performance</span>
        <div
          className="t-mono t-12"
          style={{
            padding: 12,
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            color: "var(--text-1)",
          }}
        >
          <div className="row f-between">
            <span className="t-meta">total_latency_ms</span>
            <span>{detail.profile.total_latency_ms}</span>
          </div>
          {Object.entries(detail.profile.stages).map(([stage, ms]) => (
            <div key={stage} className="row f-between">
              <span className="t-meta">{stage}</span>
              <span>{ms}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * New experiment panel — defines a config and dispatches an indexing job.
 * Seeds from the workspace's latest config so users only tweak deltas;
 * falls back to the recommended preset when the workspace has no runs yet.
 */
function NewExperimentPanel({
  workspaceId,
  onLaunched,
}: {
  workspaceId: string;
  onLaunched: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const indexing = useIndexingStore();
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [seed, setSeed] = useState<WorkspaceConfig | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("recursive");
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(64);
  const [topK, setTopK] = useState(5);
  const [embedderId, setEmbedderId] = useState<string>("");
  const [retrieval, setRetrieval] = useState<string>("dense");
  const [llmId, setLlmId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.systemPresets().then((r) => setPresets(r.presets)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .getWorkspace(workspaceId)
      .then((r) => {
        const cfg = r.config;
        setSeed(cfg);
        if (cfg.embedder_id) {
          setEmbedderId(cfg.embedder_id);
          setRetrieval(cfg.retrieval_strategy);
          setTopK(cfg.top_k);
          setLlmId(cfg.llm_id);
          setStrategy((cfg.chunking.strategy ?? "recursive") as Strategy);
          if (cfg.chunking.chunk_size) setChunkSize(cfg.chunking.chunk_size);
          if (cfg.chunking.chunk_overlap !== undefined) setChunkOverlap(cfg.chunking.chunk_overlap);
        }
      })
      .catch(() => undefined);
  }, [workspaceId]);

  // When workspace has no config but we have presets, fall back to recommended.
  useEffect(() => {
    if (seed?.embedder_id) return;
    const rec = presets.find((p) => p.recommended) ?? presets[0];
    if (rec) {
      setEmbedderId(rec.config.embedder_id);
      setRetrieval(rec.config.retrieval_strategy);
      setTopK(rec.config.top_k);
      setLlmId(rec.config.llm_id);
      setStrategy(rec.config.chunking.strategy as Strategy);
      setChunkSize(rec.config.chunking.chunk_size);
      setChunkOverlap(rec.config.chunking.chunk_overlap);
    }
  }, [presets, seed]);

  const launch = async (): Promise<void> => {
    if (!workspaceId || !embedderId) return;
    setSubmitting(true);
    setErr(null);
    try {
      indexing.startStarting(workspaceId);
      const accepted = await api.startIndex(workspaceId, {
        config: {
          embedder_id: embedderId,
          chunking: { strategy, chunk_size: chunkSize, chunk_overlap: chunkOverlap },
          retrieval_strategy: retrieval,
          top_k: topK,
          llm_id: llmId,
        },
        force_reindex: true,
      });
      indexing.setTask(accepted);
      onLaunched();
      navigate("/");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      indexing.markError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const ready = embedderId.length > 0 && chunkSize >= 32 && topK >= 1;

  // The catalog is derived from system presets — every preset advertises a
  // tested combo, so the union is exactly the set of values the backend
  // is known to accept. Custom values can still be typed by switching to
  // the "(custom)" option, which leaves the input open.
  const embedderOptions = uniqueValues(presets.map((p) => p.config.embedder_id));
  const retrievalOptions = uniqueValues(presets.map((p) => p.config.retrieval_strategy));
  const llmOptions = uniqueValues(
    presets.map((p) => p.config.llm_id).filter((x): x is string => Boolean(x)),
  );

  return (
    <div className="card" style={{ padding: 20, marginTop: 24 }}>
      <div className="row f-between f-center" style={{ marginBottom: 14 }}>
        <span className="t-label">Define new experiment</span>
        <span className="t-12 t-meta">현재 워크스페이스 최신 설정에서 시작합니다.</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        <Field label="embedder">
          <CatalogSelect
            value={embedderId}
            options={embedderOptions}
            onChange={setEmbedderId}
            placeholder="select an embedder"
          />
        </Field>
        <Field label="strategy">
          <div className="row gap-6">
            {(["recursive", "fixed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className="btn btn-sm"
                onClick={() => setStrategy(s)}
                style={{
                  borderColor: strategy === s ? "var(--accent)" : undefined,
                  color: strategy === s ? "var(--accent)" : "var(--text-1)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="retrieval">
          <CatalogSelect
            value={retrieval}
            options={retrievalOptions}
            onChange={setRetrieval}
            placeholder="select a strategy"
          />
        </Field>
        <Field label={`chunk_size · ${chunkSize}`}>
          <input
            type="range"
            className="range"
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
        </Field>
        <Field label={`chunk_overlap · ${chunkOverlap}`}>
          <input
            type="range"
            className="range"
            min={0}
            max={Math.floor(chunkSize / 2)}
            step={8}
            value={chunkOverlap}
            onChange={(e) => setChunkOverlap(Number(e.target.value))}
          />
        </Field>
        <Field label={`top_k · ${topK}`}>
          <input
            type="range"
            className="range"
            min={1}
            max={20}
            step={1}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
          />
        </Field>
        <Field
          label="llm"
          aside={
            <Link to="/providers" className="t-12" style={{ color: "var(--accent)" }}>
              Manage →
            </Link>
          }
        >
          <CatalogSelect
            value={llmId ?? ""}
            options={llmOptions}
            onChange={(v) => setLlmId(v || null)}
            placeholder="(retrieval-only)"
            allowEmpty
            emptyLabel="(retrieval-only)"
          />
        </Field>
      </div>
      <div className="row f-between f-center" style={{ marginTop: 16 }}>
        <span className="t-12 t-meta">
          {err ? <span style={{ color: "var(--error)" }}>{err}</span> : "동일 fingerprint 면 캐시된 인덱스를 재사용합니다."}
        </span>
        <button
          className="btn btn-primary"
          onClick={launch}
          disabled={!ready || submitting}
        >
          <Icon name="play" size={12} /> {submitting ? "Starting…" : "Run experiment"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  aside,
}: {
  label: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="col gap-6">
      <div className="row f-between f-center">
        <span className="t-label">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

const CUSTOM_SENTINEL = "__custom__";

/**
 * Select-with-fallback for catalog values that are usually one of N
 * preset options but occasionally need a hand-typed override (e.g.
 * trying a new embedder before it's added to a preset). Picking
 * "(custom)" reveals a free-form input next to the dropdown.
 */
export function CatalogSelect({
  value,
  options,
  onChange,
  placeholder,
  allowEmpty,
  emptyLabel,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}): JSX.Element {
  const inCatalog = value === "" || options.includes(value);
  const selectValue = value === ""
    ? ""
    : inCatalog
      ? value
      : CUSTOM_SENTINEL;
  return (
    <div className="row gap-6 f-center">
      <select
        className="select"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_SENTINEL) {
            // Keep the existing custom value (or empty) so the user can
            // start typing without losing what was already entered.
            onChange(value === "" || options.includes(value) ? "" : value);
            return;
          }
          onChange(v);
        }}
        style={{ flex: 1, minWidth: 0 }}
      >
        {allowEmpty && <option value="">{emptyLabel ?? placeholder ?? "—"}</option>}
        {!allowEmpty && value === "" && (
          <option value="" disabled>
            {placeholder ?? "select…"}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>(custom)</option>
      </select>
      {!inCatalog && (
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0 }}
        />
      )}
    </div>
  );
}

export function uniqueValues(xs: string[]): string[] {
  return Array.from(new Set(xs.filter((s) => s.length > 0)));
}

const CHART_PALETTE = ["#C8A96A", "#7A8B6F", "#B8B2A4", "#6E6A60", "#3A3A3A"];

function statusColor(status: string): string {
  if (status === "completed") return "var(--success)";
  if (status === "failed") return "var(--error)";
  if (status === "running" || status === "queued") return "var(--accent)";
  return "var(--text-2)";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function Th({
  label,
  sortable,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  sortable?: boolean;
  active?: boolean;
  dir?: "asc" | "desc";
  onClick?: () => void;
  align?: "right" | "left";
}): JSX.Element {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      style={{
        padding: "12px 16px",
        textAlign: align ?? "left",
        cursor: sortable ? "pointer" : "default",
        fontWeight: 400,
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: active ? "var(--accent)" : "var(--text-2)",
        userSelect: "none",
      }}
    >
      {label}
      {sortable && active ? <span style={{ marginLeft: 6 }}>{dir === "asc" ? "↑" : "↓"}</span> : null}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}): JSX.Element {
  return (
    <td style={{ padding: "12px 16px", textAlign: align ?? "left", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}

interface GoldenPair {
  id: string;
  question: string;
  expected_answer: string | null;
  expected_chunk_ids: string[];
}

/**
 * In-line preview of the workspace's golden Q/A pairs so users can read
 * the exact questions and expected answers that drive the RAGAS scores
 * shown above. Full CRUD lives on /golden-sets — this panel is read-only
 * with a quick "edit" link, so the comparison view stays focused.
 */
function GoldenSetPreview({ workspaceId }: { workspaceId: string }): JSX.Element {
  const [sets, setSets] = useState<Array<{ id: string; name: string; pair_count: number }>>([]);
  const [setId, setSetId] = useState<string>("");
  const [pairs, setPairs] = useState<GoldenPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .listGoldenSets(workspaceId)
      .then((r) => {
        setSets(r.items);
        setSetId(r.items[0]?.id ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !setId) {
      setPairs([]);
      return;
    }
    setLoading(true);
    api
      .listGoldenPairs(workspaceId, setId)
      .then((r) => {
        setPairs(r.items);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [workspaceId, setId]);

  return (
    <div className="col gap-10">
      <div className="row f-between f-center">
        <div className="row gap-10 f-center">
          <span className="t-label">Golden set in use</span>
          {sets.length > 0 ? (
            <select
              className="select"
              value={setId}
              onChange={(e) => setSetId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              {sets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.pair_count} pairs)
                </option>
              ))}
            </select>
          ) : (
            <span className="t-12 t-meta">없음 — 골든셋을 먼저 만들어 두세요.</span>
          )}
        </div>
        <Link to="/golden-sets" className="btn btn-sm">
          Edit in Golden sets →
        </Link>
      </div>
      {error && (
        <span className="t-12" style={{ color: "var(--error)" }}>
          {error}
        </span>
      )}
      {loading && <span className="t-12 t-meta">Loading pairs…</span>}
      {!loading && pairs.length === 0 && setId && (
        <span className="t-12 t-meta">선택한 골든셋에 Q/A 페어가 없습니다.</span>
      )}
      {pairs.length > 0 && (
        <div
          className="col"
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-0)",
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {pairs.slice(0, 5).map((p, idx) => (
            <div
              key={p.id}
              style={{
                padding: "10px 12px",
                borderBottom: idx < Math.min(pairs.length, 5) - 1 ? "1px solid var(--border)" : 0,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div className="col gap-3">
                <span className="t-label" style={{ fontSize: 9 }}>
                  Question
                </span>
                <span className="t-13" style={{ lineHeight: 1.5 }}>
                  {p.question}
                </span>
              </div>
              <div className="col gap-3">
                <span className="t-label" style={{ fontSize: 9 }}>
                  Expected answer
                </span>
                <span className="t-13 t-meta" style={{ lineHeight: 1.5 }}>
                  {p.expected_answer ?? "—"}
                </span>
              </div>
            </div>
          ))}
          {pairs.length > 5 && (
            <span className="t-12 t-meta" style={{ padding: "8px 12px" }}>
              +{pairs.length - 5} more pairs · open Golden sets to view all
            </span>
          )}
        </div>
      )}
    </div>
  );
}
