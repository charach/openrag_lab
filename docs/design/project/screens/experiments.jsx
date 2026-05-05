// Experiment Matrix — `/experiments`

// ---- Matrix state at module scope (so RunBatch + Define share it) ----
const DEFAULT_DIMS = {
  embedder: ["bge-small-en", "bge-large-en", "MiniLM-L6"],
  chunking: ["recursive · 512/64", "recursive · 1024/128"],
  retrieval: ["dense · k=5", "dense · k=8"],
};
const DEFAULT_EVALS = {
  faithfulness: true,
  answer_relevance: true,
  context_precision: true,
  context_recall: true,
  latency_p95: false,
  cost_per_query: false,
};

const ExperimentMatrix = () => {
  const modal = useModal();
  const toast = useToast();
  const [allExps, setAllExps] = React.useState(MOCK.experiments);
  const [dims, setDims] = React.useState(DEFAULT_DIMS);
  const [evals, setEvals] = React.useState(DEFAULT_EVALS);
  const [batchJob, setBatchJob] = React.useState(null);
  // batchJob: { id, total, done, etaSec, startedAt, status: 'running'|'done'|'cancelled' }

  const comboCount = dims.embedder.length * dims.chunking.length * dims.retrieval.length;
  const goldenCount = 50;
  const totalEvals = comboCount * goldenCount;
  const etaSec = Math.round(totalEvals * 0.45); // ≈0.45s per eval
  const etaLabel = etaSec >= 60 ? `${Math.floor(etaSec/60)}분 ${etaSec%60}초` : `${etaSec}초`;

  // Simulate batch progress
  React.useEffect(() => {
    if (!batchJob || batchJob.status !== "running") return;
    const tick = setInterval(() => {
      setBatchJob(j => {
        if (!j || j.status !== "running") return j;
        const next = j.done + Math.ceil(j.total / 60);
        if (next >= j.total) return { ...j, done: j.total, status: "done" };
        return { ...j, done: next };
      });
    }, 700);
    return () => clearInterval(tick);
  }, [batchJob && batchJob.status]);

  const startBatch = () => {
    const job = {
      id: "batch_" + Math.random().toString(36).slice(2, 7),
      total: totalEvals,
      done: 0,
      etaSec,
      startedAt: Date.now(),
      status: "running",
      combos: comboCount,
    };
    setBatchJob(job);
    toast.push({ eyebrow: "Batch started", message: `${totalEvals} evaluations queued. Running in background.` });
  };

  const cancelBatch = () => confirmModal(modal, {
    title: "Cancel batch run?",
    message: "진행 중인 평가가 중단됩니다. 이미 완료된 결과는 보존됩니다.",
    confirmLabel: "Cancel batch", danger: true,
    onConfirm: () => {
      setBatchJob(j => j ? { ...j, status: "cancelled" } : j);
      toast.push({ eyebrow: "Cancelled", message: "Batch stopped. Partial results saved.", kind: "error" });
    },
  });

  const dismissBatch = () => setBatchJob(null);
  const [selected, setSelected] = React.useState(["exp_42abcd", "exp_77aacc"]);
  const [sortBy, setSortBy] = React.useState("faithfulness");

  const toggleSelect = (id) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const openDetail = (exp) => {
    modal.open({
      title: `Experiment · ${exp.short}`, eyebrow: exp.preset, width: 640,
      render: ExperimentDetailModal({ exp }),
    });
  };
  const askDeleteExp = (exp) => {
    confirmModal(modal, {
      title: `Delete experiment "${exp.short}"?`,
      message: "이 실험 결과는 영구 삭제됩니다. 연결된 임베딩·청크는 다른 실험에서 재사용 중일 수 있어 보존됩니다.",
      confirmLabel: "Delete experiment", danger: true,
      onConfirm: () => {
        setAllExps(es => es.filter(e => e.id !== exp.id));
        setSelected(s => s.filter(id => id !== exp.id));
        toast.push({ eyebrow: "Deleted", message: `${exp.short} removed.`, kind: "error" });
      },
    });
  };

  const exps = [...allExps].filter(e => !e.archived);
  exps.sort((a, b) => {
    const av = a.scores[sortBy]; const bv = b.scores[sortBy];
    if (av == null) return 1; if (bv == null) return -1;
    return bv - av;
  });

  const a = allExps.find(e => e.id === selected[0]);
  const b = allExps.find(e => e.id === selected[1]);

  return (
    <div style={{ padding: "28px 40px 80px", maxWidth: 1440, margin: "0 auto" }}>
      <div className="row f-between f-center" style={{ marginBottom: 24 }}>
        <PageHeader eyebrow="Experiments · Matrix" title="Compare combinations side by side." />
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={() => modal.open({
            title: "Matrix definition", eyebrow: "Define batch", width: 560,
            render: ({ close }) => <MatrixDefineForm dims={dims} setDims={setDims} evals={evals} setEvals={setEvals} close={close} toast={toast}/>,
          })}><Icon name="grid" size={11}/> Define matrix</button>
          <button className="btn btn-primary btn-sm" disabled={batchJob && batchJob.status === "running"}
            onClick={() => confirmModal(modal, {
              title: "Run batch evaluation?",
              message: `${comboCount} combinations × ${goldenCount} golden pairs = ${totalEvals} evaluations. 예상 시간 ≈ ${etaLabel}. 진행 중에도 다른 화면에서 자유롭게 작업할 수 있습니다.`,
              confirmLabel: "Start in background",
              onConfirm: startBatch,
            })}>
            <Icon name="play" size={11} color="#0A0A0A"/>
            {batchJob && batchJob.status === "running" ? "Running…" : "Run batch"}
          </button>
        </div>
      </div>

      {/* Background batch progress bar */}
      {batchJob && (
        <BatchSessionBar job={batchJob} etaLabel={etaLabel} onCancel={cancelBatch} onDismiss={dismissBatch}/>
      )}

      {/* Top — matrix definition (live) */}
      <MatrixDefinition dims={dims} evals={evals} comboCount={comboCount} totalEvals={totalEvals} etaLabel={etaLabel}
        onEdit={() => modal.open({
          title: "Matrix definition", eyebrow: "Define batch", width: 560,
          render: ({ close }) => <MatrixDefineForm dims={dims} setDims={setDims} evals={evals} setEvals={setEvals} close={close} toast={toast}/>,
        })}/>

      {/* Results table */}
      <section className="card" style={{ padding: 0, marginTop: 24 }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 1fr 1fr 110px 110px 110px 110px 110px",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          alignItems: "center",
        }}>
          <span></span>
          <HeaderCell>Fingerprint</HeaderCell>
          <HeaderCell>Embedder · Chunking</HeaderCell>
          <HeaderCell>LLM · Retrieval</HeaderCell>
          <HeaderCell sortable active={sortBy==="faithfulness"} onClick={()=>setSortBy("faithfulness")}>Faithfulness</HeaderCell>
          <HeaderCell sortable active={sortBy==="answer_relevance"} onClick={()=>setSortBy("answer_relevance")}>Answer Rel.</HeaderCell>
          <HeaderCell sortable active={sortBy==="context_precision"} onClick={()=>setSortBy("context_precision")}>Ctx Precision</HeaderCell>
          <HeaderCell sortable active={sortBy==="context_recall"} onClick={()=>setSortBy("context_recall")}>Ctx Recall</HeaderCell>
          <HeaderCell align="right">Latency</HeaderCell>
        </div>

        {exps.map(e => (
          <ExpRow key={e.id} exp={e}
                  selected={selected.includes(e.id)}
                  selectionLabel={selected[0] === e.id ? "A" : selected[1] === e.id ? "B" : null}
                  onToggle={() => toggleSelect(e.id)}
                  onOpen={() => openDetail(e)}
                  onDelete={() => askDeleteExp(e)} />
        ))}
        {/* archived */}
        {allExps.filter(e => e.archived).map(e => (
          <ExpRow key={e.id} exp={e} archived onOpen={() => openDetail(e)} />
        ))}
      </section>

      {/* A/B chart + summary */}
      {a && b && <ABCompare a={a} b={b} />}

      {/* Golden set sub-panel */}
      <GoldenSetPanel />
    </div>
  );
};

