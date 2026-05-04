/**
 * Chat surface — pick an experiment from the rail, ask a question, and see
 * retrieved chunks side-by-side with the answer (or just the chunks when the
 * experiment is in retrieval-only mode, API_SPEC §9.1.1).
 *
 * Turns persist server-side (5.4); selecting an experiment loads recent
 * history. Per-turn delete + regenerate are wired to /turns endpoints.
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type ChatChunk,
  type ChatTurnRecord,
  type ExperimentSummary,
} from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, Modal, PageHeader, RetrievalOnlyBadge } from "../components/ui";

/**
 * Cosine similarity is reported in [-1, 1]; negative values mean "essentially
 * unrelated" and confuse non-experts when shown as a -0.564 score. Clamp to
 * [0, 1] for the displayed relevance number.
 */
export function normalizeScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

type TurnView = ChatTurnRecord & { _pending?: boolean };

export function ChatView(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<TurnView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeChunk, setActiveChunk] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TurnView | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (!workspaceId || !selected) {
      setHistory([]);
      return;
    }
    api
      .listTurns(workspaceId, selected)
      .then((r) => {
        const ordered = [...r.items].sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
        );
        setHistory(ordered);
        setActiveChunk(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [workspaceId, selected]);

  const ask = async (overrideQuestion?: string): Promise<void> => {
    if (!workspaceId || !selected) return;
    const q = (overrideQuestion ?? question).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setActiveChunk(null);
    try {
      const res = await api.chat(workspaceId, { experiment_id: selected, question: q });
      const turn: TurnView = {
        id: res.turn_id,
        experiment_id: selected,
        question: q,
        answer: res.answer,
        citations: res.citations ?? [],
        chunks: res.retrieval.chunks,
        latency_ms: res.retrieval.latency_ms,
        tokens: 0,
        created_at: new Date().toISOString(),
      };
      setHistory((prev) => [...prev, turn]);
      if (overrideQuestion === undefined) setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const submitDelete = async (): Promise<void> => {
    if (!workspaceId || !confirmDelete) return;
    setBusy(true);
    try {
      await api.deleteTurn(workspaceId, confirmDelete.id);
      setHistory((prev) => prev.filter((t) => t.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (turn: TurnView): Promise<void> => {
    await ask(turn.question);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  };

  const lastAnswer = history.length > 0 ? history[history.length - 1] ?? null : null;
  const lastChunks = lastAnswer?.chunks ?? [];

  if (!workspaceId)
    return (
      <section className="page">
        <p className="t-meta">먼저 워크스페이스를 선택하세요.</p>
      </section>
    );

  return (
    <section className="page" style={{ maxWidth: 1280 }}>
      <PageHeader
        eyebrow="Chat"
        title="Ask the corpus."
        sub="실험을 선택해 그 실험의 인덱스로 질문하세요. 대화는 자동 저장됩니다."
        right={
          <Link to="/providers" className="btn btn-sm" title="외부 LLM 제공자 키 관리">
            <Icon name="lock" size={11} /> LLM providers
          </Link>
        }
      />

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
          {error && (
            <div
              className="card"
              style={{ padding: "10px 14px", borderColor: "var(--error)", color: "var(--error)" }}
            >
              <span className="t-12 t-mono">{error}</span>
            </div>
          )}

          {history.length > 0 && (
            <div className="col gap-12">
              {history.map((t) => (
                <TurnCard
                  key={t.id}
                  turn={t}
                  onDelete={() => setConfirmDelete(t)}
                  onRegenerate={() => regenerate(t)}
                  regenerating={loading}
                  activeChunk={activeChunk}
                  setActiveChunk={setActiveChunk}
                />
              ))}
            </div>
          )}

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
                {lastAnswer?.answer === null ? <RetrievalOnlyBadge /> : <>local generation</>}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => ask()}
                disabled={loading || !selected || !question.trim()}
              >
                {loading ? "Asking…" : "Ask"}
              </button>
            </div>
          </div>
        </div>

        <RetrievalRail
          chunks={lastChunks}
          activeChunk={activeChunk}
          setActiveChunk={setActiveChunk}
        />
      </div>

      {confirmDelete && (
        <Modal
          title="Delete turn"
          onClose={() => {
            if (!busy) setConfirmDelete(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setConfirmDelete(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={submitDelete}
                disabled={busy}
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="t-14">이 턴을 삭제합니다. 같은 질문을 다시 보내고 싶다면 regenerate 버튼을 사용하세요.</p>
        </Modal>
      )}
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

function TurnCard({
  turn,
  onDelete,
  onRegenerate,
  regenerating,
  activeChunk,
  setActiveChunk,
}: {
  turn: TurnView;
  onDelete: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  activeChunk: string | null;
  setActiveChunk: (id: string | null) => void;
}): JSX.Element {
  const isRetrievalOnly = turn.answer === null;
  return (
    <article className="card col gap-12" style={{ padding: 20 }}>
      <div className="row f-between f-center">
        <span className="t-label">Question</span>
        <div className="row gap-4">
          <button
            className="btn-ghost"
            onClick={onRegenerate}
            disabled={regenerating}
            title="Re-run with the same question"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              padding: 4,
              color: "var(--text-2)",
            }}
            aria-label="regenerate"
          >
            <Icon name="play" size={11} />
          </button>
          <button
            className="btn-ghost"
            onClick={onDelete}
            title="Delete this turn"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              padding: 4,
              color: "var(--text-2)",
            }}
            aria-label="delete"
          >
            <Icon name="trash" size={11} />
          </button>
        </div>
      </div>
      <p className="t-14" style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {turn.question}
      </p>

      {isRetrievalOnly ? (
        <div
          className="col gap-8"
          style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}
        >
          <div className="row gap-12 f-center">
            <RetrievalOnlyBadge />
            <span className="t-13 t-dim">
              이 실험은 LLM이 설정되지 않아 답변 생성을 건너뜁니다. 아래에서 검색된 청크를 확인하세요.
            </span>
          </div>
          <span className="t-12 t-meta">
            답변 생성을 켜려면{" "}
            <Link to="/providers" style={{ color: "var(--accent)" }}>
              외부 LLM 키 등록
            </Link>{" "}
            후 Auto-Pilot에서 LLM 포함 프리셋을 골라 재인덱싱하세요.
          </span>
        </div>
      ) : (
        <div className="col gap-8" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <span className="t-label">Answer</span>
          <p className="t-14" style={{ margin: 0, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
            {turn.answer}
          </p>
        </div>
      )}

      <div className="row f-between f-center" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span className="t-12 t-meta t-mono">
          turn {turn.id.slice(0, 12)} · {turn.latency_ms ?? 0} ms
        </span>
        <span className="t-12 t-meta">{turn.chunks.length} chunks</span>
      </div>

      {!isRetrievalOnly && turn.chunks.length > 0 && (
        <div className="col gap-6">
          <span className="t-label">Citations</span>
          <div className="row gap-6 f-wrap">
            {turn.chunks.map((c) => (
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
  chunks,
  activeChunk,
  setActiveChunk,
}: {
  chunks: ChatChunk[];
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
      {chunks.length === 0 ? (
        <p className="t-12 t-meta" style={{ padding: 16 }}>
          질문을 보내면 여기에 검색된 청크가 표시됩니다.
        </p>
      ) : (
        chunks.map((c) => {
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
                <span
                  className="t-mono t-12 t-meta"
                  title={`raw cosine ${c.score.toFixed(3)}`}
                >
                  #{c.rank} · 관련도 {(normalizeScore(c.score) * 100).toFixed(1)}%
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
