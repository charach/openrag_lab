/**
 * Chat surface — pick an experiment from the rail, ask a question, and see
 * retrieved chunks side-by-side with the answer (or just the chunks when the
 * experiment is in retrieval-only mode, API_SPEC §9.1.1).
 *
 * Turns persist server-side; selecting an experiment loads recent history.
 * Per-turn delete + edit + regenerate are wired to /turns endpoints (edit
 * just re-asks with the new question and orphans the old turn — there's
 * no PATCH on /turns yet).
 *
 * The header dot pulses gold while a chat round is in flight against an
 * external provider; ``externalCallStore.begin/end`` drives that.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  api,
  type ChatChunk,
  type ChatTurnRecord,
  type ExperimentDetail,
  type ExperimentSummary,
} from "../api/client";
import {
  ExportModal,
  mimeFor,
  triggerDownload,
} from "../components/modals/ExportModal";
import { confirmModal, useModal } from "../components/providers/ModalProvider";
import { useToast } from "../components/providers/ToastProvider";
import { useExternalCallStore } from "../stores/externalCall";
import { useWorkspaceStore } from "../stores/workspace";
import {
  ExternalCallTag,
  Icon,
  PageHeader,
  RetrievalOnlyBadge,
} from "../components/ui";

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

/**
 * Detect whether a model id refers to an external provider. The four
 * we ship today live in adapters/llms/{anthropic,openai,gemini,
 * openrouter}.py — recognising them by a small whitelist keeps the UI
 * decision local and avoids a round-trip just to know whether to dim
 * the dot. The display name is what we render in the ExternalCallTag.
 */
function detectExternal(
  llmId: string | null | undefined,
): { provider: string; model: string } | null {
  if (!llmId) return null;
  const id = llmId.toLowerCase();
  if (id.startsWith("external:")) {
    const [, providerRaw, model] = llmId.split(":");
    if (providerRaw && model) {
      return { provider: providerRaw, model };
    }
  }
  if (id.includes("claude") || id.includes("anthropic"))
    return { provider: "Anthropic", model: llmId };
  if (id.includes("gpt") || id.startsWith("o1") || id.startsWith("o3"))
    return { provider: "OpenAI", model: llmId };
  if (id.includes("gemini")) return { provider: "Google", model: llmId };
  if (id.includes("openrouter")) return { provider: "OpenRouter", model: llmId };
  return null;
}

type TurnView = ChatTurnRecord & { _pending?: boolean; _streaming?: boolean };