const HeaderCell = ({ children, sortable, active, onClick, align = "left" }) => (
  <span onClick={sortable ? onClick : undefined}
    className="t-label"
    style={{
      fontSize: 9, color: active ? "var(--accent)" : "var(--text-2)",
      cursor: sortable ? "pointer" : "default",
      textAlign: align,
      userSelect: "none",
    }}>
    {children}
    {sortable && active && " ▾"}
  </span>
);

const ExpRow = ({ exp, selected, selectionLabel, onToggle, onOpen, onDelete, archived }) => {
  const isRO = exp.llm == null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 1fr 1fr 110px 110px 110px 110px 110px",
        padding: "14px 20px",
        borderBottom: "1px solid var(--border)",
        alignItems: "center",
        background: selected ? "var(--bg-2)" : "transparent",
        opacity: archived ? 0.45 : 1,
        position: "relative",
      }}>
      <button onClick={archived ? undefined : onToggle} disabled={archived} style={{
        width: 18, height: 18,
        border: "1px solid " + (selected ? "var(--accent)" : "var(--border-strong)"),
        background: selected ? "var(--accent)" : "transparent",
        color: "#0A0A0A",
        fontFamily: "JetBrains Mono, monospace", fontSize: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: archived ? "default" : "pointer", padding: 0,
      }}>{selectionLabel || ""}</button>

      <div className="col gap-2" onClick={onOpen} style={{ cursor: "pointer" }}>
        <div className="row gap-8 f-center">
          <span className="t-mono t-13" style={{ color: archived ? "var(--text-2)" : "var(--accent)" }}>{exp.short}</span>
          {isRO && <RetrievalOnlyBadge />}
          {archived && <span className="chip" style={{ fontSize: 9 }}><Icon name="archive" size={9}/> archived</span>}
        </div>
        <span className="t-12 t-meta">{exp.preset}</span>
      </div>

      <div className="col gap-2 t-mono t-12 t-meta" onClick={onOpen} style={{ cursor: "pointer" }}>
        <span style={{ color: "var(--text-1)" }}>{exp.embedder}</span>
        <span>{exp.chunking}</span>
      </div>

      <div className="col gap-2 t-mono t-12 t-meta" onClick={onOpen} style={{ cursor: "pointer" }}>
        <span style={{ color: "var(--text-1)" }}>{exp.llm || "—"}</span>
        <span>{exp.retrieval}</span>
      </div>

      <ScoreCell value={exp.scores.faithfulness} />
      <ScoreCell value={exp.scores.answer_relevance} />
      <ScoreCell value={exp.scores.context_precision} />
      <ScoreCell value={exp.scores.context_recall} />

      <div className="row gap-6 f-center" style={{ justifyContent: "flex-end" }}>
        <span className="t-mono t-12 t-meta">
          {exp.latency_ms.toLocaleString()}<span style={{ marginLeft: 2 }}>ms</span>
        </span>
        {!archived && onDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            style={{
              border: 0, background: "transparent", padding: 4, cursor: "pointer",
              color: "var(--text-2)",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--error)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--text-2)"}>
            <Icon name="trash" size={11}/>
          </button>
        )}
      </div>
    </div>
  );
};

