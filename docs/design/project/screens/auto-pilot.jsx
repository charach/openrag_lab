// Auto-Pilot Wizard — `/`
// State for prototype: preset selected, 5 files uploaded, indexing 60% in progress.

const AutoPilot = ({ tweak, setExternalCall, setRoute }) => {
  const modal = window.useModal ? window.useModal() : null;
  const toast = window.useToast ? window.useToast() : null;
  const [presetId, setPresetId] = React.useState("balanced");
  const [wsName, setWsName] = React.useState("변호사 자료실");
  const [step, setStep] = React.useState(3); // 1=preset, 2=docs, 3=indexing
  const [progress, setProgress] = React.useState(0.60);

  const trySetPreset = (newId) => {
    if (newId === presetId) return;
    if (!modal) { setPresetId(newId); return; }
    const next = MOCK.presets.find(p => p.id === newId);
    const cur = MOCK.presets.find(p => p.id === presetId);
    if (cur.dim !== next.dim) {
      modal.open({
        title: "Embedder change requires reindex", eyebrow: "Dimension mismatch", width: 520, danger: true,
        render: DimMismatchModal({
          from: { name: cur.embedder, dim: cur.dim },
          to: { name: next.embedder, dim: next.dim },
          archivedCount: 3,
          onConfirm: () => {
            setPresetId(newId);
            toast && toast.push({eyebrow:"Reindexing", message:`Switched to ${next.name} · 3 experiments archived.`});
          },
        }),
      });
    } else {
      setPresetId(newId);
    }
  };

  // Live ticking progress (only when in step 3)
  React.useEffect(() => {
    if (step !== 3) return;
    const id = setInterval(() => {
      setProgress(p => {
        if (p >= 0.995) return 0.60; // loop for demo
        return Math.min(0.999, p + 0.0035);
      });
    }, 220);
    return () => clearInterval(id);
  }, [step]);

  const totalChunks = 224;
  const embedded = Math.floor(totalChunks * progress);
  const stages = [
    { key: "parsed",   label: "Parsed",   value: 5,        total: 5 },
    { key: "chunked",  label: "Chunked",  value: 4,        total: 5 },
    { key: "embedded", label: "Embedded", value: embedded, total: totalChunks, active: true },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 40px 80px" }}>
      <PageHeader
        eyebrow="Auto-Pilot"
        title="Drag your folder, click once, chat in five minutes."
        sub="비전문가도 환경 설정·모델 선택 없이 채팅까지 도달할 수 있도록, 시스템이 모든 파라미터를 자동으로 결정합니다."
      />

      <div className="col gap-16" style={{ marginTop: 32 }}>
        {/* Diagnostic strip */}
        <div className="card" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 28 }}>
          <div className="t-label">System</div>
          <DiagItem label="OS"    value={`${MOCK.profile.os.platform === "darwin" ? "macOS" : MOCK.profile.os.platform} ${MOCK.profile.os.version}`} />
          <DiagItem label="CPU"   value={MOCK.profile.cpu.model} />
          <DiagItem label="RAM"   value={`${MOCK.profile.ram.available_gb} / ${MOCK.profile.ram.total_gb} GB`} />
          <DiagItem label="GPU"   value={MOCK.profile.gpu.name} />
          <DiagItem label="Backend" value={MOCK.profile.gpu.acceleration_backend} accent />
          <div style={{ flex: 1 }}></div>
          <span className="chip"><span className="dot dot-success"></span>Hardware ready</span>
        </div>

        {/* Step 1 — preset */}
        <Step number="01" title="Preset" status={step >= 1 ? "active" : "todo"} subtitle="Recommended for this hardware">
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12,
          }}>
            {MOCK.presets.map(p => (
              <PresetCard key={p.id} preset={p} selected={presetId === p.id} onSelect={() => trySetPreset(p.id)} />
            ))}
          </div>
        </Step>

        {/* Step 2 — workspace + docs */}
        <Step number="02" title="Workspace + Documents" status={step >= 2 ? "done" : "todo"}
              subtitle="5 files · 12.7 MB total">
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
            <div className="col gap-12">
              <div className="col gap-6">
                <span className="t-label">Workspace name</span>
                <input className="input" value={wsName} onChange={e => setWsName(e.target.value)} />
              </div>
              <div className="col gap-6">
                <span className="t-label">Backend</span>
                <div className="t-13 t-mono" style={{ color: "var(--text-1)" }}>
                  bge-small-en · 384d · ChromaDB
                </div>
              </div>
            </div>

            <div className="col gap-12">
              <DropZone />
              <FileList />
              <FailedList />
            </div>
          </div>
        </Step>

        {/* Step 3 — indexing */}
        <Step number="03" title="Indexing" status="active" subtitle={`${Math.round(progress * 100)}% · checkpoints保存中`}>
          <div className="col gap-16">
            {/* Overall progress bar */}
            <div className="col gap-8">
              <div className="row f-between f-center">
                <div className="row gap-8 f-center">
                  <span className="dot dot-gold pulse-gold"></span>
                  <span className="t-13">Embedding · {MOCK.indexingFiles[2].name}</span>
                </div>
                <div className="row gap-12 f-center">
                  <span className="t-mono t-12 t-meta">{embedded.toString().padStart(3, "0")} / {totalChunks} chunks</span>
                  <span className="t-mono t-12" style={{ color: "var(--accent)" }}>{(progress * 100).toFixed(1)}%</span>
                </div>
              </div>
              <div style={{ height: 2, background: "var(--bg-3)", position: "relative" }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, height: "100%",
                  background: "var(--accent)",
                  width: (progress * 100) + "%",
                  transition: "width 220ms linear",
                }}></div>
              </div>
            </div>

            {/* Stage breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {stages.map(s => <StageCard key={s.key} {...s} />)}
            </div>

            {/* Per-file progress */}
            <div className="card" style={{ padding: 0 }}>
              <div style={{
                display: "grid", gridTemplateColumns: "32px 1fr 90px 90px 100px 100px",
                padding: "10px 16px", borderBottom: "1px solid var(--border)",
                fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-2)",
              }}>
                <span></span><span>File</span><span>Size</span><span>Format</span><span>Chunks</span><span style={{ textAlign: "right" }}>Status</span>
              </div>
              {MOCK.indexingFiles.map((f, i) => <FileRow key={i} file={f} />)}
            </div>

            <div className="row gap-12 f-center">
              <span className="t-12 t-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="lock" size={11} /> Resumable — 단계별 체크포인트가 보존됩니다.
              </span>
              <div style={{ flex: 1 }}></div>
              <button className="btn btn-sm" onClick={() => toast && toast.push({eyebrow:"Paused", message:"Indexing paused. Resume anytime."})}>Pause</button>
              <button className="btn btn-sm" onClick={() => modal && confirmModal(modal, {
                title: "Cancel indexing?",
                message: "진행 중인 임베딩이 중단됩니다. 체크포인트는 보존되며 나중에 재개할 수 있습니다.",
                confirmLabel: "Cancel job", danger: true,
                onConfirm: () => toast && toast.push({eyebrow:"Cancelled", message:"Indexing job cancelled.", kind:"error"}),
              })}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={progress < 0.999}
                onClick={() => setRoute && setRoute("chat")}>
                <Icon name="right" size={12} color="#0A0A0A"/> Go to Chat
              </button>
            </div>
          </div>
        </Step>
      </div>
    </div>
  );
};

