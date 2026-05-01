/**
 * Chat surface — pick an experiment from the rail, ask a question, and see
 * retrieved chunks side-by-side with the answer (or just the chunks when the
 * experiment is in retrieval-only mode, API_SPEC §9.1.1).
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { api, type ChatResponse, type ExperimentSummary } from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, PageHeader, RetrievalOnlyBadge } from "../components/ui";

export function ChatView(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeChunk, setActiveChunk] = useState<string | null>(null);

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
    setActiveChunk(null);
    try {
      const res = await api.chat(workspaceId, { experiment_id: selected, question });
      setResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  };

  if (!workspaceId)
    return (
      <section className="page">
        <p className="t-meta">먼저 워크스페이스를 선택하세요.</p>
      </section>
    );

  return (
    <section className="page" style={{ maxWidth: 1280 }}>
      <PageHeader eyebrow="Chat" title="Ask the corpus." sub="실험을 선택해 그 실험의 인덱스로 질문하세요." />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr 360px",
          gap: 20,
          marginTop: 32,
          minHeight: 480,
        }}
      >
        <ExperimentRail
          experiments={experiments}
          selected={selected}
          onSelect={setSelected}
        />

        <div className="col gap-16">
          <div className="card col gap-12" style={{ padding: 16 }}>
            <textarea
              className="input"
              rows={3}
              placeholder="질문을 입력하세요. ⌘/Ctrl + Enter 로 전송."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="row f-between f-center">
              <span className="t-12 t-meta">
                {response?.mode === "retrieval_only" ? (
                  <RetrievalOnlyBadge />
                ) : (
                  <>local generation</>
                )}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={ask}
                disabled={loading || !selected || !question.trim()}
              >
                {loading ? "Asking…" : "Ask"}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="card"
              style={{ padding: "10px 14px", borderColor: "var(--error)", color: "var(--error)" }}
            >
              <span className="t-12 t-mono">{error}</span>
            </div>
          )}

          {response && (
            <AnswerCard
              response={response}
              activeChunk={activeChunk}
              setActiveChunk={setActiveChunk}
            />
          )}
        </div>

        <RetrievalRail
          response={response}
          activeChunk={activeChunk}
          setActiveChunk={setActiveChunk}
        />
      </div>
    </section>
  );
}

function ExperimentRail({
  experiments,
  selected,
  onSelect,
}: {
  experiments: ExperimentSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <aside className="card col" style={{ padding: 0, height: "fit-content" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span className="t-label">Experiments</span>
      </div>
      {experiments.length === 0 ? (
        <p className="t-12 t-meta" style={{ padding: 16 }}>
          실험이 아직 없습니다. Auto-Pilot에서 인덱싱을 마치면 여기에 표시됩니다.
        </p>
      ) : (
        experiments.map((e) => {
          const active = e.id === selected;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              style={{
                textAlign: "left",
                padding: "12px 16px",
                border: 0,
                borderBottom: "1px solid var(--border)",
                borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                background: active ? "var(--bg-2)" : "transparent",
                color: "var(--text-0)",
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span className="t-13">{e.id.slice(0, 14)}</span>
              <span className="t-mono t-12 t-meta">
                fp {e.config_fingerprint.slice(0, 8)} · {e.status}
              </span>
            </button>
          );
        })
      )}
    </aside>
  );
}

function AnswerCard({
  response,
  activeChunk,
  setActiveChunk,
}: {
  response: ChatResponse;
  activeChunk: string | null;
  setActiveChunk: (id: string | null) => void;
}): JSX.Element {
  const isRetrievalOnly = response.mode === "retrieval_only";
  return (
    <article className="card col gap-12" style={{ padding: 20 }}>
      {isRetrievalOnly ? (
        <div className="row gap-12 f-center">
          <RetrievalOnlyBadge size="lg" />
          <span className="t-13 t-dim">
            LLM이 설정되지 않아 답변 생성은 생략됩니다. 검색된 청크만 표시됩니다.
          </span>
        </div>
      ) : response.answer ? (
        <p className="t-14" style={{ margin: 0, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
          {response.answer}
        </p>
      ) : (
        <p className="t-meta t-13">No answer.</p>
      )}

      <div className="row f-between f-center" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span className="t-12 t-meta t-mono">
          turn {response.turn_id.slice(0, 10)} · {response.retrieval.latency_ms} ms
        </span>
        <span className="t-12 t-meta">
          {response.retrieval.chunks.length} chunks retrieved
        </span>
      </div>

      {!isRetrievalOnly && response.retrieval.chunks.length > 0 && (
        <div className="col gap-6">
          <span className="t-label">Citations</span>
          <div className="row gap-6 f-wrap">
            {response.retrieval.chunks.map((c) => (
              <button
                key={c.chunk_id}
                onClick={() => setActiveChunk(activeChunk === c.chunk_id ? null : c.chunk_id)}
                className="chip chip-mono"
                style={{
                  cursor: "pointer",
                  borderColor: activeChunk === c.chunk_id ? "var(--accent)" : undefined,
                  color: activeChunk === c.chunk_id ? "var(--accent)" : undefined,
                }}
              >
                #{c.rank}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function RetrievalRail({
  response,
  activeChunk,
  setActiveChunk,
}: {
  response: ChatResponse | null;
  activeChunk: string | null;
  setActiveChunk: (id: string | null) => void;
}): JSX.Element {
  return (
    <aside className="card col" style={{ padding: 0 }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Icon name="search" size={12} color="var(--text-2)" />
        <span className="t-label">Retrieved chunks</span>
      </div>
      {!response || response.retrieval.chunks.length === 0 ? (
        <p className="t-12 t-meta" style={{ padding: 16 }}>
          질문을 보내면 여기에 검색된 청크가 표시됩니다.
        </p>
      ) : (
        response.retrieval.chunks.map((c) => {
          const active = c.chunk_id === activeChunk;
          return (
            <button
              key={c.chunk_id}
              onClick={() => setActiveChunk(active ? null : c.chunk_id)}
              style={{
                textAlign: "left",
                border: 0,
                borderBottom: "1px solid var(--border)",
                borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                background: active ? "var(--bg-2)" : "transparent",
                padding: "12px 16px",
                color: "var(--text-0)",
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div className="row f-between f-center">
                <span className="t-mono t-12 t-meta">
                  #{c.rank} · score {c.score.toFixed(3)}
                </span>
                <span className="t-12 t-meta">
                  {c.page !== null ? `p.${c.page}` : "—"}
                </span>
              </div>
              <span className="t-13" style={{ lineHeight: 1.5 }}>
                {c.content.length > 220 ? `${c.content.slice(0, 220)}…` : c.content}
              </span>
            </button>
          );
        })
      )}
    </aside>
  );
}
