// Chat — `/chat`
// Full CRUD: new experiment, conversation thread, edit/delete/copy/regenerate.

const Chat = ({ retrievalOnly, externalLLM, setExternalCall }) => {
  const modal = useModal();
  const toast = useToast();

  // Experiment list (mutable)
  const [allExps, setAllExps] = React.useState(MOCK.experiments);
  const [activeExpId, setActiveExpId] = React.useState("exp_42abcd");

  const activeExp = retrievalOnly
    ? allExps.find(e => e.id === "exp_55nnoo") || allExps[0]
    : allExps.find(e => e.id === activeExpId) || allExps[0];

  // Conversation thread per experiment
  const [threads, setThreads] = React.useState(() => ({
    [activeExp.id]: [
      {
        id: "t1",
        question: MOCK.question,
        segments: MOCK.answerSegments,
        citations: MOCK.retrievedChunks,
        latency: 4250,
        chunksUsed: "4 / 5",
        tokens: 234,
        ts: "방금",
      },
    ],
  }));

  const turns = threads[activeExp.id] || [];
  const [activeTurnId, setActiveTurnId] = React.useState(turns[0]?.id || null);
  const [activeCite, setActiveCite] = React.useState(null);
  const [streamingTurnId, setStreamingTurnId] = React.useState(null);
  const [composerValue, setComposerValue] = React.useState("");
  const [editingId, setEditingId] = React.useState(null);
  const [editingValue, setEditingValue] = React.useState("");

  React.useEffect(() => {
    // when switching experiments, focus the latest turn
    const t = (threads[activeExp.id] || [])[0];
    setActiveTurnId(t?.id || null);
  }, [activeExp.id]);

  // ---- helpers ----
  const fakeAnswerFor = (q) => {
    // produce deterministic-ish answer segments referencing chunks 0..3
    const base = [
      { text: `질문에 대해 검색된 출처를 종합하면, ` },
      { text: `핵심은 갱신 거절의 정당한 사유와 그 입증 책임입니다`, cite: 0 },
      { text: `. 또한 ` },
      { text: `손해배상 범위는 환산보증금의 3개월분으로 추정`, cite: 1 },
      { text: `되며, ` },
      { text: `재건축 의사의 진정성 판단은 자금조달·시공 계획 등 종합 사정`, cite: 2 },
      { text: `으로 봅니다.` },
    ];
    return base;
  };

  const newTurn = (question) => ({
    id: "t" + Math.random().toString(36).slice(2, 7),
    question,
    segments: fakeAnswerFor(question),
    citations: MOCK.retrievedChunks,
    latency: 3800 + Math.floor(Math.random() * 1200),
    chunksUsed: "4 / 5",
    tokens: 210 + Math.floor(Math.random() * 60),
    ts: "방금",
  });

  // Streaming animation: progressively reveal a turn
  const startStream = (expId, turnId) => {
    setStreamingTurnId(turnId);
    if (externalLLM) setExternalCall && setExternalCall({ provider: "Anthropic", stage: "generation" });
    setTimeout(() => {
      setStreamingTurnId(null);
      setExternalCall && setExternalCall(null);
    }, 2400);
  };

  // ---- CRUD: turns ----
  const sendQuestion = (q) => {
    const trimmed = (q || "").trim();
    if (!trimmed) return;
    const t = newTurn(trimmed);
    setThreads(prev => ({ ...prev, [activeExp.id]: [t, ...(prev[activeExp.id] || [])] }));
    setActiveTurnId(t.id);
    setComposerValue("");
    startStream(activeExp.id, t.id);
  };

  const regenerate = (turn) => {
    const fresh = { ...turn, segments: fakeAnswerFor(turn.question), latency: 3500 + Math.floor(Math.random()*1500), tokens: 200 + Math.floor(Math.random()*80), ts: "방금" };
    setThreads(prev => ({
      ...prev,
      [activeExp.id]: (prev[activeExp.id] || []).map(t => t.id === turn.id ? fresh : t),
    }));
    setActiveTurnId(turn.id);
    startStream(activeExp.id, turn.id);
    toast.push({ eyebrow: "Regenerating", message: "응답을 다시 생성합니다." });
  };

  const copyTurn = (turn) => {
    const text = turn.segments.map(s => s.text).join("");
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast.push({ eyebrow: "Copied", message: "답변을 클립보드에 복사했습니다." });
  };

  const deleteTurn = (turn) => confirmModal(modal, {
    title: "Delete this turn?",
    message: "질문과 답변, 검색 결과가 함께 삭제됩니다.",
    confirmLabel: "Delete", danger: true,
    onConfirm: () => {
      setThreads(prev => ({ ...prev, [activeExp.id]: (prev[activeExp.id] || []).filter(t => t.id !== turn.id) }));
      toast.push({ eyebrow: "Deleted", message: "Turn removed.", kind: "error" });
    },
  });

  const startEdit = (turn) => { setEditingId(turn.id); setEditingValue(turn.question); };
  const cancelEdit = () => { setEditingId(null); setEditingValue(""); };
  const saveEdit = (turn) => {
    const v = editingValue.trim();
    if (!v) return;
    const updated = { ...turn, question: v, segments: fakeAnswerFor(v), ts: "방금" };
    setThreads(prev => ({ ...prev, [activeExp.id]: (prev[activeExp.id] || []).map(t => t.id === turn.id ? updated : t) }));
    setEditingId(null); setEditingValue("");
    setActiveTurnId(turn.id);
    startStream(activeExp.id, turn.id);
    toast.push({ eyebrow: "Updated", message: "질문을 수정하고 답변을 다시 생성합니다." });
  };

  const clearThread = () => confirmModal(modal, {
    title: "Clear this thread?",
    message: `현재 실험 (${activeExp.short}) 의 모든 대화가 삭제됩니다.`,
    confirmLabel: "Clear all", danger: true,
    onConfirm: () => {
      setThreads(prev => ({ ...prev, [activeExp.id]: [] }));
      setActiveTurnId(null);
      toast.push({ eyebrow: "Cleared", message: "Thread cleared.", kind: "error" });
    },
  });

  // ---- CRUD: experiments (rail) ----
  const openNewExperiment = () => modal.open({
    title: "New experiment", eyebrow: "Configure run", width: 540,
    render: NewExperimentModal({
      onCreate: (cfg) => {
        const id = "exp_" + Math.random().toString(36).slice(2, 7);
        const fp = "fp_" + Math.random().toString(36).slice(2, 6);
        const e = {
          id, short: fp, fp, preset: cfg.preset,
          embedder: cfg.embedder, chunking: `${cfg.strategy} ${cfg.chunk_size}/${cfg.overlap}`,
          llm: cfg.retrievalOnly ? null : cfg.llm,
          retrieval: `top-${cfg.top_k} hybrid`,
          scores: { faithfulness: 0, answer_relevance: 0, context_precision: 0, context_recall: 0 },
          latency_ms: 0,
          archived: false,
        };
        setAllExps(es => [e, ...es]);
        setActiveExpId(id);
        setThreads(prev => ({ ...prev, [id]: [] }));
        toast.push({ eyebrow: "Created", message: `${cfg.preset} 실험이 추가되었습니다 — 인덱싱 진행 중.` });
      },
    }),
  });

  const renameExp = (exp) => modal.open({
    title: "Rename experiment", eyebrow: "Experiment", width: 440,
    render: RenameModal({
      initial: exp.short,
      onSave: (newName) => {
        setAllExps(es => es.map(x => x.id === exp.id ? {...x, short: newName, fp: newName} : x));
        toast.push({ eyebrow: "Saved", message: "Experiment renamed." });
      },
    }),
  });

  const deleteExp = (exp) => confirmModal(modal, {
    title: `Delete "${exp.short}"?`,
    message: "실험 결과와 대화 내역이 함께 삭제됩니다. 임베딩·청크는 보존됩니다.",
    confirmLabel: "Delete experiment", danger: true,
    onConfirm: () => {
      setAllExps(es => es.filter(e => e.id !== exp.id));
      setThreads(prev => { const n = {...prev}; delete n[exp.id]; return n; });
      if (exp.id === activeExpId) {
        const next = allExps.find(e => e.id !== exp.id);
        if (next) setActiveExpId(next.id);
      }
      toast.push({ eyebrow: "Deleted", message: `${exp.short} removed.`, kind: "error" });
    },
  });

  const activeTurn = turns.find(t => t.id === activeTurnId) || turns[0];

  return (
    <div style={{ height: "calc(100vh - 56px)", display: "grid", gridTemplateColumns: "260px 1fr 360px" }}>
      {/* Left rail — experiments */}
      <aside style={{ borderRight: "1px solid var(--border)", background: "var(--bg-1)", overflowY: "auto" }}>
        <div style={{ padding: "20px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <span className="t-label">Experiments · {MOCK.workspaces[0].name}</span>
        </div>
        <div className="col">
          {allExps.map(e => (
            <ExperimentRailItem key={e.id} exp={e}
              active={activeExp.id === e.id}
              count={(threads[e.id] || []).length}
              onClick={() => !e.archived && setActiveExpId(e.id)}
              onRename={() => renameExp(e)}
              onDelete={() => deleteExp(e)} />
          ))}
        </div>
        <div style={{ padding: "12px 18px" }}>
          <button className="btn btn-sm" style={{ width: "100%", justifyContent: "center" }}
            onClick={openNewExperiment}>+ New experiment</button>
        </div>
      </aside>

      {/* Middle — transcript */}
      <main style={{ overflowY: "auto", padding: "28px 40px 60px", background: "var(--bg-0)" }}>
        <div className="row f-between f-center" style={{ marginBottom: 24 }}>
          <div className="row gap-12 f-center f-wrap">
            <span className="t-mono t-13" style={{ color: "var(--accent)" }}>{activeExp.fp}</span>
            <span className="t-meta t-12">·</span>
            <span className="t-12 t-mono t-meta">{activeExp.embedder} · {activeExp.chunking}</span>
            {retrievalOnly && <RetrievalOnlyBadge />}
            {externalLLM && !retrievalOnly && (
              <span className="chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                <Icon name="ext" size={11} /> external · Anthropic
              </span>
            )}
          </div>
          <div className="row gap-8">
            <button className="btn btn-sm" onClick={clearThread} disabled={turns.length === 0}
              style={{ borderColor: turns.length ? "var(--border-strong)" : undefined,
                       color: turns.length ? "var(--text-1)" : "var(--text-2)" }}>
              <Icon name="trash" size={11}/> Clear thread
            </button>
            <button className="btn btn-sm"
              onClick={() => modal.open({
                title: "Export thread", eyebrow: `Experiment · ${activeExp.short}`, width: 620,
                render: ExportModal({
                  defaults: {
                    format: "yaml",
                    filename: `thread-${activeExp.fp}`,
                    path: `~/openrag-lab/exports/${MOCK.workspaces[0].id}`,
                    formats: ["yaml", "json", "md"],
                    sectionsConfig: [
                      { id: "config", label: "Experiment config", note: "embedder, chunking, retrieval", size: "1.2 KB", required: true },
                      { id: "turns", label: `Conversation turns (${turns.length})`, note: "questions + answers", size: "4.8 KB" },
                      { id: "citations", label: "Retrieved chunks", note: "with source page numbers", size: "12 KB" },
                      { id: "metrics", label: "Per-turn metrics", note: "latency, tokens, chunks used", size: "0.8 KB" },
                    ],
                    includes: { config: true, turns: true, citations: true, metrics: true },
                  },
                  preview: (fmt, inc) => {
                    if (fmt === "yaml") return [
                      `# OpenRAG-Lab thread export`,
                      `# Generated ${new Date().toISOString()}`,
                      ``,
                      `experiment:`,
                      `  fp: ${activeExp.fp}`,
                      `  embedder: ${activeExp.embedder}`,
                      `  chunking: ${activeExp.chunking}`,
                      `  retrieval: ${activeExp.retrieval}`,
                      `  llm: ${activeExp.llm || "null"}`,
                      `turns:`,
                      ...turns.slice(0,2).flatMap(t => [
                        `  - id: ${t.id}`,
                        `    question: "${t.question.slice(0, 60).replace(/"/g, '\\"')}…"`,
                        `    latency_ms: ${t.latency}`,
                        `    tokens: ${t.tokens}`,
                      ]),
                      turns.length > 2 ? `  # … ${turns.length - 2} more` : ``,
                    ].filter(Boolean).join("\n");
                    if (fmt === "json") return JSON.stringify({
                      experiment: { fp: activeExp.fp, embedder: activeExp.embedder, chunking: activeExp.chunking },
                      turns: turns.slice(0,2).map(t => ({ id: t.id, question: t.question.slice(0,40)+"…", latency_ms: t.latency })),
                    }, null, 2);
                    return `# Conversation\n\n## ${activeExp.fp}\n\n` +
                      turns.slice(0,2).map(t => `**Q:** ${t.question}\n\n**A:** ${t.segments.map(s=>s.text).join("")}\n`).join("\n---\n\n");
                  },
                }),
              })}>
              <Icon name="yaml" size={11}/> Export
            </button>
          </div>
        </div>

        {/* Turns */}
        {turns.length === 0 ? (
          <div className="card" style={{ padding: "60px 20px", textAlign: "center" }}>
            <div className="t-13 t-meta" style={{ marginBottom: 14, lineHeight: 1.6 }}>
              No conversation yet for this experiment.<br/>
              아래에서 질문을 입력해 시작하세요.
            </div>
          </div>
        ) : (
          <div className="col gap-32">
            {turns.map(turn => (
              <TurnBlock key={turn.id}
                turn={turn}
                isActive={turn.id === activeTurnId}
                isStreaming={turn.id === streamingTurnId}
                retrievalOnly={retrievalOnly}
                externalLLM={externalLLM}
                editing={editingId === turn.id}
                editingValue={editingValue}
                setEditingValue={setEditingValue}
                onSelect={() => setActiveTurnId(turn.id)}
                onCiteEnter={(c) => setActiveCite(c)}
                onCiteLeave={() => setActiveCite(null)}
                onEdit={() => startEdit(turn)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => saveEdit(turn)}
                onCopy={() => copyTurn(turn)}
                onDelete={() => deleteTurn(turn)}
                onRegenerate={() => regenerate(turn)} />
            ))}
          </div>
        )}

        {/* Composer */}
        <div style={{ marginTop: 40 }}>
          <div className="card" style={{ padding: 4, display: "flex", alignItems: "stretch" }}>
            <textarea
              className="input"
              placeholder={retrievalOnly ? "Search retrieved chunks…" : "Ask about your documents…"}
              style={{ border: 0, background: "transparent", resize: "none", minHeight: 56, padding: 14 }}
              value={composerValue}
              onChange={e => setComposerValue(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  sendQuestion(composerValue);
                }
              }} />
            <div className="col" style={{ padding: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-primary btn-sm"
                onClick={() => sendQuestion(composerValue)}
                disabled={!composerValue.trim() || streamingTurnId !== null}>
                <Icon name="right" size={11} color="#0A0A0A" /> Send
              </button>
            </div>
          </div>
          <div className="row gap-12 f-center" style={{ marginTop: 8 }}>
            <span className="t-12 t-meta">⌘ ⏎ to send</span>
            <span className="t-12 t-meta">·</span>
            <span className="t-12 t-meta">{turns.length} turns</span>
          </div>
        </div>
      </main>

      {/* Right — context */}
      <aside style={{ borderLeft: "1px solid var(--border)", background: "var(--bg-1)", overflowY: "auto" }}>
        <div style={{ padding: "20px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <div className="row f-between f-center">
            <span className="t-label">Retrieved · {(activeTurn?.citations || []).length}</span>
            <span className="t-mono t-12 t-meta">latency 87ms</span>
          </div>
        </div>
        <div className="col gap-1">
          {(activeTurn?.citations || []).map((c, idx) => (
            <ContextCard key={c.id} chunk={c} index={idx} cited={activeCite === idx} />
          ))}
          {!activeTurn && (
            <div className="t-12 t-meta" style={{ padding: 18 }}>턴을 선택하면 출처가 표시됩니다.</div>
          )}
        </div>
      </aside>
    </div>
  );
};

const ExperimentRailItem = ({ exp, active, count, onClick, onRename, onDelete }) => (
  <div style={{
    background: active ? "var(--bg-2)" : "transparent",
    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
    borderBottom: "1px solid var(--border)",
    opacity: exp.archived ? 0.45 : 1,
    position: "relative",
  }}>
    <button onClick={onClick} disabled={exp.archived}
      style={{
        textAlign: "left", width: "100%",
        padding: "12px 38px 12px 18px",
        background: "transparent",
        border: 0,
        cursor: exp.archived ? "not-allowed" : "pointer",
        color: "var(--text-0)", fontFamily: "inherit",
      }}>
      <div className="row f-between f-center">
        <span className="t-mono t-13" style={{ color: active ? "var(--accent)" : "var(--text-0)" }}>{exp.short}</span>
        <div className="row gap-6 f-center">
          {count > 0 && <span className="t-mono t-12 t-meta">{count}</span>}
          {exp.archived && <Icon name="archive" size={11} color="var(--text-2)"/>}
          {exp.llm == null && !exp.archived && <span className="t-12 t-meta">RO</span>}
        </div>
      </div>
      <div className="t-12 t-meta t-mono" style={{ marginTop: 4, lineHeight: 1.5 }}>
        {exp.embedder}<br/>
        {exp.chunking}
      </div>
      {exp.archived && (
        <div className="t-label" style={{ marginTop: 6, fontSize: 9 }}>Archived · dim 768→384</div>
      )}
    </button>
    {!exp.archived && (active ? (
      <div style={{
        position: "absolute", top: 8, right: 8, display: "flex", gap: 2,
      }}>
        <button title="Rename" onClick={(e)=>{e.stopPropagation(); onRename();}}
          style={{border:0,background:"transparent",padding:4,cursor:"pointer",color:"var(--text-2)"}}
          onMouseEnter={e=>e.currentTarget.style.color="var(--text-0)"}
          onMouseLeave={e=>e.currentTarget.style.color="var(--text-2)"}>
          <Icon name="settings" size={11}/>
        </button>
        <button title="Delete" onClick={(e)=>{e.stopPropagation(); onDelete();}}
          style={{border:0,background:"transparent",padding:4,cursor:"pointer",color:"var(--text-2)"}}
          onMouseEnter={e=>e.currentTarget.style.color="var(--error)"}
          onMouseLeave={e=>e.currentTarget.style.color="var(--text-2)"}>
          <Icon name="trash" size={11}/>
        </button>
      </div>
    ) : null)}
  </div>
);

// ---- TurnBlock: question + answer with edit/copy/regenerate/delete ----
const TurnBlock = ({ turn, isActive, isStreaming, retrievalOnly, externalLLM,
                    editing, editingValue, setEditingValue,
                    onSelect, onCiteEnter, onCiteLeave,
                    onEdit, onCancelEdit, onSaveEdit, onCopy, onDelete, onRegenerate }) => {
  return (
    <div onClick={onSelect} style={{
      paddingLeft: 16,
      borderLeft: isActive ? "1px solid var(--accent)" : "1px solid transparent",
      transition: "border-color 120ms",
      cursor: "pointer",
    }}>
      {/* Question */}
      <div className="col gap-6" style={{ marginBottom: 14 }}>
        <div className="row f-between f-center">
          <span className="t-label" style={{ color: "var(--accent)" }}>Question · {turn.ts}</span>
          {!editing && (
            <div className="row gap-2">
              <IconBtn title="Edit & resend" onClick={(e)=>{e.stopPropagation(); onEdit();}}><Icon name="settings" size={11}/></IconBtn>
              <IconBtn title="Delete turn" danger onClick={(e)=>{e.stopPropagation(); onDelete();}}><Icon name="trash" size={11}/></IconBtn>
            </div>
          )}
        </div>
        {editing ? (
          <div className="col gap-8" onClick={e => e.stopPropagation()}>
            <textarea className="input" value={editingValue}
              onChange={e => setEditingValue(e.target.value)}
              style={{ minHeight: 80, padding: 14 }}
              autoFocus/>
            <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-sm" onClick={onCancelEdit}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={onSaveEdit}>Save & regenerate</button>
            </div>
          </div>
        ) : (
          <p className="t-20" style={{
            margin: 0, fontWeight: 300,
            color: "var(--text-0)", maxWidth: 720,
            textWrap: "pretty",
          }}>{turn.question}</p>
        )}
      </div>

      {/* Answer */}
      {!editing && (
        retrievalOnly ? (
          <RetrievalOnlyPanel/>
        ) : (
          <AnswerPanel turn={turn}
            externalLLM={externalLLM}
            streaming={isStreaming}
            onCiteEnter={onCiteEnter}
            onCiteLeave={onCiteLeave}
            onCopy={onCopy}
            onRegenerate={onRegenerate}/>
        )
      )}
    </div>
  );
};

const IconBtn = ({ children, onClick, title, danger }) => (
  <button onClick={onClick} title={title} style={{
    border: 0, background: "transparent",
    width: 24, height: 24, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "var(--text-2)",
  }}
  onMouseEnter={e => e.currentTarget.style.color = danger ? "var(--error)" : "var(--text-0)"}
  onMouseLeave={e => e.currentTarget.style.color = "var(--text-2)"}>
    {children}
  </button>
);

// Answer panel — animates segment-by-segment when streaming
const AnswerPanel = ({ turn, externalLLM, streaming, onCiteEnter, onCiteLeave, onCopy, onRegenerate }) => {
  const segs = turn.segments;
  // animate revealed count
  const [revealed, setRevealed] = React.useState(streaming ? 0 : segs.length);
  React.useEffect(() => {
    if (!streaming) { setRevealed(segs.length); return; }
    setRevealed(0);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= segs.length) clearInterval(interval);
    }, 320);
    return () => clearInterval(interval);
  }, [streaming, segs]);

  return (
    <div>
      <div className="row gap-16 f-center f-wrap" style={{ marginBottom: 14 }}>
        <span className="t-label">Answer</span>
        <span className="t-12 t-mono t-meta">latency <span style={{ color: "var(--text-1)" }}>{turn.latency.toLocaleString()} ms</span></span>
        <span className="t-12 t-mono t-meta">chunks used <span style={{ color: "var(--text-1)" }}>{turn.chunksUsed}</span></span>
        <span className="t-12 t-mono t-meta">tokens <span style={{ color: "var(--text-1)" }}>{turn.tokens}</span></span>
        {streaming && <span className="chip chip-gold"><span className="dot dot-gold pulse-gold"></span>streaming…</span>}
      </div>

      <div style={{
        padding: "20px 24px",
        background: "var(--bg-1)",
        borderLeft: "2px solid var(--accent)",
        maxWidth: 720,
        minHeight: 80,
      }}>
        <p style={{ margin: 0, lineHeight: 1.85, color: "var(--text-0)", fontSize: 15, fontWeight: 300, textWrap: "pretty" }}>
          {segs.slice(0, revealed).map((seg, i) => seg.cite != null ? (
            <span key={i}
              onMouseEnter={() => onCiteEnter && onCiteEnter(seg.cite)}
              onMouseLeave={() => onCiteLeave && onCiteLeave()}
              style={{ borderBottom: "1px dotted var(--accent)", cursor: "pointer" }}>
              {seg.text}<sup style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 10, color: "var(--accent)",
                padding: "0 3px", marginLeft: 1,
              }}>[{seg.cite}]</sup>
            </span>
          ) : (
            <React.Fragment key={i}>{seg.text}</React.Fragment>
          ))}
          {streaming && revealed < segs.length && (
            <span style={{
              display: "inline-block", width: 8, height: 14,
              background: "var(--accent)", marginLeft: 2,
              animation: "blink 1s steps(2, end) infinite",
              verticalAlign: "text-bottom",
            }}/>
          )}
        </p>
      </div>

      <div className="row gap-16 f-center" style={{ marginTop: 14 }}>
        {externalLLM && <ExternalCallTag provider="Anthropic" model="claude-sonnet-4-6" />}
        {!externalLLM && <span className="t-12 t-meta row gap-6 f-center"><span className="dot"></span>via local · llama-3-8b-q4</span>}
        <div style={{ flex: 1 }}></div>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onRegenerate(); }} disabled={streaming}>
          <Icon name="settings" size={11}/> Regenerate
        </button>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onCopy(); }}>
          <Icon name="doc" size={11}/> Copy
        </button>
      </div>
    </div>
  );
};

