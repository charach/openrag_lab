// Chunking Lab — `/chunking`
// Live simulator: slider values drive a real chunker over the source text.

// ---------- Source corpus ----------
// Build a long-form Korean document from the previewParagraphs in MOCK
// + a few extra paragraphs so we can exercise larger chunk sizes.
const buildCorpus = () => {
  const extra = [
    "한편 임차인이 갱신 거절 통지에 불복하는 경우, 통지 도달 후 30일 이내에 임대차분쟁조정위원회에 조정을 신청할 수 있다. 조정 절차에서는 거절 사유의 정당성, 통지 형식의 적법성, 손해 발생 여부 등이 종합적으로 검토된다.",
    "조정이 결렬된 경우 당사자는 법원에 본안 소송을 제기할 수 있으며, 이때 거증책임의 분배에 관한 일반 원칙이 적용된다. 즉 임대인은 거절의 정당한 사유를, 임차인은 손해의 발생과 그 범위를 각각 입증해야 한다.",
    "최근 하급심 판결의 동향을 보면, 단순한 시세 차익을 노린 매도 후 신규 임대 사례에서 법원은 대체로 임차인의 손해배상 청구를 인용하는 추세이다. 이는 갱신 거절 제도의 입법 취지가 임차인의 주거 안정에 있다는 점을 강조한 것이다.",
    "다만 임대인이 갱신 거절 후 실제로 6개월 이상 공실로 두거나, 직계 가족이 실거주하였음을 객관적 증빙으로 입증한 경우에는 손해배상 책임이 부정되어 왔다. 객관적 증빙으로는 전입신고 기록, 공과금 납부 내역, 인접 주민의 진술 등이 활용된다.",
    "실무자가 유의할 점은 갱신 거절 통지의 형식적 요건이다. 서면 교부 또는 내용증명 우편 송부가 권장되며, 통지서에는 거절 사유의 구체적 내용, 거절 의사의 명확한 표시, 통지 일자가 포함되어야 한다.",
  ];
  const all = [...MOCK.previewParagraphs, ...extra];
  return all.join("\n\n");
};

// ---------- Tokenizer (rough) ----------
// Approximate token count: 1 Korean char ≈ 1.6 tokens, 1 non-Korean char ≈ 0.3 tokens.
// Returns total estimated token count for a string.
const estimateTokens = (s) => {
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // CJK Hangul / Hanja blocks
    if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3130 && c <= 0x318F) || (c >= 0x4E00 && c <= 0x9FFF)) {
      t += 1.6;
    } else if (c === 0x20 || c === 0x0A) {
      t += 0.3;
    } else {
      t += 0.4;
    }
  }
  return t;
};

// ---------- Chunkers ----------
// Each chunker returns: [{ start, end, tokens, overlapStart, overlapEnd }]
// overlapStart/overlapEnd are character offsets within the chunk that came from
// the previous/next chunk respectively (for stripe rendering).

// Fixed: byte/char-based windows.
const chunkFixed = (text, sizeTokens, overlapTokens) => {
  // Approx char window — tune by tokens-per-char ratio of full text.
  const totalTokens = estimateTokens(text);
  const charsPerTok = text.length / Math.max(1, totalTokens);
  const win = Math.max(20, Math.round(sizeTokens * charsPerTok));
  const step = Math.max(1, win - Math.round(overlapTokens * charsPerTok));
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    const end = Math.min(text.length, i + win);
    const overlapStart = i === 0 ? 0 : Math.min(end - start, Math.round(overlapTokens * charsPerTok));
    out.push({
      start, end,
      tokens: Math.round(estimateTokens(text.slice(start, end))),
      overlapStart, overlapEnd: 0, // overlapEnd patched below
    });
    if (end >= text.length) break;
    i += step;
  }
  // patch overlapEnd: the last `overlap` chars of chunk N are shared with chunk N+1
  for (let k = 0; k < out.length - 1; k++) {
    const overlapChars = Math.round(overlapTokens * charsPerTok);
    out[k].overlapEnd = Math.min(out[k].end - out[k].start, overlapChars);
  }
  return out;
};