const MatrixDefinition = ({ dims, evals, comboCount, totalEvals, etaLabel, onEdit }) => {
  const evalKeys = Object.keys(evals).filter(k => evals[k]);
  return (
    <section className="card" style={{ padding: 20 }}>
      <div className="row f-between f-center" style={{ marginBottom: 12 }}>
        <div className="row gap-12 f-center">
          <span className="t-label">Matrix definition</span>
          <span className="t-mono t-12" style={{color:"var(--accent)"}}>
            {dims.embedder.length} × {dims.chunking.length} × {dims.retrieval.length} = {comboCount} combos
          </span>
          <span className="t-12 t-meta">· {evalKeys.length} metrics · ≈ {etaLabel}</span>
        </div>
        <div className="row gap-8 f-center">
          <span className="t-12 t-meta">{totalEvals} evaluations queued on Run</span>
          <button className="btn btn-sm" onClick={onEdit}><Icon name="settings" size={11}/> Edit</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.2fr", gap: 12 }}>
        <DimColumn title="Embedder" items={dims.embedder} />
        <DimColumn title="Chunking" items={dims.chunking} />
        <DimColumn title="Retrieval" items={dims.retrieval} />
        <EvalColumn evals={evals} />
      </div>
    </section>
  );
};

const DimColumn = ({ title, items }) => (
  <div className="card" style={{ padding: 14, background: "var(--bg-0)" }}>
    <div className="row f-between f-center"><span className="t-label">{title}</span><span className="t-mono t-12 t-meta">{items.length}</span></div>
    <div className="col gap-1" style={{ marginTop: 10 }}>
      {items.map(i => (
        <div key={i} className="row gap-8 f-center" style={{
          padding: "6px 8px", border: "1px solid var(--border)", marginBottom: -1,
        }}>
          <span style={{ width: 6, height: 6, background: "var(--accent)", display: "inline-block" }}></span>
          <span className="t-mono t-12" style={{ color: "var(--text-1)" }}>{i}</span>
        </div>
      ))}
    </div>
  </div>
);

