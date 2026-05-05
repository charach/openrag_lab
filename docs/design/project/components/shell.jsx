// Shared UI primitives & global header for OpenRAG-Lab

// --- Tiny stroke icons (1.25px) ---
const Icon = ({ name, size = 14, color = "currentColor" }) => {
  const s = size;
  const stroke = { stroke: color, strokeWidth: 1.25, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "wand":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 13L12 4M11 3L13 5M2 7L4 5M9 11L11 13" {...stroke}/></svg>);
    case "scissors":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><circle cx="4" cy="11" r="2" {...stroke}/><circle cx="12" cy="11" r="2" {...stroke}/><path d="M5 9L13 2M11 9L3 2" {...stroke}/></svg>);
    case "chat":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M2 4H14V11H8L5 14V11H2V4Z" {...stroke}/></svg>);
    case "grid":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M2 2H7V7H2V2ZM9 2H14V7H9V2ZM2 9H7V14H2V9ZM9 9H14V14H9V9Z" {...stroke}/></svg>);
    case "check":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 8L7 12L13 4" {...stroke}/></svg>);
    case "x":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 3L13 13M13 3L3 13" {...stroke}/></svg>);
    case "down":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M4 6L8 10L12 6" {...stroke}/></svg>);
    case "right":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M6 4L10 8L6 12" {...stroke}/></svg>);
    case "doc":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 2H10L13 5V14H3V2ZM10 2V5H13" {...stroke}/></svg>);
    case "trash":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 5H13M6 5V3H10V5M5 5L6 14H10L11 5" {...stroke}/></svg>);
    case "alert":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M8 2L14 13H2L8 2ZM8 7V10M8 12V12.5" {...stroke}/></svg>);
    case "info":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" {...stroke}/><path d="M8 7V11M8 5V5.5" {...stroke}/></svg>);
    case "play":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M5 3L13 8L5 13V3Z" {...stroke}/></svg>);
    case "pause":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M5 3V13M11 3V13" {...stroke}/></svg>);
    case "upload":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M8 11V2M5 5L8 2L11 5M3 11V13H13V11" {...stroke}/></svg>);
    case "cpu":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" {...stroke}/><path d="M6 1V4M10 1V4M6 12V15M10 12V15M1 6H4M1 10H4M12 6H15M12 10H15" {...stroke}/></svg>);
    case "lock":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" {...stroke}/><path d="M5 7V4.5C5 3 6 2 8 2C10 2 11 3 11 4.5V7" {...stroke}/></svg>);
    case "yaml":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M3 3H13V13H3V3ZM6 6H10M6 8H10M6 10H8" {...stroke}/></svg>);
    case "settings":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" {...stroke}/><path d="M8 1V3M8 13V15M1 8H3M13 8H15M3 3L4.5 4.5M11.5 11.5L13 13M3 13L4.5 11.5M11.5 4.5L13 3" {...stroke}/></svg>);
    case "search":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" {...stroke}/><path d="M10.5 10.5L14 14" {...stroke}/></svg>);
    case "ext":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M11 3H13V5M13 3L8 8M9 3H4V12H13V7" {...stroke}/></svg>);
    case "archive":
      return (<svg width={s} height={s} viewBox="0 0 16 16"><path d="M2 4H14V6H2V4ZM3 6V13H13V6M6 9H10" {...stroke}/></svg>);
  }
  return null;
};
window.Icon = Icon;

// --- File-format glyph ---
const FormatTag = ({ format }) => {
  const labels = { pdf: "PDF", txt: "TXT", md: "MD", docx: "DOCX" };
  return (
    <span className="t-mono" style={{
      fontSize: 9, letterSpacing: "0.08em",
      padding: "2px 5px",
      border: "1px solid var(--border-strong)",
      color: "var(--text-1)",
      minWidth: 28, textAlign: "center",
    }}>{labels[format] || format.toUpperCase()}</span>
  );
};
window.FormatTag = FormatTag;

