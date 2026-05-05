// Modal system — overlay, dialog, confirm, license, dim-mismatch, etc.

const ModalContext = React.createContext(null);

const ModalProvider = ({ children }) => {
  const [stack, setStack] = React.useState([]);

  const open = (modal) => {
    const id = "m" + Math.random().toString(36).slice(2, 8);
    setStack(s => [...s, { ...modal, id }]);
    return id;
  };
  const close = (id) => setStack(s => s.filter(m => m.id !== id));
  const closeAll = () => setStack([]);

  // ESC to close top
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && stack.length) {
        close(stack[stack.length - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack]);

  return (
    <ModalContext.Provider value={{ open, close, closeAll }}>
      {children}
      {stack.map((m, i) => (
        <ModalShell key={m.id} modal={m} onClose={() => close(m.id)} z={1000 + i*10} />
      ))}
    </ModalContext.Provider>
  );
};

const useModal = () => React.useContext(ModalContext);
window.useModal = useModal;
window.ModalProvider = ModalProvider;

const ModalShell = ({ modal, onClose, z }) => {
  const { width = 480, title, eyebrow, render, footer, danger } = modal;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: z,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fade-in 120ms ease-out",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width, maxWidth: "92vw", maxHeight: "88vh",
        background: "var(--bg-1)",
        border: "1px solid var(--border-strong)",
        display: "flex", flexDirection: "column",
        borderTop: danger ? "2px solid var(--error)" : "2px solid var(--accent)",
      }}>
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)" }}>
          {eyebrow && <div className="t-label" style={{ color: danger ? "var(--error)" : "var(--accent)", marginBottom: 6 }}>{eyebrow}</div>}
          <div className="row f-between f-center">
            <h3 className="t-20" style={{ margin: 0, fontWeight: 300 }}>{title}</h3>
            <button onClick={onClose} className="btn-ghost" style={{ border: 0, background: "transparent", cursor: "pointer", padding: 6, color: "var(--text-2)" }}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <div style={{ padding: "18px 24px", overflowY: "auto", flex: 1 }}>
          {render({ close: onClose })}
        </div>
        {footer && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {footer({ close: onClose })}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Confirm modal helper ---
const confirmModal = (modal, { title, message, confirmLabel = "Confirm", danger = false, onConfirm }) => {
  modal.open({
    title, eyebrow: danger ? "Confirm — destructive" : "Confirm",
    danger,
    width: 440,
    render: () => <p className="t-13 t-dim" style={{ margin: 0, lineHeight: 1.6 }}>{message}</p>,
    footer: ({ close }) => (
      <>
        <button className="btn btn-sm" onClick={close}>Cancel</button>
        <button className={"btn btn-sm " + (danger ? "" : "btn-primary")}
          style={danger ? { background: "var(--error)", color: "#fff", borderColor: "var(--error)" } : {}}
          onClick={() => { onConfirm && onConfirm(); close(); }}>{confirmLabel}</button>
      </>
    ),
  });
};
window.confirmModal = confirmModal;

// --- Toast (lightweight, top right) ---
const ToastContext = React.createContext(null);
const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = React.useState([]);
  const push = (t) => {
    const id = "t" + Math.random().toString(36).slice(2, 7);
    setToasts(s => [...s, { ...t, id }]);
    setTimeout(() => setToasts(s => s.filter(x => x.id !== id)), 3200);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div style={{ position: "fixed", top: 72, right: 18, display: "flex", flexDirection: "column", gap: 8, zIndex: 4000 }}>
        {toasts.map(t => (
          <div key={t.id} className="card fade-in" style={{
            padding: "10px 14px", minWidth: 240,
            borderLeft: "2px solid " + (t.kind === "error" ? "var(--error)" : "var(--accent)"),
          }}>
            <div className="t-label" style={{ fontSize: 9, color: t.kind === "error" ? "var(--error)" : "var(--accent)" }}>{t.eyebrow || "Saved"}</div>
            <div className="t-13" style={{ marginTop: 3 }}>{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
const useToast = () => React.useContext(ToastContext);
window.ToastProvider = ToastProvider;
window.useToast = useToast;