const PageHeader = ({ eyebrow, title, sub }) => (
  <div className="col gap-12">
    <span className="t-label" style={{ color: "var(--accent)" }}>{eyebrow}</span>
    <h1 className="t-28" style={{ margin: 0, maxWidth: 720, textWrap: "balance" }}>{title}</h1>
    {sub && <p className="t-14 t-dim" style={{ margin: 0, maxWidth: 720 }}>{sub}</p>}
  </div>
);
window.PageHeader = PageHeader;

const DiagItem = ({ label, value, accent }) => (
  <div className="col gap-4">
    <span className="t-label" style={{ fontSize: 9 }}>{label}</span>
    <span className="t-12 t-mono" style={{ color: accent ? "var(--accent)" : "var(--text-0)" }}>{value}</span>
  </div>
);

const Step = ({ number, title, subtitle, status, children }) => {
  const isActive = status === "active";
  const isDone = status === "done";
  return (
    <section className="card" style={{ padding: "20px 24px" }}>
      <div className="row f-between f-center" style={{ marginBottom: 16 }}>
        <div className="row gap-16 f-center">
          <span className="t-mono" style={{
            fontSize: 11, letterSpacing: "0.18em",
            color: isActive ? "var(--accent)" : isDone ? "var(--text-1)" : "var(--text-2)",
          }}>STEP {number}</span>
          <span className="t-20" style={{ fontWeight: 300, color: "var(--text-0)" }}>{title}</span>
          {subtitle && <span className="t-meta t-12" style={{ marginLeft: 4 }}>· {subtitle}</span>}
        </div>
        {isDone && <Icon name="check" size={14} color="var(--success)" />}
        {isActive && <span className="chip chip-gold"><span className="dot dot-gold"></span>In progress</span>}
      </div>
      <div>{children}</div>
    </section>
  );
};