// Recursive: prefer to split on paragraph break, then sentence, then word.
// Builds chunks by walking sentences and accumulating until token budget reached.
const chunkRecursive = (text, sizeTokens, overlapTokens) => {
  // Sentence-tokenize: split on . ? ! 。 ? ! and Korean sentence enders + newlines.
  const re = /([^\n.?!。？！]+[\n.?!。？！]+|[^\n.?!。？！]+$)/g;
  const sentences = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim().length === 0) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    sentences.push({ start, end, text: m[0] });
  }
  if (sentences.length === 0) return [];

  // Pre-compute token counts.
  const sToks = sentences.map(s => estimateTokens(s.text));

  const out = [];
  let i = 0;
  while (i < sentences.length) {
    let start = sentences[i].start;
    let end = sentences[i].end;
    let toks = sToks[i];
    let j = i;
    while (j + 1 < sentences.length && toks + sToks[j + 1] <= sizeTokens) {
      j++;
      end = sentences[j].end;
      toks += sToks[j];
    }
    out.push({ start, end, tokens: Math.round(toks), overlapStart: 0, overlapEnd: 0, sentRange: [i, j] });
    if (j + 1 >= sentences.length) break;
    // Step forward but bring back `overlap` worth of sentences from the tail.
    let backToks = 0;
    let k = j;
    while (k > i && backToks + sToks[k] <= overlapTokens) {
      backToks += sToks[k];
      k--;
    }
    // Walk back by `overlap` worth of sentences so chunks share tail/head.
    // k+1 is the new start; guarantee forward progress with i+1.
    i = Math.max(i + 1, Math.min(k + 1, j + 1));
  }

  // Compute overlap regions between adjacent chunks
  for (let k = 0; k < out.length - 1; k++) {
    const a = out[k], b = out[k + 1];
    if (b.start < a.end) {
      const overlapLen = a.end - b.start;
      a.overlapEnd = Math.min(a.end - a.start, overlapLen);
      b.overlapStart = Math.min(b.end - b.start, overlapLen);
    }
  }
  return out;
};

const runChunker = (strategy, text, sizeTokens, overlapTokens) => {
  if (strategy === "fixed") return chunkFixed(text, sizeTokens, overlapTokens);
  return chunkRecursive(text, sizeTokens, overlapTokens);
};

// ---------- Color palette (deterministic per index) ----------
const CHUNK_COLORS = [
  "#5A5A5A", "#7A7468", "#9A9488", "#B8B2A4",
  "#3A3A3A", "#6A6258", "#8A8478", "#5A6E51",
  "#7A7468", "#9A9488", "#3A3A3A", "#B8B2A4",
];
const colorFor = (i) => CHUNK_COLORS[i % CHUNK_COLORS.length];