export function ChatView(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const modal = useModal();
  const toast = useToast();
  const externalBegin = useExternalCallStore((s) => s.begin);
  const externalEnd = useExternalCallStore((s) => s.end);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [activeDetail, setActiveDetail] = useState<ExperimentDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<TurnView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeChunk, setActiveChunk] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
      setActiveDetail(null);
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
    api
      .getExperiment(workspaceId, selected)
      .then((r) => setActiveDetail(r))
      .catch(() => setActiveDetail(null));
  }, [workspaceId, selected]);

  const externalProvider = useMemo(
    () => detectExternal(activeDetail?.config.llm_id),
    [activeDetail],
  );
  const isRetrievalOnlyExp = activeDetail?.config.llm_id == null;

  const ask = async (overrideQuestion?: string): Promise<void> => {
    if (!workspaceId || !selected) return;
    const q = (overrideQuestion ?? question).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setActiveChunk(null);
    if (externalProvider) {
      externalBegin(externalProvider.provider, "generation");
    }
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
        _streaming: !isRetrievalOnlyExp && res.answer !== null,
      };
      setHistory((prev) => [...prev, turn]);
      setStreamingId(turn.id);
      // Clear the streaming flag after a short pass — the AnswerBody
      // component reveals one segment per tick during this window.
      window.setTimeout(() => setStreamingId(null), 1800);
      if (overrideQuestion === undefined) setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      externalEnd();
    }
  };

  const askDelete = (turn: TurnView): void => {
    confirmModal(modal, {
      title: "Delete this turn?",
      message: "질문과 답변, 검색 결과가 함께 삭제됩니다.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        if (!workspaceId) return;
        try {
          await api.deleteTurn(workspaceId, turn.id);
          setHistory((prev) => prev.filter((t) => t.id !== turn.id));
          toast.push({
            eyebrow: "Deleted",
            message: "Turn removed.",
            kind: "error",
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const askClearThread = (): void => {
    if (history.length === 0) return;
    confirmModal(modal, {
      title: "Clear this thread?",
      message: `현재 실험의 ${history.length}개 대화가 모두 삭제됩니다.`,
      confirmLabel: "Clear all",
      danger: true,
      onConfirm: async () => {
        if (!workspaceId) return;
        try {
          for (const t of history) {
            await api.deleteTurn(workspaceId, t.id);
          }
          setHistory([]);
          toast.push({
            eyebrow: "Cleared",
            message: "Thread cleared.",
            kind: "error",
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const startEdit = (turn: TurnView): void => {
    setEditingId(turn.id);
    setEditingValue(turn.question);
  };
  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingValue("");
  };
  const saveEdit = async (turn: TurnView): Promise<void> => {
    const v = editingValue.trim();
    if (!v) return;
    setEditingId(null);
    setEditingValue("");
    // Replace the prior turn server-side: delete then re-ask.
    if (workspaceId) {
      try {
        await api.deleteTurn(workspaceId, turn.id);
        setHistory((prev) => prev.filter((t) => t.id !== turn.id));
      } catch {
        // best effort — if the delete fails the new ask still runs
      }
    }
    await ask(v);
  };

  const regenerate = async (turn: TurnView): Promise<void> => {
    await ask(turn.question);
  };

  const copyTurn = (turn: TurnView): void => {
    if (turn.answer && navigator.clipboard) {
      navigator.clipboard.writeText(turn.answer).catch(() => undefined);
      toast.push({ eyebrow: "Copied", message: "Answer copied." });
    }
  };

  const openExport = (): void => {
    if (!workspaceId || !selected) return;
    modal.open({
      title: "Export thread",
      eyebrow: `Experiment · ${selected.slice(0, 12)}`,
      width: 620,
      render: ({ close }) => (
        <ExportModal
          defaults={{
            format: "yaml",
            filename: `thread-${selected.slice(0, 12)}`,
            path: `~/openrag-lab/exports/${workspaceId}`,
            formats: ["yaml", "json", "md"],
            sectionsConfig: [
              {
                id: "config",
                label: "Experiment config",
                note: "embedder, chunking, retrieval",
                size: "1.2 KB",
                required: true,
              },
              {
                id: "turns",
                label: `Conversation turns (${history.length})`,
                note: "questions + answers",
                size: "—",
              },
              {
                id: "citations",
                label: "Retrieved chunks",
                note: "with source page numbers",
                size: "—",
              },
            ],
            includes: { config: true, turns: true, citations: true },
          }}
          preview={(fmt, inc) =>
            buildThreadPreview(
              fmt,
              inc,
              activeDetail,
              history,
              selected,
            )
          }
          onSave={({ format, filename, body }) => {
            triggerDownload(`${filename}.${format}`, body, mimeFor(format));
            toast.push({
              eyebrow: "Exported",
              message: `${filename}.${format} downloaded.`,
            });
          }}
          close={close}
        />
      ),
    });
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
          <div className="row gap-8">
            {externalProvider && !isRetrievalOnlyExp && (
              <span
                className="chip"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                <Icon name="ext" size={11} /> external · {externalProvider.provider}
              </span>
            )}
            {isRetrievalOnlyExp && <RetrievalOnlyBadge />}
            <Link to="/providers" className="btn btn-sm" title="외부 LLM 제공자 키 관리">
              <Icon name="lock" size={11} /> LLM providers
            </Link>
          </div>
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
          turnCounts={{ [selected ?? ""]: history.length }}
        />

        <div className="col gap-16">
          <div className="row f-between f-center">
            <span className="t-12 t-meta">
              {history.length} turn{history.length === 1 ? "" : "s"}
            </span>
            <div className="row gap-8">
              <button
                className="btn btn-sm"
                disabled={history.length === 0}
                onClick={askClearThread}
                style={
                  history.length > 0
                    ? { borderColor: "var(--border-strong)" }
                    : undefined
                }
              >
                <Icon name="trash" size={11} /> Clear thread
              </button>
              <button
                className="btn btn-sm"
                disabled={history.length === 0}
                onClick={openExport}
              >
                <Icon name="yaml" size={11} /> Export
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

          {history.length === 0 && !loading ? (
            <div className="card" style={{ padding: "60px 20px", textAlign: "center" }}>
              <p className="t-13 t-meta" style={{ lineHeight: 1.6, margin: 0 }}>
                No conversation yet for this experiment.
                <br />
                아래에서 질문을 입력해 시작하세요.
              </p>
            </div>
          ) : (
            <div className="col gap-12">
              {history.map((t) => (
                <TurnCard
                  key={t.id}
                  turn={t}
                  externalProvider={externalProvider}
                  isStreaming={streamingId === t.id}
                  editing={editingId === t.id}
                  editingValue={editingValue}
                  setEditingValue={setEditingValue}
                  onEdit={() => startEdit(t)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={() => saveEdit(t)}
                  onDelete={() => askDelete(t)}
                  onRegenerate={() => regenerate(t)}
                  onCopy={() => copyTurn(t)}
                  regenerating={loading}
                  activeChunk={activeChunk}
                  setActiveChunk={setActiveChunk}
                />
              ))}
            </div>
          )}

          <div className="card col gap-8" style={{ padding: 16 }}>
            <textarea
              ref={composerRef}
              className="input"
              rows={3}
              placeholder={
                isRetrievalOnlyExp
                  ? "Search retrieved chunks…"
                  : "Ask about your documents…"
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="row f-between f-center">
              <span className="t-12 t-meta row gap-12 f-center">
                <span>
                  <kbd>⌘</kbd> <kbd>⏎</kbd> to send
                </span>
                <span>·</span>
                <span>{history.length} turns</span>
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => ask()}
                disabled={loading || !selected || !question.trim()}
              >
                {loading ? "Asking…" : "Ask"}
                <Icon name="right" size={11} color="#0A0A0A" />
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
    </section>
  );
}

function ExperimentRail({
  experiments,
  selected,
  onSelect,
  turnCounts,
}: {
  experiments: ExperimentSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  turnCounts: Record<string, number>;
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
          const count = turnCounts[e.id] ?? 0;
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
              <div className="row f-between f-center">
                <span className="t-mono t-13">{e.id.slice(0, 14)}</span>
                {count > 0 && active && (
                  <span className="t-mono t-12 t-meta">{count}</span>
                )}
              </div>
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

/**
 * Renders the answer one character chunk at a time. The reveal isn't
 * a real stream from the backend — it's a visual cue that the answer
 * just arrived, matched to the design's blink-cursor pattern.
 */
function StreamingAnswer({ text }: { text: string }): JSX.Element {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!text) return;
    let i = 0;
    const step = Math.max(2, Math.ceil(text.length / 60));
    const tick = window.setInterval(() => {
      i += step;
      setShown(i);
      if (i >= text.length) window.clearInterval(tick);
    }, 24);
    return () => window.clearInterval(tick);
  }, [text]);
  const visible = text.slice(0, shown);
  const done = shown >= text.length;
  return (
    <p
      className="t-14"
      style={{ margin: 0, lineHeight: 1.65, whiteSpace: "pre-wrap" }}
    >
      {visible}
      {!done && (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 14,
            background: "var(--accent)",
            marginLeft: 2,
            verticalAlign: "text-bottom",
            animation: "blink 1s steps(2, end) infinite",
          }}
        />
      )}
    </p>
  );
}

function TurnCard({
  turn,
  externalProvider,
  isStreaming,
  editing,
  editingValue,
  setEditingValue,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onRegenerate,
  onCopy,
  regenerating,
  activeChunk,
  setActiveChunk,
}: {
  turn: TurnView;
  externalProvider: { provider: string; model: string } | null;
  isStreaming: boolean;
  editing: boolean;
  editingValue: string;
  setEditingValue: (v: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  regenerating: boolean;
  activeChunk: string | null;
  setActiveChunk: (id: string | null) => void;
}): JSX.Element {
  const isRetrievalOnly = turn.answer === null;
  return (
    <article className="card col gap-12" style={{ padding: 20 }}>
      <div className="row f-between f-center">
        <span className="t-label">Question</span>
        {!editing && (
          <div className="row gap-4">
            <button
              className="btn-ghost"
              onClick={onEdit}
              title="Edit & resend"
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                padding: 4,
                color: "var(--text-2)",
              }}
              aria-label="edit"
            >
              <Icon name="settings" size={11} />
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
        )}
      </div>
      {editing ? (
        <div className="col gap-8">
          <textarea
            className="input"
            rows={3}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            autoFocus
          />
          <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-sm" onClick={onCancelEdit}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={onSaveEdit}
              disabled={!editingValue.trim()}
            >
              Save & regenerate
            </button>
          </div>
        </div>
      ) : (
        <p
          className="t-14"
          style={{ margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
        >
          {turn.question}
        </p>
      )}

      {!editing &&
        (isRetrievalOnly ? (
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
          <div
            className="col gap-8"
            style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}
          >
            <div className="row gap-12 f-center" style={{ flexWrap: "wrap" }}>
              <span className="t-label">Answer</span>
              <span className="t-12 t-mono t-meta">
                latency {turn.latency_ms ?? 0} ms
              </span>
              <span className="t-12 t-mono t-meta">
                {turn.chunks.length} chunks used
              </span>
              {isStreaming && (
                <span className="chip chip-gold" style={{ fontSize: 9 }}>
                  <span className="dot dot-gold pulse-gold"></span>streaming…
                </span>
              )}
            </div>
            <div
              style={{
                padding: "16px 18px",
                background: "var(--bg-1)",
                borderLeft: "2px solid var(--accent)",
              }}
            >
              {isStreaming ? (
                <StreamingAnswer text={turn.answer ?? ""} />
              ) : (
                <p
                  className="t-14"
                  style={{
                    margin: 0,
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {turn.answer}
                </p>
              )}
            </div>
            <div
              className="row gap-12 f-center"
              style={{ flexWrap: "wrap", marginTop: 4 }}
            >
              {externalProvider ? (
                <ExternalCallTag
                  provider={externalProvider.provider}
                  model={externalProvider.model}
                />
              ) : (
                <span
                  className="t-12 t-meta row gap-6 f-center"
                >
                  <span className="dot"></span>
                  via local
                </span>
              )}
              <div style={{ flex: 1 }}></div>
              <button
                className="btn btn-sm"
                onClick={onRegenerate}
                disabled={regenerating}
              >
                <Icon name="settings" size={11} /> Regenerate
              </button>
              <button className="btn btn-sm" onClick={onCopy}>
                <Icon name="doc" size={11} /> Copy
              </button>
            </div>
          </div>
        ))}

      <div
        className="row f-between f-center"
        style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}
      >
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
                onMouseEnter={() => setActiveChunk(c.chunk_id)}
                onMouseLeave={() =>
                  activeChunk === c.chunk_id ? setActiveChunk(null) : undefined
                }
                onClick={() =>
                  setActiveChunk(activeChunk === c.chunk_id ? null : c.chunk_id)
                }
                className="chip chip-mono"
                style={{
                  cursor: "pointer",
                  borderColor:
                    activeChunk === c.chunk_id ? "var(--accent)" : undefined,
                  color:
                    activeChunk === c.chunk_id ? "var(--accent)" : undefined,
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

function buildThreadPreview(
  fmt: "yaml" | "json" | "csv" | "md",
  inc: Record<string, boolean>,
  detail: ExperimentDetail | null,
  history: TurnView[],
  expId: string | null,
): string {
  const sample = history.slice(0, 4);
  if (fmt === "yaml") {
    const lines = [
      `# OpenRAG-Lab thread export`,
      `# Generated ${new Date().toISOString()}`,
      ``,
    ];
    if (inc.config && detail) {
      lines.push(`experiment:`);
      lines.push(`  id: ${detail.id}`);
      lines.push(`  embedder: ${detail.config.embedder_id}`);
      lines.push(
        `  chunking: ${detail.config.chunking.strategy} ${detail.config.chunking.chunk_size}/${detail.config.chunking.chunk_overlap}`,
      );
      lines.push(`  retrieval: ${detail.config.retrieval_strategy}`);
      lines.push(`  llm: ${detail.config.llm_id ?? "null"}`);
    }
    if (inc.turns) {
      lines.push(`turns:`);
      for (const t of sample) {
        lines.push(`  - id: ${t.id}`);
        lines.push(`    question: "${t.question.replace(/"/g, '\\"').slice(0, 80)}"`);
        if (t.answer)
          lines.push(`    answer: "${t.answer.replace(/"/g, '\\"').slice(0, 80)}…"`);
        if (inc.citations) lines.push(`    chunks: ${t.chunks.length}`);
      }
      if (history.length > sample.length) {
        lines.push(`  # … ${history.length - sample.length} more`);
      }
    }
    return lines.join("\n");
  }
  if (fmt === "md") {
    const parts: string[] = [`# Conversation\n`];
    if (inc.config && detail) {
      parts.push(
        `## Experiment ${detail.id.slice(0, 12)}\n\n- embedder: ${detail.config.embedder_id}\n- chunking: ${detail.config.chunking.strategy} ${detail.config.chunking.chunk_size}/${detail.config.chunking.chunk_overlap}\n- retrieval: ${detail.config.retrieval_strategy}\n- llm: ${detail.config.llm_id ?? "null"}\n`,
      );
    }
    if (inc.turns) {
      for (const t of sample) {
        parts.push(`**Q:** ${t.question}\n`);
        if (t.answer) parts.push(`**A:** ${t.answer}\n`);
        parts.push(`---\n`);
      }
    }
    return parts.join("\n");
  }
  return JSON.stringify(
    {
      experiment_id: expId,
      ...(inc.config && detail
        ? {
            experiment: {
              embedder: detail.config.embedder_id,
              chunking: detail.config.chunking,
              retrieval: detail.config.retrieval_strategy,
              llm: detail.config.llm_id,
            },
          }
        : {}),
      ...(inc.turns
        ? {
            turns: sample.map((t) => ({
              id: t.id,
              question: t.question,
              answer: t.answer,
              ...(inc.citations ? { chunks: t.chunks.length } : {}),
              latency_ms: t.latency_ms,
            })),
          }
        : {}),
    },
    null,
    2,
  );
}