const PresetCard = ({ preset, selected, onSelect }) => {
  return (
    <button onClick={onSelect} disabled={!preset.available}
      style={{
        textAlign: "left", padding: 18,
        background: selected ? "var(--bg-2)" : "var(--bg-0)",
        border: "1px solid " + (selected ? "var(--accent)" : "var(--border-strong)"),
        cursor: preset.available ? "pointer" : "not-allowed",
        opacity: preset.available ? 1 : 0.45,
        fontFamily: "inherit", color: "var(--text-0)",
        position: "relative",
        display: "flex", flexDirection: "column", gap: 10,
        minHeight: 180,
      }}>
      <div className="row f-between f-center">
        <span className="t-label">{preset.id}</span>
        {preset.recommended && <span className="chip chip-gold" style={{ fontSize: 9 }}>Recommended</span>}
      </div>
      <div className="t-20" style={{ fontWeight: 300 }}>{preset.name}</div>
      <p className="t-12 t-meta" style={{ margin: 0, lineHeight: 1.5 }}>{preset.rationale}</p>
      <div style={{ flex: 1 }}></div>
      <div style={{ height: 1, background: "var(--border)" }}></div>
      <div className="col gap-4">
        <KV label="embedder" value={preset.embedder} mono />
        <KV label="chunking" value={preset.chunking} mono />
        <KV label="llm"      value={preset.llm} mono />
        <KV label="memory"   value={preset.ramHint} />
      </div>
      {selected && (
        <span style={{
          position: "absolute", top: -1, left: -1,
          width: 7, height: 7, background: "var(--accent)",
        }}></span>
      )}
    </button>
  );
};

const KV = ({ label, value, mono }) => (
  <div className="row f-between" style={{ gap: 10 }}>
    <span className="t-meta t-12" style={{ minWidth: 64 }}>{label}</span>
    <span className={"t-12 " + (mono ? "t-mono" : "")} style={{
      color: "var(--text-1)",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      textAlign: "right",
    }}>{value}</span>
  </div>
);

const DropZone = () => (
  <div style={{
    border: "1px dashed var(--border-strong)",
    padding: "32px 24px",
    textAlign: "center",
    background: "var(--bg-0)",
  }}>
    <Icon name="upload" size={20} color="var(--text-2)" />
    <div className="t-14" style={{ marginTop: 10 }}>Drop PDF · TXT · Markdown anywhere here</div>
    <div className="t-12 t-meta" style={{ marginTop: 4 }}>
      파일이나 폴더를 통째로 끌어다 놓으세요. 변환 실패 파일은 별도로 보존됩니다.
    </div>
  </div>
);