// ---------- Component ----------
const ChunkingLab = () => {
  const modal = window.useModal ? window.useModal() : null;
  const toast = window.useToast ? window.useToast() : null;
  const [strategy, setStrategy] = React.useState("recursive");
  const [chunkSize, setChunkSize] = React.useState(512);
  const [overlap, setOverlap] = React.useState(64);
  const [docId, setDocId] = React.useState(MOCK.chunkingDoc.id);
  const [hoverChunk, setHoverChunk] = React.useState(null);
  const [docPickerOpen, setDocPickerOpen] = React.useState(false);
  const [showOverlap, setShowOverlap] = React.useState(true);

  // Available docs
  const availableDocs = MOCK.indexingFiles
    .filter(f => f.status === "embedded" || f.status === "embedding")
    .map((f, i) => ({ id: "doc_" + (100 + i), filename: f.name, pages: 84 - i*7 }));
  const currentDoc = availableDocs.find(d => d.id === docId) || { ...MOCK.chunkingDoc };

  // Source text
  const text = React.useMemo(() => buildCorpus(), [docId]);

  // Run chunker — debounced lightly via useDeferredValue (200ms feel)
  const deferredSize = React.useDeferredValue ? React.useDeferredValue(chunkSize) : chunkSize;
  const deferredOverlap = React.useDeferredValue ? React.useDeferredValue(overlap) : overlap;
  const computing = deferredSize !== chunkSize || deferredOverlap !== overlap;

  const chunks = React.useMemo(
    () => runChunker(strategy, text, deferredSize, deferredOverlap),
    [strategy, text, deferredSize, deferredOverlap]
  );

  // Metrics
  const totalChunks = chunks.length;
  const tokens = chunks.map(c => c.tokens);
  const avgTokens = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0;
  const minTokens = tokens.length ? Math.min(...tokens) : 0;
  const maxTokens = tokens.length ? Math.max(...tokens) : 0;
  const totalChars = text.length;
  const overlapChars = chunks.reduce((s, c) => s + (c.overlapStart || 0), 0);
  const overlapPct = totalChars ? (overlapChars / totalChars) * 100 : 0;

  const strategies = [
    { id: "fixed", label: "Fixed", note: "char window", enabled: true },
    { id: "recursive", label: "Recursive", note: "sentence-aware", enabled: true },
  ];

  const openUpload = () => modal && modal.open({
    title: "Upload document for chunking", eyebrow: "Quick test", width: 540,
    render: UploadModal({
      onUpload: (files) => {
        toast && toast.push({ eyebrow: "Uploaded", message: `${files[0].name} ready for chunking.` });
      },
    }),
  });

  return (
    <div style={{ height: "calc(100vh - 56px)", display: "grid", gridTemplateColumns: "380px 1fr" }}>
      {/* Left — controls */}
      <aside style={{
        borderRight: "1px solid var(--border)",
        background: "var(--bg-1)",
        padding: "24px 24px 32px",
        overflowY: "auto",
      }}>
        <PageHeader eyebrow="Chunking Lab" title="See how splits change retrieval." />

        <div style={{ marginTop: 24 }} className="col gap-20">
          {/* Document picker */}
          <div className="col gap-8">
            <span className="t-label">Document</span>
            <div className="card" style={{ padding: 0, position: "relative" }}>
              <button onClick={() => setDocPickerOpen(o => !o)} style={{
                width: "100%", padding: "10px 12px", textAlign: "left",
                background: "transparent", border: 0, color: "var(--text-0)",
                fontFamily: "inherit", cursor: "pointer",
              }}>
                <div className="row f-between f-center">
                  <div className="row gap-8 f-center">
                    <Icon name="doc" size={13} color="var(--text-2)" />
                    <span className="t-13">{currentDoc.filename}</span>
                  </div>
                  <div className="row gap-8 f-center">
                    <span className="t-mono t-12 t-meta">{text.length.toLocaleString()} chars</span>
                    <Icon name="down" size={11} color="var(--text-2)"/>
                  </div>
                </div>
              </button>
              {docPickerOpen && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0,
                  background: "var(--bg-1)", border: "1px solid var(--border-strong)",
                  zIndex: 20, marginTop: 2,
                }}>
                  {availableDocs.map(d => (
                    <button key={d.id} onClick={() => { setDocId(d.id); setDocPickerOpen(false); }}
                      style={{
                        width: "100%", textAlign: "left", padding: "10px 12px",
                        border: 0, borderBottom: "1px solid var(--border)",
                        background: d.id === docId ? "var(--bg-2)" : "transparent",
                        color: "var(--text-0)", cursor: "pointer", fontFamily: "inherit",
                      }}>
                      <div className="row f-between f-center">
                        <span className="t-13">{d.filename}</span>
                        <span className="t-mono t-12 t-meta">{d.pages}p</span>
                      </div>
                    </button>
                  ))}
                  <button className="btn btn-sm" style={{ width: "100%", justifyContent: "center", margin: 0, border: 0 }}
                    onClick={() => { setDocPickerOpen(false); openUpload(); }}>
                    + Upload another document
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Strategy */}
          <div className="col gap-8">
            <span className="t-label">Strategy</span>
            <div className="col gap-1">
              {strategies.map(s => (
                <button key={s.id}
                  onClick={() => s.enabled && setStrategy(s.id)}
                  disabled={!s.enabled}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 12px",
                    background: strategy === s.id ? "var(--bg-2)" : "var(--bg-0)",
                    border: "1px solid " + (strategy === s.id ? "var(--accent)" : "var(--border-strong)"),
                    color: s.enabled ? "var(--text-0)" : "var(--text-2)",
                    cursor: s.enabled ? "pointer" : "not-allowed",
                    opacity: s.enabled ? 1 : 0.5,
                    fontFamily: "inherit",
                    marginBottom: -1,
                  }}>
                  <div className="row gap-8 f-center">
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      border: "1px solid " + (strategy === s.id ? "var(--accent)" : "var(--text-2)"),
                      background: strategy === s.id ? "var(--accent)" : "transparent",
                    }}></span>
                    <span className="t-13">{s.label}</span>
                  </div>
                  <span className="t-mono t-12 t-meta">{s.note}</span>
                </button>
              ))}
            </div>
            <span className="t-12 t-meta" style={{ lineHeight: 1.5 }}>
              {strategy === "fixed"
                ? "고정 크기 윈도우 — 의미 경계 무시, 연산 빠름."
                : "문장 단위로 누적, 토큰 한도 도달 시 분할 — 한국어 종결어미 기준."}
            </span>
          </div>

          {/* Sliders */}
          <Slider label="Chunk size" value={chunkSize} onChange={setChunkSize} min={128} max={2048} step={32} unit="tokens" />
          <Slider label="Overlap"    value={overlap}   onChange={v => setOverlap(Math.min(v, Math.floor(chunkSize/2)))} min={0}   max={Math.floor(chunkSize/2)} step={8} unit="tokens" />

          {/* Live metrics */}
          <div className="col gap-8">
            <div className="row f-between f-center">
              <span className="t-label">Live metrics</span>
              {computing && <span className="chip chip-gold" style={{fontSize:9}}><span className="dot dot-gold pulse-gold"></span>computing…</span>}
            </div>
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Metric label="Chunks" value={totalChunks} accent />
                <Metric label="Avg tokens" value={avgTokens} mono />
                <Metric label="Min" value={minTokens} mono />
                <Metric label="Max" value={maxTokens} mono />
              </div>
              <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }}></div>
              <DistributionBar tokens={tokens} target={chunkSize} />
              <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }}></div>
              <div className="t-12 t-meta row f-between">
                <span>Overlap coverage</span>
                <span className="t-mono" style={{color: overlapPct > 0 ? "var(--accent)" : "var(--text-2)"}}>
                  {overlapPct.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <div className="col gap-8">
            <button className="btn btn-primary" style={{ justifyContent: "center" }}
              onClick={() => modal && confirmModal(modal, {
                title: "Run as new experiment?",
                message: `현재 청킹 설정 (${strategy} · ${chunkSize}/${overlap}) 으로 ${currentDoc.filename}를 다시 인덱싱하고 새 실험 결과를 만듭니다. 기존 실험은 보존됩니다.`,
                confirmLabel: "Run experiment",
                onConfirm: () => toast && toast.push({eyebrow:"Started", message:"새 실험 fp_xxxx — 인덱싱 진행 중."}),
              })}>
              <Icon name="play" size={12} color="#0A0A0A" />
              Run as new experiment
            </button>
            <button className="btn" style={{ justifyContent: "center" }}
              onClick={() => modal && modal.open({
                title: "Export chunking config", eyebrow: "Reproducible YAML", width: 600,
                render: ExportModal({
                  defaults: {
                    format: "yaml",
                    filename: `chunking-${strategy}-${chunkSize}-${overlap}`,
                    path: `~/openrag-lab/exports/${MOCK.workspaces[0].id}`,
                    formats: ["yaml", "json"],
                    sectionsConfig: [
                      { id: "chunking", label: "Chunking parameters", note: "strategy, size, overlap", size: "0.4 KB", required: true },
                      { id: "stats", label: "Resulting stats", note: `${chunks.length} chunks, distribution`, size: "0.6 KB" },
                      { id: "samples", label: "Sample chunks (first 3)", note: "for human verification", size: "1.4 KB" },
                    ],
                    includes: { chunking: true, stats: true, samples: false },
                  },
                  preview: (fmt) => fmt === "yaml" ? [
                    `# OpenRAG-Lab chunking config`,
                    `# Document: ${currentDoc.filename}`,
                    `# Generated ${new Date().toISOString()}`,
                    ``,
                    `chunking:`,
                    `  strategy: ${strategy}`,
                    `  chunk_size: ${chunkSize}`,
                    `  overlap: ${overlap}`,
                    `  separators: ["\\n\\n", "\\n", ". ", "。", " "]`,
                    ``,
                    `# Resulting stats (informational)`,
                    `stats:`,
                    `  total_chunks: ${chunks.length}`,
                    `  avg_tokens: ${avgTokens}`,
                    `  min_tokens: ${minTokens}`,
                    `  max_tokens: ${maxTokens}`,
                    `  overlap_coverage_pct: ${overlapPct.toFixed(2)}`,
                  ].join("\n") : JSON.stringify({
                    chunking: { strategy, chunk_size: chunkSize, overlap },
                    stats: { total_chunks: chunks.length, avg_tokens: avgTokens, min_tokens: minTokens, max_tokens: maxTokens },
                  }, null, 2),
                }),
              })}>
              <Icon name="yaml" size={12} /> Export YAML
            </button>
          </div>
        </div>
      </aside>

      {/* Right — preview */}
      <main style={{ overflowY: "auto", padding: "24px 32px 80px", background: "var(--bg-0)" }}>
        <div className="row f-between f-center" style={{ marginBottom: 14 }}>
          <div className="row gap-12 f-center">
            <span className="t-label">Preview · {currentDoc.filename}</span>
            <span className="chip chip-mono">{strategy} · {chunkSize}/{overlap}</span>
            <span className="chip chip-mono">{totalChunks} chunks</span>
          </div>
          <div className="row gap-16 f-center">
            <label className="row gap-6 f-center t-12 t-meta" style={{cursor:"pointer"}}>
              <input type="checkbox" checked={showOverlap} onChange={e=>setShowOverlap(e.target.checked)}
                style={{accentColor:"var(--accent)"}}/>
              Show overlap stripes
            </label>
            <Legend />
          </div>
        </div>

        {/* Chunk strip — top-of-page horizontal map */}
        <ChunkStrip chunks={chunks} totalChars={text.length}
                    hoverChunk={hoverChunk} setHoverChunk={setHoverChunk} />

        {/* Document preview */}
        <div className="card" style={{ padding: "32px 40px", lineHeight: 1.95, marginTop: 14, fontSize: 14 }}>
          {chunks.length === 0
            ? <span className="t-12 t-meta">No chunks generated.</span>
            : chunks.map((c, i) => (
                <ChunkSpan key={i}
                  index={i}
                  chunk={c}
                  text={text}
                  showOverlap={showOverlap}
                  prevColor={i > 0 ? colorFor(i - 1) : null}
                  nextColor={i < chunks.length - 1 ? colorFor(i + 1) : null}
                  hovered={hoverChunk === i}
                  onHover={() => setHoverChunk(i)}
                  onLeave={() => setHoverChunk(null)} />
              ))}
        </div>

        {hoverChunk !== null && chunks[hoverChunk] && (
          <ChunkInspector index={hoverChunk} chunk={chunks[hoverChunk]} text={text} />
        )}
      </main>
    </div>
  );
};