const EvalColumn = ({ evals }) => {
  const labels = {
    faithfulness: "Faithfulness", answer_relevance: "Answer Relevance",
    context_precision: "Context Precision", context_recall: "Context Recall",
    latency_p95: "Latency p95", cost_per_query: "Cost / query",
  };
  const active = Object.keys(evals).filter(k => evals[k]);
  return (
    <div className="card" style={{ padding: 14, background: "var(--bg-0)" }}>
      <div className="row f-between f-center"><span className="t-label">Evaluators</span><span className="t-mono t-12 t-meta">{active.length}/6</span></div>
      <div className="col gap-1" style={{ marginTop: 10 }}>
        {Object.keys(labels).map(k => (
          <div key={k} className="row gap-8 f-center" style={{
            padding: "6px 8px", border: "1px solid var(--border)", marginBottom: -1,
            opacity: evals[k] ? 1 : 0.35,
          }}>
            <span style={{ width: 6, height: 6, background: evals[k] ? "var(--accent)" : "var(--text-2)", display: "inline-block" }}></span>
            <span className="t-mono t-12" style={{ color: "var(--text-1)", flex: 1 }}>{labels[k]}</span>
            {evals[k] && <span className="t-12 t-meta">on</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Background batch session bar ----------
const BatchSessionBar = ({ job, etaLabel, onCancel, onDismiss }) => {
  const pct = Math.min(100, Math.round((job.done / job.total) * 100));
  const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
  const remaining = Math.max(0, Math.round(job.etaSec * (1 - job.done / job.total)));
  const remLabel = remaining >= 60 ? `${Math.floor(remaining/60)}분 ${remaining%60}초` : `${remaining}초`;

  const palette = job.status === "running"
    ? { eyebrow: "Background", border: "var(--accent)", dot: "var(--accent)", pulse: true }
    : job.status === "done"
      ? { eyebrow: "Complete", border: "var(--success)", dot: "var(--success)", pulse: false }
      : { eyebrow: "Cancelled", border: "var(--error)", dot: "var(--error)", pulse: false };

  return (
    <section className="card" style={{ padding:"14px 18px", marginBottom:20, borderLeft:`2px solid ${palette.border}`, background:"var(--bg-0)" }}>
      <div className="row f-between f-center" style={{ marginBottom: 10 }}>
        <div className="row gap-12 f-center">
          <span style={{
            width:8, height:8, background:palette.dot, display:"inline-block",
            ...(palette.pulse ? { animation: "pulseGold 1.4s ease-in-out infinite" } : {}),
          }}></span>
          <span className="t-label" style={{color:palette.border}}>{palette.eyebrow}</span>
          <span className="t-13">Batch evaluation · {job.combos} combos × 50 pairs</span>
          <span className="t-mono t-12 t-meta">job_id: {job.id}</span>
        </div>
        <div className="row gap-8 f-center">
          <span className="t-mono t-12 t-meta">
            {job.done.toLocaleString()} / {job.total.toLocaleString()} evals
          </span>
          {job.status === "running" && <button className="btn btn-sm" onClick={onCancel}>Cancel</button>}
          {job.status !== "running" && <button className="btn btn-sm" onClick={onDismiss}>Dismiss</button>}
        </div>
      </div>
      <div style={{ position:"relative", height:3, background:"var(--border)" }}>
        <div style={{
          position:"absolute", inset:0, width:`${pct}%`, background:palette.dot,
          transition: "width 0.5s ease-out",
        }}></div>
      </div>
      <div className="row f-between" style={{ marginTop: 8 }}>
        <span className="t-12 t-meta t-mono">
          {pct}% · elapsed {elapsed}s
          {job.status === "running" && ` · ${remLabel} remaining`}
        </span>
        <span className="t-12 t-meta">
          {job.status === "running" && "다른 화면에서 작업해도 백그라운드에서 계속 진행됩니다."}
          {job.status === "done" && "결과가 아래 표에 추가되었습니다."}
          {job.status === "cancelled" && "이미 완료된 결과는 보존되었습니다."}
        </span>
      </div>
    </section>
  );
};

const ABCompare = ({ a, b }) => {
  const modal = useModal();
  const toast = useToast();
  const metrics = [
    { key: "faithfulness", label: "Faithfulness" },
    { key: "answer_relevance", label: "Answer Relevance" },
    { key: "context_precision", label: "Context Precision" },
    { key: "context_recall", label: "Context Recall" },
  ];
  // Auto summary
  const diffs = metrics.map(m => {
    const av = a.scores[m.key]; const bv = b.scores[m.key];
    if (av == null || bv == null) return null;
    return { label: m.label, delta: av - bv };
  }).filter(Boolean);
  const wins = diffs.filter(d => d.delta > 0.02).map(d => `${d.label} +${d.delta.toFixed(2)}`);
  const losses = diffs.filter(d => d.delta < -0.02).map(d => `${d.label} ${d.delta.toFixed(2)}`);

  return (
    <section className="card" style={{ padding: 24, marginTop: 24 }}>
      <div className="row f-between f-center" style={{ marginBottom: 18 }}>
        <div className="row gap-12 f-center">
          <span className="t-label">A / B Compare</span>
          <LegendDot color="var(--accent)" label={`A · ${a.short}`} />
          <LegendDot color="var(--text-1)" label={`B · ${b.short}`} />
        </div>
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={() => modal.open({
            title: "Export A/B comparison", eyebrow: `${a.short} vs ${b.short}`, width: 620,
            render: ExportModal({
              defaults: {
                format: "yaml",
                filename: `ab-${a.fp}-vs-${b.fp}`,
                path: `~/openrag-lab/exports/${MOCK.workspaces[0].id}`,
                formats: ["yaml", "json", "csv"],
                sectionsConfig: [
                  { id: "configs", label: "Both experiment configs", note: "embedder, chunking, retrieval, llm", size: "1.4 KB", required: true },
                  { id: "scores", label: "Per-metric scores", note: "Ragas + custom evaluators", size: "0.6 KB", required: true },
                  { id: "deltas", label: "Auto-summary deltas", note: "wins, losses, neutral", size: "0.3 KB" },
                  { id: "golden", label: "Golden set used", note: `${MOCK.goldenPairs?.length || 28} Q/A pairs`, size: "8.2 KB" },
                  { id: "samples", label: "Failure samples", note: "10 worst per side", size: "4.1 KB" },
                ],
                includes: { configs: true, scores: true, deltas: true, golden: false, samples: false },
              },
              preview: (fmt) => {
                if (fmt === "yaml") return [
                  `# A/B comparison export`,
                  `# Generated ${new Date().toISOString()}`,
                  ``,
                  `a:`,
                  `  fp: ${a.fp}`,
                  `  embedder: ${a.embedder}`,
                  `  chunking: ${a.chunking}`,
                  `  retrieval: ${a.retrieval}`,
                  `b:`,
                  `  fp: ${b.fp}`,
                  `  embedder: ${b.embedder}`,
                  `  chunking: ${b.chunking}`,
                  `  retrieval: ${b.retrieval}`,
                  ``,
                  `scores:`,
                  ...metrics.map(m => `  ${m.key}: { a: ${a.scores[m.key] ?? "null"}, b: ${b.scores[m.key] ?? "null"} }`),
                  ``,
                  `deltas:`,
                  `  wins: [${wins.map(w => `"${w}"`).join(", ")}]`,
                  `  losses: [${losses.map(l => `"${l}"`).join(", ")}]`,
                ].join("\n");
                if (fmt === "csv") return [
                  "metric,a,b,delta",
                  ...metrics.map(m => `${m.key},${a.scores[m.key] ?? ""},${b.scores[m.key] ?? ""},${(a.scores[m.key] && b.scores[m.key]) ? (a.scores[m.key]-b.scores[m.key]).toFixed(3) : ""}`),
                ].join("\n");
                return JSON.stringify({
                  a: { fp: a.fp, scores: a.scores },
                  b: { fp: b.fp, scores: b.scores },
                  deltas: { wins, losses },
                }, null, 2);
              },
            }),
          })}><Icon name="yaml" size={11}/> Export YAML</button>
          <button className="btn btn-sm" onClick={() => toast.push({eyebrow:"Switched", message:"Showing golden set panel below."})}>Open golden set</button>
        </div>
      </div>

      <BarChart a={a} b={b} metrics={metrics} />

      <div style={{ height: 1, background: "var(--border)", margin: "20px 0" }}></div>

      <div className="row gap-32" style={{ flexWrap: "wrap" }}>
        <div className="col gap-6">
          <span className="t-label" style={{ color: "var(--accent)" }}>A wins</span>
          {wins.length ? wins.map(w => (
            <span key={w} className="t-13 t-mono">{w}</span>
          )) : <span className="t-13 t-meta">—</span>}
        </div>
        <div className="col gap-6">
          <span className="t-label">A loses</span>
          {losses.length ? losses.map(w => (
            <span key={w} className="t-13 t-mono" style={{ color: "var(--text-1)" }}>{w}</span>
          )) : <span className="t-13 t-meta">—</span>}
        </div>
        <div className="col gap-6">
          <span className="t-label">Latency</span>
          <span className="t-13 t-mono">A {a.latency_ms.toLocaleString()}ms · B {b.latency_ms.toLocaleString()}ms</span>
        </div>
      </div>
    </section>
  );
};

const LegendDot = ({ color, label }) => (
  <span className="t-12 row gap-6 f-center" style={{ color: "var(--text-1)" }}>
    <span style={{ width: 10, height: 10, background: color }}></span>{label}
  </span>
);

const BarChart = ({ a, b, metrics }) => {
  const W = 720;
  const H = 200;
  const pad = { l: 40, r: 20, t: 10, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const groupW = innerW / metrics.length;
  const barW = (groupW - 14) / 2;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* gridlines */}
      {[0, 0.25, 0.5, 0.75, 1.0].map(t => {
        const y = pad.t + innerH * (1 - t);
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--border)" strokeWidth="1"/>
            <text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="10"
                  fontFamily="JetBrains Mono" fill="var(--text-2)">{t.toFixed(2)}</text>
          </g>
        );
      })}
      {metrics.map((m, i) => {
        const x0 = pad.l + i * groupW + 7;
        const av = a.scores[m.key]; const bv = b.scores[m.key];
        const ah = av == null ? 0 : innerH * av;
        const bh = bv == null ? 0 : innerH * bv;
        return (
          <g key={m.key}>
            {av != null ? (
              <rect x={x0} y={pad.t + innerH - ah} width={barW} height={ah} fill="var(--accent)"/>
            ) : (
              <text x={x0 + barW/2} y={pad.t + innerH - 4} textAnchor="middle" fontSize="11"
                    fontFamily="JetBrains Mono" fill="var(--text-2)">—</text>
            )}
            {bv != null ? (
              <rect x={x0 + barW + 4} y={pad.t + innerH - bh} width={barW} height={bh}
                    fill="none" stroke="var(--text-1)" strokeWidth="1.5"/>
            ) : (
              <text x={x0 + barW + 4 + barW/2} y={pad.t + innerH - 4} textAnchor="middle" fontSize="11"
                    fontFamily="JetBrains Mono" fill="var(--text-2)">—</text>
            )}
            <text x={x0 + groupW/2 - 7} y={H - 8} textAnchor="middle" fontSize="10"
                  fill="var(--text-1)" letterSpacing="0.04em">{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
};

const GoldenSetPanel = () => {
  const modal = useModal();
  const toast = useToast();
  const [pairs, setPairs] = React.useState([
    { id: "g1", q: "갱신 거절 사유 인정 판례는?", a: "대법원 2019다XXX 판결의 실거주 의사 입증책임…", src: "p.42" },
    { id: "g2", q: "임대인 손해배상 범위는?", a: "환산보증금의 3개월분으로 추정…", src: "p.47" },
    { id: "g3", q: "재건축 계획의 진정성 판단 기준?", a: "자금 조달 계획·시공사 선정 등 실행 가능성…", src: "p.78" },
    { id: "g4", q: "갱신 거절 통지의 절차 요건?", a: "내용증명 우편 송부 시 도달 추정 효력…", src: "p.55" },
  ]);

  const openAdd = () => modal.open({
    title: "Add golden pair", eyebrow: "Golden set", width: 520,
    render: GoldenPairModal({
      onSave: ({ q, a }) => {
        setPairs(p => [...p, { id: "g" + Math.random().toString(36).slice(2,6), q, a, src: "—" }]);
        toast.push({ eyebrow: "Added", message: "New pair saved to golden set." });
      },
    }),
  });

  const openEdit = (pair) => modal.open({
    title: "Edit golden pair", eyebrow: "Golden set", width: 520,
    render: GoldenPairModal({
      initial: pair,
      onSave: (v) => {
        setPairs(p => p.map(x => x.id === pair.id ? {...x, ...v} : x));
        toast.push({ eyebrow: "Saved", message: "Pair updated." });
      },
    }),
  });

  const askDelete = (pair) => confirmModal(modal, {
    title: "Delete this pair?", message: pair.q,
    confirmLabel: "Delete", danger: true,
    onConfirm: () => {
      setPairs(p => p.filter(x => x.id !== pair.id));
      toast.push({ eyebrow: "Deleted", message: "Pair removed.", kind: "error" });
    },
  });

  return (
    <section className="card" style={{ padding: 20, marginTop: 24 }}>
      <div className="row f-between f-center" style={{ marginBottom: 12 }}>
        <div className="row gap-12 f-center">
          <span className="t-label">Golden set · MVP 검증용 50문항</span>
          <span className="t-12 t-meta">{pairs.length} pairs · last edited 2 days ago</span>
        </div>
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={() => modal.open({
            title: "Import golden set", eyebrow: "CSV upload", width: 480,
            render: UploadModal({
              accept: ".csv,.json",
              hint: "CSV with columns: question, expected_answer, source",
              onUpload: (files) => {
                const newPairs = Array.from({ length: 8 }).map((_, i) => ({
                  id: "g_imp_" + i,
                  q: `[Imported] ${files[0].name} · row ${i+1}`,
                  a: "Expected answer from CSV…",
                  src: "—",
                }));
                setPairs(p => [...p, ...newPairs]);
                toast.push({ eyebrow: "Imported", message: `${newPairs.length} pairs added from ${files[0].name}.` });
              },
            }),
          })}><Icon name="upload" size={11}/> Import CSV</button>
          <button className="btn btn-sm" onClick={() => modal.open({
            title: "Export golden set", eyebrow: `${pairs.length} pairs`, width: 580,
            render: ExportModal({
              defaults: {
                format: "csv",
                filename: "golden_set",
                path: `~/openrag-lab/exports/${MOCK.workspaces[0].id}`,
                formats: ["csv", "json", "yaml"],
                sectionsConfig: [
                  { id: "pairs", label: "Q/A pairs", note: "question + expected answer", size: "12 KB", required: true },
                  { id: "sources", label: "Source citations", note: "page numbers, doc refs", size: "1.4 KB" },
                  { id: "meta", label: "Authoring metadata", note: "created_at, author, tags", size: "0.6 KB" },
                ],
                includes: { pairs: true, sources: true, meta: false },
              },
              preview: (fmt) => {
                if (fmt === "csv") return [
                  "id,question,expected_answer,source",
                  ...pairs.slice(0, 6).map(p => `${p.id},"${p.q.replace(/"/g, '""')}","${p.a.replace(/"/g, '""')}",${p.src}`),
                  pairs.length > 6 ? `# … ${pairs.length - 6} more rows` : "",
                ].filter(Boolean).join("\n");
                if (fmt === "yaml") return [
                  `# OpenRAG-Lab golden set`,
                  `total: ${pairs.length}`,
                  `pairs:`,
                  ...pairs.slice(0, 3).flatMap(p => [`  - id: ${p.id}`, `    q: "${p.q}"`, `    a: "${p.a}"`, `    src: ${p.src}`]),
                ].join("\n");
                return JSON.stringify({ total: pairs.length, pairs: pairs.slice(0, 3) }, null, 2);
              },
            }),
          })}><Icon name="yaml" size={11}/> Export</button>
          <button className="btn btn-sm" onClick={openAdd}>+ Add pair</button>
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 90px 80px",
        borderTop: "1px solid var(--border)",
      }}>
        <HeaderCell>Question</HeaderCell>
        <HeaderCell>Expected answer</HeaderCell>
        <HeaderCell align="right">Source</HeaderCell>
        <HeaderCell align="right">Actions</HeaderCell>
      </div>
      {pairs.map((p) => (
        <div key={p.id} style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 90px 80px",
          padding: "12px 0", borderTop: "1px solid var(--border)",
          gap: 16, alignItems: "center",
        }}>
          <span className="t-13">{p.q}</span>
          <span className="t-13 t-meta">{p.a}</span>
          <span className="t-mono t-12 t-meta" style={{ textAlign: "right" }}>{p.src}</span>
          <div className="row gap-4" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => openEdit(p)} title="Edit"
              style={{border:0,background:"transparent",padding:6,cursor:"pointer",color:"var(--text-2)"}}
              onMouseEnter={e=>e.currentTarget.style.color="var(--text-0)"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--text-2)"}>
              <Icon name="settings" size={11}/>
            </button>
            <button onClick={() => askDelete(p)} title="Delete"
              style={{border:0,background:"transparent",padding:6,cursor:"pointer",color:"var(--text-2)"}}
              onMouseEnter={e=>e.currentTarget.style.color="var(--error)"}
              onMouseLeave={e=>e.currentTarget.style.color="var(--text-2)"}>
              <Icon name="trash" size={11}/>
            </button>
          </div>
        </div>
      ))}
      <div className="row gap-12 f-center" style={{ marginTop: 12 }}>
        <Icon name="info" size={11} color="var(--text-2)"/>
        <span className="t-12 t-meta">최소 10개 이상 권장 · 자동 생성(P1)으로 보강 가능합니다.</span>
      </div>
    </section>
  );
};

const ALL_OPTIONS = {
  embedder: ["bge-small-en", "bge-large-en", "MiniLM-L6", "e5-base-v2", "ko-sroberta", "openai-3-small"],
  chunking: ["recursive · 512/64", "recursive · 1024/128", "fixed · 256/0", "semantic · adaptive", "markdown · header"],
  retrieval: ["dense · k=5", "dense · k=8", "hybrid · α=0.5", "bm25 · k=10", "rerank · cohere"],
};
const EVAL_LABELS = {
  faithfulness: { label: "Faithfulness", note: "답변이 retrieved chunks에 충실한가" },
  answer_relevance: { label: "Answer Relevance", note: "질문에 직접 답변하는가" },
  context_precision: { label: "Context Precision", note: "검색된 chunks가 정답에 도움되는가" },
  context_recall: { label: "Context Recall", note: "정답 도출에 필요한 정보가 포함되었는가" },
  latency_p95: { label: "Latency p95", note: "응답 시간 95-percentile" },
  cost_per_query: { label: "Cost / query", note: "임베딩+LLM 평균 비용" },
};

const MatrixDefineForm = ({ dims, setDims, evals, setEvals, close, toast }) => {
  const [local, setLocal] = React.useState(dims);
  const [localEvals, setLocalEvals] = React.useState(evals);
  const combos = local.embedder.length * local.chunking.length * local.retrieval.length;
  const activeEvals = Object.keys(localEvals).filter(k => localEvals[k]).length;
  const totalEvals = combos * 50;
  const etaSec = Math.round(totalEvals * 0.45);
  const etaLabel = etaSec >= 60 ? `${Math.floor(etaSec/60)}분 ${etaSec%60}초` : `${etaSec}초`;

  const toggle = (dim, val) => setLocal(d => ({
    ...d, [dim]: d[dim].includes(val) ? d[dim].filter(x => x !== val) : [...d[dim], val],
  }));
  const toggleEval = (k) => setLocalEvals(e => ({ ...e, [k]: !e[k] }));

  const save = () => {
    if (!combos) return toast.push({ eyebrow: "Invalid", message: "각 차원에서 최소 1개 옵션을 선택하세요.", kind: "error" });
    if (!activeEvals) return toast.push({ eyebrow: "Invalid", message: "최소 1개 평가지표를 선택하세요.", kind: "error" });
    setDims(local); setEvals(localEvals);
    toast.push({ eyebrow: "Saved", message: `Matrix updated · ${combos} combos × ${activeEvals} metrics.` });
    close();
  };

  return (
    <div className="col gap-14">
      <p className="t-13 t-dim" style={{margin:0, lineHeight:1.6}}>
        각 차원에서 비교할 옵션을 토글하세요. 선택한 항목들의 모든 조합이 자동으로 만들어집니다.
      </p>

      {Object.keys(ALL_OPTIONS).map(dim => (
        <div key={dim} className="col gap-6">
          <div className="row f-between f-center">
            <span className="t-label">{dim} <span className="t-12 t-meta">· {local[dim].length} selected</span></span>
          </div>
          <div className="row gap-1" style={{flexWrap:"wrap"}}>
            {ALL_OPTIONS[dim].map(opt => {
              const on = local[dim].includes(opt);
              return (
                <button key={opt} className="btn btn-sm" onClick={() => toggle(dim, opt)}
                  style={{
                    marginRight: -1, marginBottom: -1,
                    borderColor: on ? "var(--accent)" : undefined,
                    color: on ? "var(--accent)" : undefined,
                    background: on ? "rgba(212,175,55,0.06)" : undefined,
                  }}>
                  {on && "✓ "}{opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="col gap-6">
        <div className="row f-between f-center">
          <span className="t-label">Evaluators <span className="t-12 t-meta">· 어떻게 성능을 측정할지</span></span>
          <span className="t-mono t-12 t-meta">{activeEvals}/6 selected</span>
        </div>
        <div className="card" style={{padding:"4px 14px", background:"var(--bg-0)"}}>
          {Object.keys(EVAL_LABELS).map((k, i) => (
            <label key={k} className="row gap-10 f-center" style={{
              padding:"10px 0", cursor:"pointer",
              borderTop: i ? "1px solid var(--border)" : "none",
            }}>
              <input type="checkbox" checked={!!localEvals[k]}
                onChange={() => toggleEval(k)} style={{accentColor:"var(--accent)"}}/>
              <div className="col gap-2" style={{flex:1}}>
                <span className="t-13">{EVAL_LABELS[k].label}</span>
                <span className="t-12 t-meta">{EVAL_LABELS[k].note}</span>
              </div>
              <span className="chip t-mono t-12" style={{fontSize:10}}>{k.startsWith("latency")||k.startsWith("cost") ? "system" : "ragas"}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{padding:14, background:"var(--bg-0)", borderLeft:"2px solid var(--accent)"}}>
        <div className="row f-between" style={{marginBottom:6}}>
          <span className="t-label">Total runs</span>
          <span className="t-mono t-13" style={{color:"var(--accent)"}}>
            {local.embedder.length} × {local.chunking.length} × {local.retrieval.length} = {combos} combos
          </span>
        </div>
        <div className="row f-between t-12 t-meta">
          <span>{combos} combos × 50 golden pairs × {activeEvals} metrics</span>
          <span className="t-mono">{(totalEvals * activeEvals).toLocaleString()} eval calls · ≈ {etaLabel}</span>
        </div>
      </div>

      <div className="row gap-8" style={{justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={save}>Save matrix</button>
      </div>
    </div>
  );
};

window.ExperimentMatrix = ExperimentMatrix;