const FileList = () => (
  <div className="col gap-1" style={{ borderTop: "1px solid var(--border)" }}>
    <div style={{
      display: "grid", gridTemplateColumns: "32px 1fr 80px 60px 28px",
      padding: "8px 4px",
      fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-2)",
    }}>
      <span></span><span>Filename</span><span>Size</span><span>Format</span><span></span>
    </div>
    {MOCK.indexingFiles.map((f, i) => (
      <div key={i} style={{
        display: "grid", gridTemplateColumns: "32px 1fr 80px 60px 28px",
        padding: "10px 4px",
        borderTop: "1px solid var(--border)",
        alignItems: "center",
      }}>
        <Icon name="doc" size={14} color="var(--text-2)" />
        <span className="t-13">{f.name}</span>
        <span className="t-12 t-mono t-meta">{f.size}</span>
        <span><FormatTag format={f.format} /></span>
        <button className="btn-ghost" style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--text-2)" }}>
          <Icon name="x" size={11} />
        </button>
      </div>
    ))}
  </div>
);

const FailedList = () => (
  <div style={{
    border: "1px solid var(--border)",
    background: "var(--bg-0)",
    padding: 12,
  }}>
    <div className="row gap-8 f-center" style={{ marginBottom: 8 }}>
      <Icon name="alert" size={12} color="var(--error)" />
      <span className="t-12 t-label" style={{ color: "var(--error)" }}>1 file failed · 다른 파일은 정상 진행됨</span>
    </div>
    {MOCK.failedFiles.map((f, i) => (
      <div key={i} style={{
        display: "grid", gridTemplateColumns: "1fr auto auto",
        gap: 12, alignItems: "center",
        padding: "6px 0",
      }}>
        <span className="t-13">{f.name}</span>
        <span className="t-mono t-12 t-meta">{f.reason}</span>
        <button className="btn btn-sm">Retry</button>
      </div>
    ))}
  </div>
);

const StageCard = ({ label, value, total, active }) => {
  const pct = (value / total) * 100;
  return (
    <div style={{
      background: "var(--bg-0)",
      border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
      padding: 14,
    }}>
      <div className="row f-between f-center">
        <span className="t-label">{label}</span>
        {active ? <span className="dot dot-gold pulse-gold"></span> : <Icon name="check" size={11} color="var(--success)" />}
      </div>
      <div className="t-20 t-mono" style={{ marginTop: 6, fontWeight: 300, color: active ? "var(--accent)" : "var(--text-0)" }}>
        {value.toLocaleString()}<span className="t-12 t-meta" style={{ marginLeft: 6 }}>/ {total.toLocaleString()}</span>
      </div>
      <div style={{ height: 1, background: "var(--bg-3)", marginTop: 10, position: "relative" }}>
        <div style={{
          position: "absolute", top: 0, left: 0, height: "100%",
          background: active ? "var(--accent)" : "var(--text-1)",
          width: pct + "%", transition: "width 220ms linear",
        }}></div>
      </div>
    </div>
  );
};

const FileRow = ({ file }) => {
  const status = file.status;
  const statusColor = {
    embedded: "var(--success)",
    embedding: "var(--accent)",
    chunked: "var(--text-1)",
    queued: "var(--text-2)",
  }[status];
  const statusText = {
    embedded: "Embedded",
    embedding: "Embedding…",
    chunked: "Chunked",
    queued: "Queued",
  }[status];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "32px 1fr 90px 90px 100px 100px",
      padding: "10px 16px",
      borderBottom: "1px solid var(--border)",
      alignItems: "center",
    }}>
      <Icon name="doc" size={13} color="var(--text-2)" />
      <span className="t-13">{file.name}</span>
      <span className="t-12 t-mono t-meta">{file.size}</span>
      <span><FormatTag format={file.format} /></span>
      <span className="t-12 t-mono t-meta">{file.chunks > 0 ? file.chunks : "—"}</span>
      <span className="t-12" style={{ color: statusColor, textAlign: "right" }}>
        {status === "embedding" && file.progress != null
          ? <>Embedding · <span className="t-mono">{Math.round(file.progress * 100)}%</span></>
          : statusText}
      </span>
    </div>
  );
};

window.AutoPilot = AutoPilot;