// ---------- Chunk strip ----------
// Horizontal bar showing each chunk as a proportional segment of the doc.
const ChunkStrip = ({ chunks, totalChars, hoverChunk, setHoverChunk }) => (
  <div className="card" style={{ padding: 12 }}>
    <div className="row f-between f-center" style={{ marginBottom: 8 }}>
      <span className="t-label" style={{ fontSize: 9 }}>Chunk map · proportional</span>
      <span className="t-12 t-mono t-meta">{totalChars.toLocaleString()} chars total</span>
    </div>
    <div style={{ display: "flex", height: 14, gap: 1, overflow: "hidden" }}>
      {chunks.map((c, i) => {
        const w = ((c.end - c.start) / totalChars) * 100;
        return (
          <div key={i}
            onMouseEnter={() => setHoverChunk(i)}
            onMouseLeave={() => setHoverChunk(null)}
            title={`Chunk ${String(i).padStart(2,"0")} · ${c.tokens} tokens`}
            style={{
              width: `${w}%`,
              background: hoverChunk === i ? colorFor(i) : `${colorFor(i)}99`,
              borderTop: hoverChunk === i ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer", transition: "all 120ms",
            }}/>
        );
      })}
    </div>
    <div className="row f-between t-12 t-mono t-meta" style={{ marginTop: 6 }}>
      <span>0</span>
      <span>{Math.round(totalChars/2).toLocaleString()}</span>
      <span>{totalChars.toLocaleString()}</span>
    </div>
  </div>
);