// --- Retrieval-only badge ---
const RetrievalOnlyBadge = ({ size = "sm" }) => (
  <span className="chip" style={{
    borderColor: "var(--text-1)",
    color: "var(--text-0)",
    fontSize: size === "lg" ? 11 : 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 400,
  }}>
    Retrieval-only
  </span>
);
window.RetrievalOnlyBadge = RetrievalOnlyBadge;

// --- External-call indicator (used for `via OpenAI gpt-4`) ---
const ExternalCallTag = ({ provider, model }) => (
  <span className="t-meta t-12" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <Icon name="ext" size={12} />
    via {provider} <span className="t-mono">{model}</span>
  </span>
);
window.ExternalCallTag = ExternalCallTag;

// --- Header ---
const Header = ({ route, setRoute, workspaceId, setWorkspaceId, externalCall, testMode }) => {
  const modal = window.useModal ? window.useModal() : null;
  const toast = window.useToast ? window.useToast() : null;

  // Mutable workspace list — kept in module-level cache so both header & screens see the same
  const [wsList, setWsList] = React.useState(MOCK.workspaces);
  const ws = wsList.find(w => w.id === workspaceId) || wsList[0];
  const [wsOpen, setWsOpen] = React.useState(false);
  const [hwOpen, setHwOpen] = React.useState(false);

  const navItems = [
    { id: "auto", label: "Auto-Pilot", icon: "wand" },
    { id: "library", label: "Library", icon: "doc" },
    { id: "chunking", label: "Chunking Lab", icon: "scissors" },
    { id: "chat", label: "Chat", icon: "chat" },
    { id: "experiments", label: "Experiments", icon: "grid" },
  ];

  const openNew = () => {
    setWsOpen(false);
    modal && modal.open({
      title: "New workspace", eyebrow: "Workspace", width: 480,
      render: NewWorkspaceModal({
        onCreate: ({ name, preset }) => {
          const id = "ws_" + Math.random().toString(36).slice(2, 8);
          setWsList(l => [...l, { id, name, documents: 0, chunks: 0, experiments: 0 }]);
          setWorkspaceId(id);
          toast && toast.push({ eyebrow: "Created", message: `Workspace "${name}" ready.` });
        },
      }),
    });
  };
  const openRename = (w) => {
    setWsOpen(false);
    modal && modal.open({
      title: "Rename workspace", eyebrow: "Rename", width: 440,
      render: RenameModal({
        initial: w.name,
        onSave: (newName) => {
          setWsList(l => l.map(x => x.id === w.id ? {...x, name: newName} : x));
          toast && toast.push({ eyebrow: "Saved", message: "Workspace renamed." });
        },
      }),
    });
  };
  const askDelete = (w) => {
    setWsOpen(false);
    if (!modal) return;
    confirmModal(modal, {
      title: `Delete "${w.name}"?`,
      message: `이 워크스페이스의 모든 문서·청크·임베딩·실험 결과 (${w.documents} docs · ${w.chunks.toLocaleString()} chunks · ${w.experiments} exp) 가 영구 삭제됩니다. 되돌릴 수 없습니다.`,
      confirmLabel: "Delete workspace",
      danger: true,
      onConfirm: () => {
        setWsList(l => {
          const next = l.filter(x => x.id !== w.id);
          if (w.id === workspaceId && next.length) setWorkspaceId(next[0].id);
          return next;
        });
        toast && toast.push({ eyebrow: "Deleted", message: `Workspace "${w.name}" removed.`, kind: "error" });
      },
    });
  };

  const profile = MOCK.profile;
  const hwSummary = `${profile.os.platform === "darwin" ? "macOS" : profile.os.platform} · ${profile.cpu.cores}C · ${profile.ram.total_gb} GB · ${profile.gpu.acceleration_backend}`;

  return (
    <header style={{
      height: 56,
      background: "var(--bg-1)",
      borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "stretch",
      position: "sticky", top: 0, zIndex: 100,
    }}>
      {/* Wordmark */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "0 24px",
        borderRight: "1px solid var(--border)",
        minWidth: 220,
      }}>
        <span className="t-wordmark" style={{ fontSize: 17, color: "var(--text-0)" }}>
          OpenRAG<span style={{ color: "var(--accent)" }}>·</span>Lab
        </span>
      </div>

      {/* Workspace selector */}
      <div style={{ position: "relative", borderRight: "1px solid var(--border)" }}>
        <button
          className="btn-ghost"
          onClick={() => setWsOpen(v => !v)}
          style={{
            height: "100%", padding: "0 18px",
            border: 0, background: "transparent",
            display: "flex", alignItems: "center", gap: 10,
            color: "var(--text-0)", cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
            <span className="t-label" style={{ fontSize: 9 }}>Workspace</span>
            <span className="t-13">{ws.name}</span>
          </div>
          <span className="t-meta t-12 t-mono" style={{ marginLeft: 6 }}>
            {ws.documents} docs · {ws.chunks.toLocaleString()} chunks
          </span>
          <Icon name="down" size={12} color="var(--text-2)" />
        </button>
        {wsOpen && (
          <div style={{
            position: "absolute", top: "100%", left: 0,
            background: "var(--bg-1)", border: "1px solid var(--border-strong)",
            minWidth: 360, zIndex: 50,
          }}>
            {wsList.map(w => (
              <div key={w.id} style={{
                display: "grid", gridTemplateColumns: "1fr auto auto",
                borderBottom: "1px solid var(--border)",
                background: w.id === ws.id ? "var(--bg-2)" : "transparent",
                alignItems: "center",
              }}>
                <button
                  onClick={() => { setWorkspaceId(w.id); setWsOpen(false); }}
                  style={{
                    textAlign: "left", padding: "10px 14px",
                    border: 0, background: "transparent",
                    color: "var(--text-0)", cursor: "pointer", fontFamily: "inherit",
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                  <span className="t-13">{w.name}</span>
                  <span className="t-meta t-mono t-12">{w.documents} docs · {w.chunks.toLocaleString()} chunks · {w.experiments} exp</span>
                </button>
                <button title="Rename" onClick={() => openRename(w)} style={{
                  border: 0, background: "transparent", padding: 8,
                  color: "var(--text-2)", cursor: "pointer",
                }} onMouseEnter={e=>e.currentTarget.style.color="var(--text-0)"}
                   onMouseLeave={e=>e.currentTarget.style.color="var(--text-2)"}>
                  <Icon name="settings" size={11}/>
                </button>
                <button title="Delete" onClick={() => askDelete(w)} disabled={wsList.length === 1} style={{
                  border: 0, background: "transparent", padding: "8px 12px 8px 8px",
                  color: "var(--text-2)", cursor: wsList.length === 1 ? "not-allowed" : "pointer",
                  opacity: wsList.length === 1 ? 0.3 : 1,
                }} onMouseEnter={e=>{ if (wsList.length>1) e.currentTarget.style.color="var(--error)"; }}
                   onMouseLeave={e=>e.currentTarget.style.color="var(--text-2)"}>
                  <Icon name="trash" size={11}/>
                </button>
              </div>
            ))}
            <div style={{ padding: "8px 14px" }}>
              <button className="btn btn-sm" style={{ width: "100%", justifyContent: "center" }} onClick={openNew}>
                + New workspace
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
        {navItems.map(n => (
          <button key={n.id}
            onClick={() => setRoute(n.id)}
            style={{
              padding: "0 18px",
              border: 0, background: "transparent",
              color: route === n.id ? "var(--text-0)" : "var(--text-1)",
              cursor: "pointer", fontFamily: "inherit", fontSize: 13,
              display: "flex", alignItems: "center", gap: 8,
              borderBottom: route === n.id ? "1px solid var(--accent)" : "1px solid transparent",
              marginBottom: -1,
              letterSpacing: "0.01em",
            }}>
            <Icon name={n.icon} size={13} color={route === n.id ? "var(--accent)" : "currentColor"} />
            {n.label}
          </button>
        ))}
      </nav>

      {/* Right: status chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 18px", borderLeft: "1px solid var(--border)" }}>
        {testMode && (
          <span className="chip" style={{ color: "var(--text-2)", borderColor: "var(--border)" }}>
            Test mode · fake adapters
          </span>
        )}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setHwOpen(v => !v)}
            style={{
              border: 0, background: "transparent", color: "var(--text-1)",
              cursor: "pointer", fontFamily: "inherit", fontSize: 12,
              display: "flex", alignItems: "center", gap: 8, padding: 0,
            }}>
            <Icon name="cpu" size={13} />
            <span className="t-mono t-12">{hwSummary}</span>
          </button>
          {hwOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)",
              background: "var(--bg-1)", border: "1px solid var(--border-strong)",
              padding: 16, minWidth: 280, zIndex: 50,
            }}>
              <div className="t-label" style={{ marginBottom: 10 }}>System Profile</div>
              <div className="col gap-6 t-12 t-mono">
                <div className="row f-between"><span className="t-meta">os</span><span>{profile.os.platform} {profile.os.version} {profile.os.arch}</span></div>
                <div className="row f-between"><span className="t-meta">cpu</span><span>{profile.cpu.model}</span></div>
                <div className="row f-between"><span className="t-meta">cores</span><span>{profile.cpu.cores} / {profile.cpu.threads}t</span></div>
                <div className="row f-between"><span className="t-meta">ram</span><span>{profile.ram.available_gb} / {profile.ram.total_gb} GB</span></div>
                <div className="row f-between"><span className="t-meta">gpu</span><span>{profile.gpu.name}</span></div>
                <div className="row f-between"><span className="t-meta">backend</span><span style={{ color: "var(--accent)" }}>{profile.gpu.acceleration_backend}</span></div>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className={"dot " + (externalCall ? "dot-gold pulse-gold" : "")}></span>
          <span className="t-12 t-meta" style={{ color: externalCall ? "var(--accent)" : "var(--text-2)" }}>
            {externalCall ? `${externalCall.provider} · ${externalCall.stage}` : "local only"}
          </span>
        </div>
      </div>
    </header>
  );
};
window.Header = Header;

// --- Score cell with charcoal→gold gradient ---
const ScoreCell = ({ value, monospace = true }) => {
  if (value == null) {
    return <span className="t-meta t-mono" title="retrieval-only mode">—</span>;
  }
  // Map 0..1 → charcoal (#3A3A3A) → warm gray (#7A7468) → gold (#C8A96A)
  // Use lightness + chroma blend.
  const t = Math.max(0, Math.min(1, value));
  const l = 0.30 + t * 0.40;       // 0.30 → 0.70
  const c = t * 0.10;              // 0 → 0.10
  const h = 70 + t * 18;           // 70 → 88 (yellowish)
  const bg = `oklch(${l} ${c} ${h} / 0.18)`;
  const fg = t > 0.85 ? "var(--accent)" : t > 0.6 ? "var(--text-0)" : "var(--text-1)";
  return (
    <span className={monospace ? "t-mono t-num" : "t-num"} style={{
      display: "inline-block", minWidth: 56,
      padding: "4px 8px", textAlign: "right",
      background: bg, color: fg,
      fontSize: 13,
      borderRight: t > 0.85 ? "2px solid var(--accent)" : "2px solid transparent",
    }}>
      {value.toFixed(2)}
    </span>
  );
};
window.ScoreCell = ScoreCell;

// --- Subtle striped placeholder (used nowhere we use real text but kept for potential image slots) ---
const PlaceholderTexture = ({ height = 80, label = "" }) => (
  <div style={{
    height, width: "100%",
    background: "repeating-linear-gradient(135deg, var(--bg-2) 0 6px, var(--bg-1) 6px 12px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "JetBrains Mono, monospace", fontSize: 10,
    color: "var(--text-2)", letterSpacing: "0.08em", textTransform: "uppercase",
  }}>{label}</div>
);
window.PlaceholderTexture = PlaceholderTexture;
