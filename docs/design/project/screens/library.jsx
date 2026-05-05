// Document Library — `/library`
// CRUD over documents within the current workspace.

const Library = () => {
  const modal = useModal();
  const toast = useToast();

  // Local state — start with the indexing files as "library"
  const initial = MOCK.indexingFiles.map((f, i) => ({
    id: "doc_" + (100 + i),
    name: f.name,
    size: f.size,
    format: f.format,
    chunks: f.chunks || (f.status === "queued" ? 0 : 64),
    status: f.status === "embedded" ? "indexed" : f.status === "queued" ? "queued" : f.status === "chunked" ? "chunking" : "embedding",
    page_count: 84 - i * 3,
    indexed_at: ["2025-03-04 14:22","2025-03-04 14:18","2025-03-04 14:14","2025-03-04 14:10","2025-03-04 14:05"][i] || "—",
  }));

  const [docs, setDocs] = React.useState(initial);
  const [selected, setSelected] = React.useState(new Set());
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");

  const visible = docs.filter(d => {
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter !== "all" && d.format !== filter) return false;
    return true;
  });

  const toggle = (id) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map(d => d.id)));
  };

  const openUpload = () => modal.open({
    title: "Upload documents", eyebrow: "New documents",
    width: 540,
    render: UploadModal({
      onUpload: (files) => {
        const newDocs = files.map((f, i) => ({
          id: "doc_" + Math.random().toString(36).slice(2,7),
          name: f.name, size: f.size, format: f.format,
          chunks: 0, status: "queued", page_count: 0,
          indexed_at: "queued",
        }));
        setDocs(d => [...newDocs, ...d]);
        toast.push({ eyebrow: "Queued", message: `${files.length} files queued for indexing.` });
      },
    }),
  });

  const openRename = (doc) => modal.open({
    title: "Rename document", eyebrow: "Rename", width: 440,
    render: RenameModal({
      initial: doc.name,
      onSave: (newName) => {
        setDocs(d => d.map(x => x.id === doc.id ? {...x, name: newName} : x));
        toast.push({ eyebrow: "Saved", message: "Document renamed." });
      },
    }),
  });

  const askDelete = (ids) => {
    confirmModal(modal, {
      title: ids.length === 1
        ? `Delete "${docs.find(d => d.id === ids[0]).name}"?`
        : `Delete ${ids.length} documents?`,
      message: "이 작업은 되돌릴 수 없습니다. 인덱스에서 영구 삭제되며 관련된 청크와 임베딩도 함께 삭제됩니다.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        setDocs(d => d.filter(x => !ids.includes(x.id)));
        setSelected(new Set());
        toast.push({ eyebrow: "Deleted", message: `${ids.length} document${ids.length>1?"s":""} removed.`, kind: "error" });
      },
    });
  };

  const openReindex = (ids) => {
    confirmModal(modal, {
      title: `Re-index ${ids.length} document${ids.length>1?"s":""}?`,
      message: "선택한 문서를 다시 청킹·임베딩합니다. 기존 임베딩은 새 결과로 덮어쓰여집니다.",
      confirmLabel: "Re-index",
      onConfirm: () => {
        setDocs(d => d.map(x => ids.includes(x.id) ? {...x, status: "embedding"} : x));
        toast.push({ eyebrow: "Started", message: `Re-indexing ${ids.length} files.` });
      },
    });
  };

  return (
    <div style={{ padding: "28px 40px 80px", maxWidth: 1440, margin: "0 auto" }}>
      <div className="row f-between f-center" style={{ marginBottom: 24 }}>
        <PageHeader eyebrow={`Library · ${MOCK.workspaces[0].name}`}
                    title="Documents in this workspace."
                    sub="문서를 추가·삭제·재인덱싱하세요. 변경 사항은 다음 검색부터 반영됩니다." />
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={() => modal.open({
            title: "Export document list", eyebrow: `Library · ${docs.length} documents`, width: 600,
            render: ExportModal({
              defaults: {
                format: "csv",
                filename: `library-${MOCK.workspaces[0].id}`,
                path: `~/openrag-lab/exports/${MOCK.workspaces[0].id}`,
                formats: ["csv", "json", "yaml"],
                sectionsConfig: [
                  { id: "meta", label: "File metadata", note: "name, size, format, page count", size: "1.8 KB", required: true },
                  { id: "status", label: "Indexing status", note: "indexed_at, chunk count", size: "0.6 KB" },
                  { id: "checksums", label: "Content hashes", note: "SHA-256 per file", size: "1.2 KB" },
                ],
                includes: { meta: true, status: true, checksums: false },
              },
              preview: (fmt) => {
                if (fmt === "csv") return [
                  "id,name,format,size_bytes,page_count,chunks,status,indexed_at",
                  ...docs.slice(0, 6).map(d => `${d.id},"${d.name}",${d.format},${d.size||0},${d.page_count},${d.chunks},${d.status},${d.indexed_at}`),
                  docs.length > 6 ? `# … ${docs.length - 6} more rows` : "",
                ].filter(Boolean).join("\n");
                if (fmt === "json") return JSON.stringify({
                  workspace: MOCK.workspaces[0].id,
                  exported_at: new Date().toISOString(),
                  documents: docs.slice(0, 4).map(d => ({ id: d.id, name: d.name, chunks: d.chunks, status: d.status })),
                }, null, 2);
                return [
                  `# OpenRAG-Lab document list`,
                  `workspace: ${MOCK.workspaces[0].id}`,
                  `total: ${docs.length}`,
                  `documents:`,
                  ...docs.slice(0, 4).flatMap(d => [`  - id: ${d.id}`, `    name: "${d.name}"`, `    chunks: ${d.chunks}`, `    status: ${d.status}`]),
                ].join("\n");
              },
            }),
          })}>
            <Icon name="yaml" size={11}/> Export list
          </button>
          <button className="btn btn-primary btn-sm" onClick={openUpload}>
            <Icon name="upload" size={11} color="#0A0A0A"/> Upload
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="card" style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 20 }}>
        <Stat label="Documents" value={docs.length} accent />
        <Stat label="Indexed" value={docs.filter(d => d.status === "indexed").length} />
        <Stat label="In progress" value={docs.filter(d => ["embedding","chunking"].includes(d.status)).length} />
        <Stat label="Queued" value={docs.filter(d => d.status === "queued").length} />
        <Stat label="Total chunks" value={docs.reduce((s, d) => s + d.chunks, 0).toLocaleString()} mono />
      </div>

      {/* Search + filter bar */}
      <div className="row f-between f-center" style={{ marginBottom: 12, gap: 12 }}>
        <div className="row gap-8 f-center" style={{ flex: 1, maxWidth: 480 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Icon name="search" size={12} color="var(--text-2)" />
            <input className="input" placeholder="Filter by filename…" value={search} onChange={e=>setSearch(e.target.value)}
              style={{ paddingLeft: 32 }} />
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <Icon name="search" size={12} color="var(--text-2)" />
            </span>
          </div>
        </div>
        <div className="row gap-1">
          {[
            {id:"all",label:"All"},
            {id:"pdf",label:"PDF"},
            {id:"md",label:"Markdown"},
            {id:"txt",label:"Text"},
          ].map(f => (
            <button key={f.id} onClick={()=>setFilter(f.id)} className="btn btn-sm"
              style={{
                marginRight: -1,
                borderColor: filter===f.id ? "var(--accent)" : undefined,
                color: filter===f.id ? "var(--accent)" : undefined,
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="card fade-in" style={{
          padding: "10px 16px", marginBottom: 12,
          borderLeft: "2px solid var(--accent)",
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <span className="t-13"><span className="t-mono" style={{color:"var(--accent)"}}>{selected.size}</span> selected</span>
          <span style={{ flex: 1 }}></span>
          <button className="btn btn-sm" onClick={() => openReindex([...selected])}>Re-index</button>
          <button className="btn btn-sm" onClick={() => askDelete([...selected])}
            style={{ borderColor: "var(--error)", color: "var(--error)" }}>
            <Icon name="trash" size={11} color="var(--error)"/> Delete
          </button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Table */}
      <section className="card" style={{ padding: 0 }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 80px 80px 110px 130px 180px 80px",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          alignItems: "center",
        }}>
          <span style={{ display:"flex" }}>
            <Checkbox checked={selected.size > 0 && selected.size === visible.length}
                      indet={selected.size > 0 && selected.size < visible.length}
                      onChange={toggleAll}/>
          </span>
          <ColHeader>Filename</ColHeader>
          <ColHeader>Format</ColHeader>
          <ColHeader>Pages</ColHeader>
          <ColHeader>Chunks</ColHeader>
          <ColHeader>Status</ColHeader>
          <ColHeader>Indexed</ColHeader>
          <ColHeader align="right">Actions</ColHeader>
        </div>
        {visible.length === 0 && (
          <div style={{ padding: "60px 20px", textAlign: "center" }}>
            <div className="t-13 t-meta" style={{ marginBottom: 12 }}>No documents match your filter.</div>
            <button className="btn btn-sm" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filter</button>
          </div>
        )}
        {visible.map(doc => (
          <DocRow key={doc.id} doc={doc}
                  selected={selected.has(doc.id)}
                  onToggle={() => toggle(doc.id)}
                  onRename={() => openRename(doc)}
                  onDelete={() => askDelete([doc.id])}
                  onReindex={() => openReindex([doc.id])} />
        ))}
      </section>
    </div>
  );
};

const Stat = ({ label, value, mono, accent }) => (
  <div className="col gap-4">
    <span className="t-label" style={{ fontSize: 9 }}>{label}</span>
    <span className={mono ? "t-mono" : ""} style={{
      fontSize: 22, fontWeight: 300, letterSpacing: "0.01em",
      color: accent ? "var(--accent)" : "var(--text-0)",
    }}>{value}</span>
  </div>
);

const ColHeader = ({ children, align = "left" }) => (
  <span className="t-label" style={{ fontSize: 9, textAlign: align }}>{children}</span>
);

const Checkbox = ({ checked, indet, onChange }) => (
  <button onClick={onChange} style={{
    width: 16, height: 16,
    border: "1px solid " + (checked || indet ? "var(--accent)" : "var(--border-strong)"),
    background: checked || indet ? "var(--accent)" : "transparent",
    cursor: "pointer", padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    {checked && <Icon name="check" size={10} color="#0A0A0A"/>}
    {indet && <span style={{ width: 8, height: 1.5, background: "#0A0A0A" }}></span>}
  </button>
);

const DocRow = ({ doc, selected, onToggle, onRename, onDelete, onReindex }) => {
  const statusColor = {
    indexed: "var(--success)",
    embedding: "var(--accent)",
    chunking: "var(--text-1)",
    queued: "var(--text-2)",
  }[doc.status];
  const statusLabel = {
    indexed: "Indexed",
    embedding: "Embedding…",
    chunking: "Chunking…",
    queued: "Queued",
  }[doc.status];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "32px 1fr 80px 80px 110px 130px 180px 80px",
      padding: "12px 20px",
      borderBottom: "1px solid var(--border)",
      alignItems: "center",
      background: selected ? "var(--bg-2)" : "transparent",
    }}>
      <Checkbox checked={selected} onChange={onToggle}/>
      <div className="row gap-10 f-center">
        <Icon name="doc" size={13} color="var(--text-2)"/>
        <span className="t-13">{doc.name}</span>
      </div>
      <span><FormatTag format={doc.format}/></span>
      <span className="t-mono t-12 t-meta">{doc.page_count || "—"}</span>
      <span className="t-mono t-13" style={{ color: doc.chunks > 0 ? "var(--text-1)" : "var(--text-2)" }}>
        {doc.chunks > 0 ? doc.chunks.toLocaleString() : "—"}
      </span>
      <span className="row gap-6 f-center">
        <span className={"dot " + (doc.status === "embedding" ? "dot-gold pulse-gold" : doc.status === "indexed" ? "dot-success" : "")}></span>
        <span className="t-12" style={{ color: statusColor }}>{statusLabel}</span>
      </span>
      <span className="t-mono t-12 t-meta">{doc.indexed_at}</span>
      <div className="row gap-4" style={{ justifyContent: "flex-end" }}>
        <IconButton title="Re-index" onClick={onReindex}><Icon name="settings" size={11}/></IconButton>
        <IconButton title="Rename" onClick={onRename}><Icon name="doc" size={11}/></IconButton>
        <IconButton title="Delete" onClick={onDelete} danger><Icon name="trash" size={11}/></IconButton>
      </div>
    </div>
  );
};

const IconButton = ({ children, onClick, title, danger }) => (
  <button onClick={onClick} title={title} style={{
    border: 0, background: "transparent",
    width: 24, height: 24, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: danger ? "var(--text-2)" : "var(--text-1)",
  }}
  onMouseEnter={e => e.currentTarget.style.color = danger ? "var(--error)" : "var(--text-0)"}
  onMouseLeave={e => e.currentTarget.style.color = danger ? "var(--text-2)" : "var(--text-1)"}>
    {children}
  </button>
);

window.Library = Library;