// ---------- Distribution histogram ----------
const DistributionBar = ({ tokens, target }) => {
  if (!tokens.length) return null;
  const max = Math.max(...tokens, target);
  return (
    <div className="col gap-4">
      <span className="t-label" style={{fontSize:9}}>Token distribution</span>
      <div style={{
        position: "relative", height: 36,
        display: "flex", alignItems: "flex-end",
        gap: 1,
        background: "var(--bg-0)",
        padding: 2,
      }}>
        {tokens.map((t, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${(t / max) * 100}%`,
            background: t >= target * 0.95 ? "var(--accent)" : "var(--text-1)",
            opacity: 0.7,
            minHeight: 2,
          }}/>
        ))}
        {/* target line */}
        <div style={{
          position: "absolute", left: 2, right: 2,
          bottom: `${(target / max) * 100}%`,
          height: 1,
          background: "var(--accent)",
          opacity: 0.6,
        }}/>
      </div>
      <div className="row f-between t-12 t-mono t-meta">
        <span>0</span>
        <span style={{color:"var(--accent)"}}>target {target}</span>
        <span>{max}</span>
      </div>
    </div>
  );
};

const Slider = ({ label, value, onChange, min, max, step, unit }) => (
  <div className="col gap-6">
    <div className="row f-between f-center">
      <span className="t-label">{label}</span>
      <span className="t-mono t-13" style={{ color: "var(--accent)" }}>
        {value}<span className="t-meta t-12" style={{ marginLeft: 4 }}>{unit}</span>
      </span>
    </div>
    <input type="range" className="range" min={min} max={max} step={step}
           value={value} onChange={e => onChange(parseInt(e.target.value))} />
    <div className="row f-between t-12 t-meta t-mono">
      <span>{min}</span><span>{max}</span>
    </div>
  </div>
);

const Metric = ({ label, value, mono = true, accent }) => (
  <div className="col gap-2">
    <span className="t-label" style={{ fontSize: 9 }}>{label}</span>
    <span className={mono ? "t-mono" : ""} style={{
      fontSize: 18, fontWeight: 300,
      color: accent ? "var(--accent)" : "var(--text-0)",
    }}>{typeof value === "number" ? value.toLocaleString() : value}</span>
  </div>
);

const Legend = () => (
  <div className="row gap-8 f-center">
    <div className="row gap-3">
      {[0,1,2,3,4,5].map(i => (
        <span key={i} style={{ width: 14, height: 10, background: colorFor(i), opacity: 0.5 }}></span>
      ))}
    </div>
    <span className="t-12 t-meta">each color = one chunk</span>
  </div>
);

// ---------- ChunkSpan ----------
// Renders one chunk's slice of text. Splits the slice into:
//   [overlap-with-prev region] [body] [overlap-with-next region]
// Each rendered with appropriate striped or solid background.
const ChunkSpan = ({ index, chunk, text, showOverlap, prevColor, nextColor, hovered, onHover, onLeave }) => {
  const color = colorFor(index);
  const slice = text.slice(chunk.start, chunk.end);
  const len = slice.length;

  const oS = showOverlap ? Math.min(chunk.overlapStart || 0, len) : 0;
  const oE = showOverlap ? Math.min(chunk.overlapEnd || 0, len - oS) : 0;

  const head = slice.slice(0, oS);
  const body = slice.slice(oS, len - oE);
  const tail = slice.slice(len - oE, len);

  const stripeWith = (a, b) => `repeating-linear-gradient(135deg, ${a}66 0 4px, ${b}66 4px 8px)`;

  return (
    <span onMouseEnter={onHover} onMouseLeave={onLeave}
      style={{
        position: "relative",
        display: "inline",
        cursor: "default",
        outline: hovered ? `1px solid var(--accent)` : "none",
        outlineOffset: 1,
        transition: "outline 120ms",
      }}>
      {/* chunk start marker */}
      <sup className="t-mono" style={{
        fontSize: 9,
        color: hovered ? "var(--accent)" : "var(--text-2)",
        background: hovered ? "var(--accent-faint)" : "transparent",
        padding: "0 3px",
        marginRight: 2,
        verticalAlign: "super",
        userSelect: "none",
      }}>
        {String(index).padStart(2, "0")}
      </sup>
      {head && prevColor && (
        <span style={{
          background: stripeWith(prevColor, color),
          padding: "2px 0",
        }}>{head}</span>
      )}
      <span style={{
        background: hovered ? `${color}AA` : `${color}55`,
        padding: "2px 0",
        transition: "background 120ms",
      }}>{body}</span>
      {tail && nextColor && (
        <span style={{
          background: stripeWith(color, nextColor),
          padding: "2px 0",
        }}>{tail}</span>
      )}
    </span>
  );
};

// ---------- Inspector ----------
const ChunkInspector = ({ index, chunk, text }) => {
  const preview = text.slice(chunk.start, Math.min(chunk.end, chunk.start + 80));
  return (
    <div style={{
      position: "fixed", right: 24, bottom: 24,
      background: "var(--bg-1)", border: "1px solid var(--border-strong)",
      padding: "14px 16px", minWidth: 320, maxWidth: 360,
      zIndex: 20,
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    }}>
      <div className="row f-between f-center" style={{ marginBottom: 10 }}>
        <span className="t-label">Chunk inspector</span>
        <span className="t-mono t-12" style={{ color: "var(--accent)" }}>
          {String(index).padStart(2,"0")}
        </span>
      </div>
      <div className="col gap-4 t-12 t-mono" style={{marginBottom: 10}}>
        <div className="row f-between"><span className="t-meta">char range</span><span>{chunk.start}–{chunk.end}</span></div>
        <div className="row f-between"><span className="t-meta">tokens</span><span style={{color:"var(--accent)"}}>{chunk.tokens}</span></div>
        <div className="row f-between"><span className="t-meta">length</span><span>{chunk.end - chunk.start} chars</span></div>
        <div className="row f-between">
          <span className="t-meta">overlap (prev/next)</span>
          <span>{chunk.overlapStart || 0} / {chunk.overlapEnd || 0}</span>
        </div>
      </div>
      <div style={{
        background: "var(--bg-0)", border: "1px solid var(--border)",
        padding: "8px 10px", fontSize: 11, lineHeight: 1.5,
        color: "var(--text-1)",
        textWrap: "pretty",
      }}>
        {preview}{chunk.end - chunk.start > 80 ? "…" : ""}
      </div>
    </div>
  );
};

window.ChunkingLab = ChunkingLab;
