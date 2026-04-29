/**
 * Experiment matrix view — lists all experiments in the active workspace
 * with their RAGAS scores side by side. Recharts renders a grouped bar
 * chart so the user can A/B compare configurations at a glance.
 */

import { useEffect, useState } from "react";
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

const METRICS = [
  "faithfulness",
  "answer_relevance",
  "context_precision",
  "context_recall",
] as const;

export function ExperimentMatrix(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .listExperiments(workspaceId)
      .then((r) => setExperiments(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [workspaceId]);

  if (!workspaceId) return <p>워크스페이스를 먼저 선택하세요.</p>;

  // Pivot for Recharts: one row per metric, one bar per experiment.
  const chartData = METRICS.map((metric) => {
    const row: Record<string, number | string> = { metric };
    experiments.forEach((exp) => {
      const value = exp.scores[metric];
      if (value !== null) row[exp.id.slice(0, 10)] = value;
    });
    return row;
  });

  const palette = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <section className="experiment-matrix">
      <h2>Experiments</h2>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Experiment</th>
            <th>Status</th>
            <th>Fingerprint</th>
            {METRICS.map((m) => (
              <th key={m}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {experiments.map((e) => (
            <tr key={e.id}>
              <td>{e.id.slice(0, 14)}</td>
              <td>{e.status}</td>
              <td>{e.config_fingerprint.slice(0, 8)}</td>
              {METRICS.map((m) => (
                <td key={m}>{e.scores[m]?.toFixed(3) ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {experiments.length > 0 && (
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="metric" />
              <YAxis domain={[0, 1]} />
              <Tooltip />
              <Legend />
              {experiments.map((exp, idx) => (
                <Bar
                  key={exp.id}
                  dataKey={exp.id.slice(0, 10)}
                  fill={palette[idx % palette.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