const RetrievalOnlyPanel = () => (
  <div>
    <div className="row gap-16 f-center" style={{ marginBottom: 14 }}>
      <span className="t-label">Retrieved chunks only</span>
      <span className="t-12 t-mono t-meta">latency <span style={{ color: "var(--text-1)" }}>87 ms</span></span>
      <span className="t-12 t-mono t-meta">k = 5</span>
    </div>
    <div style={{
      padding: "24px 28px",
      background: "var(--bg-1)",
      border: "1px dashed var(--border-strong)",
      maxWidth: 720,
    }}>
      <div className="row gap-10 f-center" style={{ marginBottom: 12 }}>
        <RetrievalOnlyBadge size="lg" />
        <span className="t-12 t-meta">llm_id is null · 답변 생성 단계는 생략됩니다.</span>
      </div>
      <p className="t-13 t-dim" style={{ margin: 0, lineHeight: 1.7, maxWidth: 600 }}>
        검색 전용 모드에서는 임베더·청킹의 검색 품질만 평가합니다. 우측의 검색된 청크 4개를 출처·점수와 함께 확인하시고,
        Faithfulness · Answer Relevance 같은 LLM 의존 지표는 비활성화됩니다 (Experiment Matrix에서 — 으로 표시).
      </p>
    </div>
  </div>
);

const ContextCard = ({ chunk, index, cited }) => (
  <div style={{
    padding: "16px 18px",
    borderBottom: "1px solid var(--border)",
    background: cited ? "var(--bg-2)" : "transparent",
    borderLeft: cited ? "2px solid var(--accent)" : "2px solid transparent",
    transition: "background 120ms",
    position: "relative",
  }}>
    <div className="row f-between f-center" style={{ marginBottom: 8 }}>
      <div className="row gap-8 f-center">
        <span className="t-mono t-13" style={{ color: "var(--accent)" }}>[{index}]</span>
        <span className="t-13">{chunk.file}</span>
      </div>
      <div className="row gap-12 f-center">
        <span className="t-mono t-12 t-meta">p.{chunk.page}</span>
        <span className="t-mono t-12" style={{
          color: chunk.score > 0.85 ? "var(--accent)" : "var(--text-1)",
        }}>{chunk.score.toFixed(2)}</span>
      </div>
    </div>
    <p className="t-12" style={{
      margin: 0, color: "var(--text-1)",
      lineHeight: 1.65,
      textWrap: "pretty",
    }}>{chunk.content}</p>
  </div>
);

window.Chat = Chat;
