/**
 * Chat surface — picks the most recent experiment in the active workspace
 * and posts questions against it. Retrieval-only mode shows a badge instead
 * of an answer panel (API_SPEC §9.1.1).
 */

import { useEffect, useState } from "react";
import {
  api,
  type ChatResponse,
  type ExperimentSummary,
} from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";

export function ChatView(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    api
      .listExperiments(workspaceId)
      .then((r) => {
        setExperiments(r.items);
        const first = r.items[0];
        if (first) setSelected(first.id);
      })
      .catch((e) => setError(String(e)));
  }, [workspaceId]);

  const ask = async (): Promise<void> => {
    if (!workspaceId || !selected || !question.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.chat(workspaceId, {
        experiment_id: selected,
        question,
      });
      setResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!workspaceId) {
    return <p>먼저 워크스페이스를 선택하세요.</p>;
  }

  return (
    <section className="chat">
      <h2>Chat</h2>
      <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
        <option value="" disabled>
          실험을 선택하세요
        </option>
        {experiments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.id.slice(0, 14)} — {e.config_fingerprint.slice(0, 8)}
          </option>
        ))}
      </select>

      <textarea
        rows={3}
        placeholder="질문을 입력하세요"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <button onClick={ask} disabled={loading || !selected || !question.trim()}>
        {loading ? "..." : "질문"}
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {response && (
        <article>
          {response.mode === "retrieval_only" && (
            <p>
              <strong>[검색 전용 모드]</strong> LLM이 설정되지 않아 답변 생성은 생략됩니다.
            </p>
          )}
          {response.answer && (
            <section>
              <h3>답변</h3>
              <p>{response.answer}</p>
            </section>
          )}
          <h3>참조한 청크 ({response.retrieval.chunks.length})</h3>
          <ul>
            {response.retrieval.chunks.map((c) => (
              <li key={c.chunk_id}>
                <small>
                  rank={c.rank} score={c.score.toFixed(3)} page={c.page ?? "?"}
                </small>
                <pre style={{ whiteSpace: "pre-wrap" }}>{c.content.slice(0, 240)}</pre>
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}
