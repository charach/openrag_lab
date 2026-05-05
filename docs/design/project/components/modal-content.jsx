// CRUD modals + new-workspace, document-CRUD, golden-set CRUD, license, dim-mismatch

const NewWorkspaceModal = ({ onCreate }) => ({ close }) => {
  const [name, setName] = React.useState("");
  const [preset, setPreset] = React.useState("balanced");
  return (
    <div className="col gap-16">
      <div className="col gap-6">
        <span className="t-label">Workspace name</span>
        <input className="input" autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. 사내 매뉴얼" />
        <span className="t-12 t-meta">1–200자. 다른 워크스페이스와 격리됩니다.</span>
      </div>
      <div className="col gap-6">
        <span className="t-label">Preset</span>
        <div className="col gap-1">
          {MOCK.presets.map(p => (
            <button key={p.id} onClick={()=>setPreset(p.id)} disabled={!p.available}
              style={{
                textAlign:"left", padding:"10px 12px",
                background: preset===p.id ? "var(--bg-2)" : "var(--bg-0)",
                border: "1px solid " + (preset===p.id ? "var(--accent)" : "var(--border-strong)"),
                color:"var(--text-0)", cursor:"pointer", fontFamily:"inherit",
                marginBottom:-1,
              }}>
              <div className="row f-between f-center">
                <span className="t-13">{p.name}</span>
                <span className="t-mono t-12 t-meta">{p.embedder}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="row gap-8" style={{justifyContent:"flex-end", marginTop:4}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={!name.trim()}
          onClick={()=>{ onCreate({name:name.trim(),preset}); close(); }}>Create workspace</button>
      </div>
    </div>
  );
};
window.NewWorkspaceModal = NewWorkspaceModal;

const RenameModal = ({ initial, onSave }) => ({ close }) => {
  const [v, setV] = React.useState(initial);
  return (
    <div className="col gap-16">
      <div className="col gap-6">
        <span className="t-label">Name</span>
        <input className="input" autoFocus value={v} onChange={e=>setV(e.target.value)} />
      </div>
      <div className="row gap-8" style={{justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={()=>{ onSave(v); close(); }}>Save</button>
      </div>
    </div>
  );
};
window.RenameModal = RenameModal;

const UploadModal = ({ onUpload, accept, hint, sample }) => ({ close }) => {
  const isCsv = (accept || "").includes("csv");
  const [files, setFiles] = React.useState(isCsv ? [
    {name:"golden_set.csv", size:"18 KB", format:"csv"},
  ] : [
    {name:"신규자료_2025.pdf", size:"3.2 MB", format:"pdf"},
    {name:"메모.md", size:"42 KB", format:"md"},
  ]);
  return (
    <div className="col gap-14">
      <div style={{
        border:"1px dashed var(--border-strong)", padding:"36px 20px",
        textAlign:"center", background:"var(--bg-0)",
      }}>
        <Icon name="upload" size={20} color="var(--text-2)" />
        <div className="t-14" style={{marginTop:10}}>Drop files or click to browse</div>
        <div className="t-12 t-meta" style={{marginTop:4}}>{hint || "PDF · TXT · Markdown · 폴더 단위 가능"}</div>
      </div>
      {files.length > 0 && (
        <div className="col gap-1">
          <span className="t-label">Queued · {files.length}</span>
          {files.map((f,i) => (
            <div key={i} style={{display:"grid", gridTemplateColumns:"24px 1fr 80px 60px 24px", padding:"8px 4px", borderBottom:"1px solid var(--border)", alignItems:"center"}}>
              <Icon name="doc" size={13} color="var(--text-2)"/>
              <span className="t-13">{f.name}</span>
              <span className="t-mono t-12 t-meta">{f.size}</span>
              <FormatTag format={f.format}/>
              <button onClick={()=>setFiles(files.filter((_,j)=>j!==i))} style={{border:0,background:"transparent",cursor:"pointer",color:"var(--text-2)"}}>
                <Icon name="x" size={11}/>
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="row gap-8 f-center t-12 t-dim">
        <input type="checkbox" defaultChecked /> 업로드 후 자동으로 인덱싱 시작
      </label>
      <div className="row gap-8" style={{justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={!files.length} onClick={()=>{ onUpload(files); close(); }}>
          Upload {files.length} files
        </button>
      </div>
    </div>
  );
};
window.UploadModal = UploadModal;

const GoldenPairModal = ({ initial, onSave }) => ({ close }) => {
  const [q, setQ] = React.useState(initial?.q || "");
  const [a, setA] = React.useState(initial?.a || "");
  return (
    <div className="col gap-14">
      <div className="col gap-6">
        <span className="t-label">Question</span>
        <textarea className="input" rows={2} value={q} onChange={e=>setQ(e.target.value)} placeholder="평가용 질문…"/>
      </div>
      <div className="col gap-6">
        <span className="t-label">Expected answer</span>
        <textarea className="input" rows={4} value={a} onChange={e=>setA(e.target.value)} placeholder="정답 예시…"/>
      </div>
      <div className="col gap-6">
        <span className="t-label">Expected chunk IDs (optional)</span>
        <input className="input" placeholder="chunk_111, chunk_142" />
      </div>
      <div className="row gap-8" style={{justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={!q.trim()||!a.trim()} onClick={()=>{ onSave({q,a}); close(); }}>
          {initial ? "Save changes" : "Add pair"}
        </button>
      </div>
    </div>
  );
};
window.GoldenPairModal = GoldenPairModal;

const NewExperimentModal = ({ onCreate }) => ({ close }) => {
  const [preset, setPreset] = React.useState("balanced");
  const [embedder, setEmbedder] = React.useState("bge-m3");
  const [strategy, setStrategy] = React.useState("recursive");
  const [chunkSize, setChunkSize] = React.useState(512);
  const [overlap, setOverlap] = React.useState(64);
  const [topK, setTopK] = React.useState(5);
  const [llm, setLlm] = React.useState("llama-3-8b-q4");
  const [retrievalOnly, setRetrievalOnly] = React.useState(false);

  const submit = () => {
    if (!preset.trim()) return;
    onCreate({
      preset, embedder, strategy, chunk_size: chunkSize, overlap,
      top_k: topK, llm, retrievalOnly,
    });
    close();
  };

  const presets = [
    { id: "balanced", label: "Balanced" },
    { id: "fast", label: "Fast" },
    { id: "high-recall", label: "High recall" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="col gap-14">
      <p className="t-13 t-dim" style={{margin:0, lineHeight:1.6}}>
        동일 워크스페이스의 문서 위에 새 임베딩·청킹 조합으로 실험을 만듭니다.
      </p>

      <div className="col gap-6">
        <span className="t-label">Preset</span>
        <div className="row gap-1">
          {presets.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id)} className="btn btn-sm"
              style={{
                marginRight: -1,
                borderColor: preset === p.id ? "var(--accent)" : undefined,
                color: preset === p.id ? "var(--accent)" : undefined,
              }}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="col gap-6">
        <span className="t-label">Embedder</span>
        <select className="select" value={embedder} onChange={e=>setEmbedder(e.target.value)}>
          <option value="bge-m3">bge-m3 (dim 1024)</option>
          <option value="bge-small-en-v1.5">bge-small-en-v1.5 (dim 384)</option>
          <option value="all-MiniLM-L12">all-MiniLM-L12 (dim 768)</option>
          <option value="e5-mistral-7b">e5-mistral-7b (dim 4096)</option>
        </select>
      </div>

      <div className="row gap-12">
        <div className="col gap-6" style={{flex:1}}>
          <span className="t-label">Strategy</span>
          <select className="select" value={strategy} onChange={e=>setStrategy(e.target.value)}>
            <option value="recursive">recursive</option>
            <option value="fixed">fixed</option>
          </select>
        </div>
        <div className="col gap-6" style={{flex:1}}>
          <span className="t-label">Chunk size</span>
          <input className="input" type="number" value={chunkSize}
            onChange={e=>setChunkSize(parseInt(e.target.value)||0)} />
        </div>
        <div className="col gap-6" style={{flex:1}}>
          <span className="t-label">Overlap</span>
          <input className="input" type="number" value={overlap}
            onChange={e=>setOverlap(parseInt(e.target.value)||0)} />
        </div>
      </div>

      <div className="row gap-12">
        <div className="col gap-6" style={{flex:1}}>
          <span className="t-label">Top-k</span>
          <input className="input" type="number" value={topK}
            onChange={e=>setTopK(parseInt(e.target.value)||5)} />
        </div>
        <div className="col gap-6" style={{flex:2}}>
          <span className="t-label">LLM</span>
          <select className="select" value={llm} onChange={e=>setLlm(e.target.value)} disabled={retrievalOnly}>
            <option value="llama-3-8b-q4">llama-3-8b-q4 (local)</option>
            <option value="qwen-2.5-7b">qwen-2.5-7b (local)</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6 (external)</option>
          </select>
        </div>
      </div>

      <label className="row gap-8 f-center t-13" style={{cursor:"pointer"}}>
        <input type="checkbox" checked={retrievalOnly}
          onChange={e=>setRetrievalOnly(e.target.checked)}
          style={{accentColor:"var(--accent)"}}/>
        Retrieval-only mode (skip answer generation)
      </label>

      <div className="card" style={{padding:12, background:"var(--bg-0)"}}>
        <div className="row f-between t-12 t-mono t-meta">
          <span>Estimated indexing</span>
          <span style={{color:"var(--accent)"}}>≈ 2분 10초</span>
        </div>
      </div>

      <div className="row gap-8" style={{justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={submit}>Create experiment</button>
      </div>
    </div>
  );
};
window.NewExperimentModal = NewExperimentModal;

// ---------- Export modal ----------
// Shows format toggle, save-path picker, optional sections, preview pane,
// then renders a faux save confirmation with copy-path action.
const ExportModal = ({ kind, defaults, preview }) => ({ close }) => {
  const [format, setFormat] = React.useState(defaults?.format || "yaml");
  const [includes, setIncludes] = React.useState(defaults?.includes || {});
  const [filename, setFilename] = React.useState(defaults?.filename || "export");
  const [path, setPath] = React.useState(defaults?.path || "~/openrag-lab/exports");
  const [phase, setPhase] = React.useState("config"); // config | saving | done
  const toast = window.useToast ? window.useToast() : null;

  const fullPath = `${path.replace(/\/$/, "")}/${filename}.${format}`;
  const sections = defaults?.sectionsConfig || [];

  const sizeBytes = (preview ? preview(format, includes).length : 1024);
  const sizeLabel = sizeBytes > 1024 ? (sizeBytes/1024).toFixed(1) + " KB" : sizeBytes + " B";

  const previewText = preview ? preview(format, includes) : "";

  const submit = () => {
    setPhase("saving");
    setTimeout(() => setPhase("done"), 900);
  };

  const copyPath = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(fullPath).catch(()=>{});
    toast && toast.push({ eyebrow: "Copied", message: "경로를 클립보드에 복사했습니다." });
  };

  const openInFinder = () => {
    toast && toast.push({ eyebrow: "Reveal in Finder", message: "OS file browser would open here." });
  };

  if (phase === "saving") {
    return (
      <div className="col gap-14" style={{padding:"20px 0"}}>
        <div className="row gap-12 f-center">
          <span className="dot dot-gold pulse-gold" style={{width:10, height:10}}></span>
          <span className="t-13">Writing {filename}.{format}…</span>
        </div>
        <div style={{height:1, background:"var(--border-strong)", overflow:"hidden", position:"relative"}}>
          <div style={{
            position:"absolute", inset:0,
            background:"var(--accent)",
            transformOrigin:"left",
            animation:"shimmer 0.8s ease-out forwards",
          }}/>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="col gap-14">
        <div className="card" style={{padding:14, background:"var(--bg-0)", borderLeft:"2px solid var(--success)"}}>
          <div className="row gap-10 f-center" style={{marginBottom:8}}>
            <span style={{
              width:18, height:18, border:"1px solid var(--success)",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}><Icon name="check" size={10} color="var(--success)"/></span>
            <span className="t-13">Saved successfully</span>
          </div>
          <div className="t-12 t-mono t-meta" style={{wordBreak:"break-all"}}>{fullPath}</div>
          <div className="row gap-12 t-12 t-mono t-meta" style={{marginTop:8}}>
            <span>{sizeLabel}</span>
            <span>·</span>
            <span>{format.toUpperCase()}</span>
            <span>·</span>
            <span>{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
        <div className="row gap-8" style={{justifyContent:"flex-end"}}>
          <button className="btn btn-sm" onClick={copyPath}>
            <Icon name="doc" size={11}/> Copy path
          </button>
          <button className="btn btn-sm" onClick={openInFinder}>
            <Icon name="ext" size={11}/> Reveal in Finder
          </button>
          <button className="btn btn-sm btn-primary" onClick={close}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      {/* Format */}
      <div className="col gap-6">
        <span className="t-label">Format</span>
        <div className="row gap-1">
          {(defaults?.formats || ["yaml","json","csv"]).map(f => (
            <button key={f} onClick={() => setFormat(f)} className="btn btn-sm"
              style={{
                marginRight: -1, textTransform:"uppercase",
                borderColor: format === f ? "var(--accent)" : undefined,
                color: format === f ? "var(--accent)" : undefined,
              }}>{f}</button>
          ))}
        </div>
      </div>

      {/* Save path */}
      <div className="col gap-6">
        <span className="t-label">Save to</span>
        <div className="row gap-0" style={{alignItems:"stretch"}}>
          <input className="input" value={path} onChange={e=>setPath(e.target.value)}
            style={{flex:2, marginRight:-1}}/>
          <span style={{
            display:"flex", alignItems:"center", padding:"0 10px",
            background:"var(--bg-0)", border:"1px solid var(--border-strong)",
            borderLeftWidth:0, borderRightWidth:0,
            color:"var(--text-2)", fontFamily:"JetBrains Mono, monospace", fontSize:13,
          }}>/</span>
          <input className="input" value={filename} onChange={e=>setFilename(e.target.value)}
            style={{flex:1, marginRight:-1}}/>
          <span style={{
            display:"flex", alignItems:"center", padding:"0 10px",
            background:"var(--bg-0)", border:"1px solid var(--border-strong)",
            color:"var(--text-2)", fontFamily:"JetBrains Mono, monospace", fontSize:13,
          }}>.{format}</span>
        </div>
        <div className="row gap-12 f-center">
          <button className="btn btn-sm" onClick={() => setPath("~/openrag-lab/exports")}>
            <Icon name="doc" size={11}/> ~/openrag-lab/exports
          </button>
          <button className="btn btn-sm" onClick={() => setPath("~/Downloads")}>
            ~/Downloads
          </button>
          <button className="btn btn-sm" onClick={() => setPath("~/Desktop")}>
            ~/Desktop
          </button>
          <span className="t-12 t-meta" style={{flex:1, textAlign:"right"}}>
            <Icon name="info" size={10}/> 변경 사항은 settings.yaml에 저장됩니다.
          </span>
        </div>
      </div>

      {/* Sections */}
      {sections.length > 0 && (
        <div className="col gap-6">
          <span className="t-label">Include</span>
          <div className="card" style={{padding:"6px 12px", background:"var(--bg-0)"}}>
            {sections.map((s, i) => (
              <label key={s.id} className="row gap-10 f-center"
                style={{
                  padding:"8px 0", cursor:"pointer",
                  borderTop: i ? "1px solid var(--border)" : "none",
                }}>
                <input type="checkbox" checked={!!includes[s.id]}
                  onChange={e => setIncludes(v => ({...v, [s.id]: e.target.checked}))}
                  style={{accentColor:"var(--accent)"}} disabled={s.required}/>
                <div className="col gap-2" style={{flex:1}}>
                  <span className="t-13">{s.label} {s.required && <span className="t-12 t-meta">(필수)</span>}</span>
                  {s.note && <span className="t-12 t-meta">{s.note}</span>}
                </div>
                <span className="t-mono t-12 t-meta">{s.size}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      {previewText && (
        <div className="col gap-6">
          <div className="row f-between f-center">
            <span className="t-label">Preview</span>
            <span className="t-mono t-12 t-meta">{sizeLabel} · {previewText.split("\n").length} lines</span>
          </div>
          <div style={{
            background:"var(--bg-0)", border:"1px solid var(--border)",
            padding:"12px 14px", maxHeight:200, overflowY:"auto",
            fontFamily:"JetBrains Mono, monospace", fontSize:11, lineHeight:1.55,
            color:"var(--text-1)", whiteSpace:"pre", tabSize:2,
          }}>{previewText}</div>
        </div>
      )}

      {/* File info strip */}
      <div className="card" style={{padding:"10px 14px", background:"var(--bg-0)"}}>
        <div className="row f-between t-12 t-mono">
          <span className="t-meta">Resolves to</span>
          <span style={{color:"var(--accent)", wordBreak:"break-all", textAlign:"right"}}>{fullPath}</span>
        </div>
      </div>

      <div className="row gap-8" style={{justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={submit}>
          <Icon name="upload" size={11} color="#0A0A0A"/> Save
        </button>
      </div>
    </div>
  );
};
window.ExportModal = ExportModal;

const LicenseModal = ({ model, onAccept }) => ({ close }) => (
  <div className="col gap-14">
    <div className="card" style={{padding:14, background:"var(--bg-0)"}}>
      <div className="row f-between f-center">
        <span className="t-13">{model.name}</span>
        <span className="chip chip-mono">{model.licenseId}</span>
      </div>
      <div className="t-12 t-meta" style={{marginTop:6}}>{model.size} · commercial use {model.commercial}</div>
    </div>
    <div style={{
      maxHeight:200, overflowY:"auto",
      padding:14, background:"var(--bg-0)",
      border:"1px solid var(--border)",
      fontFamily:"JetBrains Mono, monospace", fontSize:11, lineHeight:1.6, color:"var(--text-1)"
    }}>
      LLAMA 3 COMMUNITY LICENSE AGREEMENT — Version Release Date: April 18, 2024.{"\n\n"}
      "Llama 3" means the foundational large language models and software and algorithms, including machine-learning model code, trained model weights, inference-enabling code, training-enabling code, fine-tuning enabling code, and other elements of the foregoing distributed by Meta…{"\n\n"}
      Subject to your compliance with the terms and conditions of this Agreement, Meta hereby grants you a non-exclusive, worldwide, non-transferable and royalty-free limited license under Meta's intellectual property…{"\n\n"}
      [라이선스 본문 발췌 — 전체는 링크에서 확인]
    </div>
    <label className="row gap-8 f-center t-13">
      <input type="checkbox" id="lic-accept"/>
      라이선스 본문을 읽고 동의합니다.
    </label>
    <div className="row gap-8" style={{justifyContent:"space-between", alignItems:"center"}}>
      <a href="#" className="t-12" style={{color:"var(--accent)"}}>Open full license ↗</a>
      <div className="row gap-8">
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={()=>{
          if (document.getElementById("lic-accept").checked) { onAccept(); close(); }
        }}>Accept & download</button>
      </div>
    </div>
  </div>
);
window.LicenseModal = LicenseModal;

const DimMismatchModal = ({ from, to, archivedCount, onConfirm }) => ({ close }) => (
  <div className="col gap-14">
    <p className="t-13 t-dim" style={{margin:0, lineHeight:1.6}}>
      임베더가 차원이 다른 모델로 변경되었습니다. ChromaDB 컬렉션이 차원별로 분리되며, 전체 재인덱싱이 필요합니다.
    </p>
    <div className="card" style={{padding:14, background:"var(--bg-0)"}}>
      <div className="row gap-16 f-center" style={{justifyContent:"space-between"}}>
        <div className="col gap-2">
          <span className="t-label" style={{fontSize:9}}>From</span>
          <span className="t-mono t-13">{from.name}</span>
          <span className="t-mono t-12 t-meta">dim {from.dim}</span>
        </div>
        <Icon name="right" size={16} color="var(--accent)"/>
        <div className="col gap-2">
          <span className="t-label" style={{fontSize:9, color:"var(--accent)"}}>To</span>
          <span className="t-mono t-13" style={{color:"var(--accent)"}}>{to.name}</span>
          <span className="t-mono t-12" style={{color:"var(--accent)"}}>dim {to.dim}</span>
        </div>
      </div>
    </div>
    <div className="card" style={{padding:12, background:"var(--bg-0)", borderLeft:"2px solid var(--accent)"}}>
      <div className="t-12">
        <Icon name="archive" size={11}/> 기존 실험 결과 <span className="t-mono" style={{color:"var(--accent)"}}>{archivedCount}개</span>는 archived 상태로 보존되어 비교에 사용할 수 있습니다.
      </div>
    </div>
    <div className="t-12 t-mono t-meta">예상 재인덱싱 시간 ≈ 4분 30초</div>
    <div className="row gap-8" style={{justifyContent:"flex-end"}}>
      <button className="btn btn-sm" onClick={close}>Cancel — keep current</button>
      <button className="btn btn-sm btn-primary" onClick={()=>{ onConfirm(); close(); }}>Accept & reindex</button>
    </div>
  </div>
);
window.DimMismatchModal = DimMismatchModal;

const ExperimentDetailModal = ({ exp }) => ({ close }) => (
  <div className="col gap-14">
    <div className="row gap-12 f-center" style={{flexWrap:"wrap"}}>
      <span className="t-mono t-13" style={{color:"var(--accent)"}}>{exp.fp}</span>
      <span className="chip">{exp.preset}</span>
      {exp.llm == null && <RetrievalOnlyBadge/>}
    </div>
    <div className="card" style={{padding:14, background:"var(--bg-0)"}}>
      <div className="t-label" style={{marginBottom:8}}>Configuration</div>
      <div className="col gap-4 t-mono t-12">
        <div className="row f-between"><span className="t-meta">embedder_id</span><span>{exp.embedder}</span></div>
        <div className="row f-between"><span className="t-meta">dim</span><span>{exp.dim}</span></div>
        <div className="row f-between"><span className="t-meta">chunking</span><span>{exp.chunking}</span></div>
        <div className="row f-between"><span className="t-meta">retrieval</span><span>{exp.retrieval}</span></div>
        <div className="row f-between"><span className="t-meta">llm_id</span><span>{exp.llm || "null"}</span></div>
      </div>
    </div>
    <div className="card" style={{padding:14, background:"var(--bg-0)"}}>
      <div className="t-label" style={{marginBottom:10}}>Scores · per pair sampling</div>
      <div className="col gap-2">
        {[
          {q:"갱신 거절 사유 인정 판례는?", f:0.92, ar:0.95, cp:0.81, cr:0.84},
          {q:"임대인 손해배상 범위는?", f:0.88, ar:0.93, cp:0.78, cr:0.80},
          {q:"재건축 진정성 판단 기준?", f:0.78, ar:0.85, cp:0.74, cr:0.81},
        ].map((r,i)=>(
          <div key={i} style={{display:"grid", gridTemplateColumns:"1fr 60px 60px 60px 60px", gap:8, padding:"6px 0", borderTop: i?"1px solid var(--border)":"none", alignItems:"center"}}>
            <span className="t-12 t-dim">{r.q}</span>
            <ScoreCell value={exp.llm?r.f:null}/>
            <ScoreCell value={exp.llm?r.ar:null}/>
            <ScoreCell value={r.cp}/>
            <ScoreCell value={r.cr}/>
          </div>
        ))}
      </div>
    </div>
    <div className="row gap-8" style={{justifyContent:"flex-end"}}>
      <button className="btn btn-sm">Re-evaluate</button>
      <button className="btn btn-sm">Clone as new</button>
      <button className="btn btn-sm" onClick={close}>Close</button>
    </div>
  </div>
);
window.ExperimentDetailModal = ExperimentDetailModal;
