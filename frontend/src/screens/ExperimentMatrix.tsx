/**
 * Experiment matrix view — sortable list of all experiments in the active
 * workspace with their RAGAS scores. The Recharts grouped bar chart below
 * supports A/B comparison at a glance.
 */

import { useEffect, useMemo, useState } from "react";
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
import { api, type ExperimentSummary } from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { PageHeader, ScoreCell } from "../components/ui";

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

  useEffect(() => {
    if (!workspaceId) return;
    api
      .listExperiments(workspaceId)
      .then((r) => setExperiments(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [workspaceId]);

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
                  style={{ borderBottom: "1px solid var(--border)" }}
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

      {sorted.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 20 }}>
          <div className="row f-between f-center" style={{ marginBottom: 12 }}>
            <span className="t-label">A / B Compare</span>
            <span className="t-12 t-meta">top 5 by sort order</span>
          </div>
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
