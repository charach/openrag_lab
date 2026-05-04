/**
 * Global header for OpenRAG-Lab — wordmark, workspace selector, route nav,
 * hardware chip. All state besides the active workspace is local (open/closed
 * dropdowns, last-known system profile).
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type SystemProfileResponse, type WorkspaceSummary } from "../api/client";
import { useThemeStore } from "../stores/theme";
import { useWorkspaceStore } from "../stores/workspace";
import { ConfigPortModal } from "./ConfigPortModal";
import { Icon, Modal } from "./ui";

const NAV: Array<{ path: string; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { path: "/", label: "Auto-Pilot", icon: "wand" },
  { path: "/library", label: "Library", icon: "doc" },
  { path: "/chunking", label: "Chunking Lab", icon: "scissors" },
  { path: "/chat", label: "Chat", icon: "chat" },
  { path: "/experiments", label: "Experiments", icon: "grid" },
];

export function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActive = useWorkspaceStore((s) => s.setActiveWorkspace);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const [profile, setProfile] = useState<SystemProfileResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  const [hwOpen, setHwOpen] = useState(false);
  const [modal, setModal] = useState<
    | { kind: "create" }
    | { kind: "rename"; ws: WorkspaceSummary }
    | { kind: "delete"; ws: WorkspaceSummary }
    | null
  >(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const wsRef = useRef<HTMLDivElement>(null);
  const hwRef = useRef<HTMLDivElement>(null);

  const refreshWorkspaces = async (): Promise<WorkspaceSummary[]> => {
    const r = await api.listWorkspaces();
    setWorkspaces(r.items);
    return r.items;
  };

  useEffect(() => {
    api
      .systemProfile()
      .then(setProfile)
      .catch(() => undefined);
    refreshWorkspaces()
      .then((items) => {
        const first = items[0];
        if (!activeId && first) setActive(first.id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close popovers on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (wsRef.current && !wsRef.current.contains(t)) setWsOpen(false);
      if (hwRef.current && !hwRef.current.contains(t)) setHwOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const ws = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  const submitCreate = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const created = await api.createWorkspace(draftName);
      const items = await refreshWorkspaces();
      setActive(items.find((w) => w.id === created.id)?.id ?? created.id);
      setModal(null);
      setDraftName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  const submitRename = async (): Promise<void> => {
    if (modal?.kind !== "rename") return;
    setPending(true);
    setError(null);
    try {
      await api.renameWorkspace(modal.ws.id, draftName);
      await refreshWorkspaces();
      setModal(null);
      setDraftName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  const submitDelete = async (): Promise<void> => {
    if (modal?.kind !== "delete") return;
    setPending(true);
    setError(null);
    try {
      await api.deleteWorkspace(modal.ws.id);
      const items = await refreshWorkspaces();
      if (modal.ws.id === activeId) {
        setActive(items[0]?.id ?? null);
      }
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };
  const hwSummary = profile
    ? `${profile.os.platform === "darwin" ? "macOS" : profile.os.platform} · ${profile.cpu.cores}C · ${profile.ram.total_gb} GB · ${profile.gpu.acceleration_backend}`
    : "…";

  return (
    <>
      <header
        style={{
          height: 56,
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "stretch",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            borderRight: "1px solid var(--border)",
            minWidth: 220,
          }}
        >
          <h1
            className="t-wordmark"
            style={{ fontSize: 17, color: "var(--text-0)", margin: 0, fontWeight: 400 }}
          >
            OpenRAG<span style={{ color: "var(--accent)" }}>·</span>Lab
          </h1>
        </div>

        {/* Workspace selector */}
        <div
          ref={wsRef}
          style={{ position: "relative", borderRight: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setWsOpen((v) => !v)}
            style={{
              height: "100%",
              padding: "0 18px",
              border: 0,
              background: "transparent",
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--text-0)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
              <span className="t-label" style={{ fontSize: 9 }}>
                Workspace
              </span>
              <span className="t-13">{ws ? ws.name : "—"}</span>
            </div>
            {ws && (
              <span className="t-meta t-12 t-mono" style={{ marginLeft: 6 }}>
                {ws.stats.document_count} docs · {ws.stats.chunk_count.toLocaleString()} chunks
              </span>
            )}
            <Icon name="down" size={12} color="var(--text-2)" />
          </button>
          {wsOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                background: "var(--bg-1)",
                border: "1px solid var(--border-strong)",
                minWidth: 360,
                zIndex: 50,
              }}
            >
              {workspaces.map((w) => (
                <div
                  key={w.id}
                  className="row f-center"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: w.id === ws?.id ? "var(--bg-2)" : "transparent",
                  }}
                >
                  <button
                    onClick={() => {
                      setActive(w.id);
                      setWsOpen(false);
                    }}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      padding: "10px 14px",
                      border: 0,
                      background: "transparent",
                      color: "var(--text-0)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span className="t-13">{w.name}</span>
                    <span className="t-meta t-mono t-12">
                      {w.stats.document_count} docs · {w.stats.chunk_count.toLocaleString()} chunks ·{" "}
                      {w.stats.experiment_count} exp
                    </span>
                  </button>
                  <button
                    aria-label={`rename ${w.name}`}
                    onClick={() => {
                      setDraftName(w.name);
                      setModal({ kind: "rename", ws: w });
                      setWsOpen(false);
                    }}
                    className="btn-ghost"
                    style={{ border: 0, background: "transparent", padding: 8, cursor: "pointer" }}
                  >
                    <Icon name="settings" size={12} color="var(--text-2)" />
                  </button>
                  <button
                    aria-label={`delete ${w.name}`}
                    onClick={() => {
                      setModal({ kind: "delete", ws: w });
                      setWsOpen(false);
                    }}
                    className="btn-ghost"
                    style={{ border: 0, background: "transparent", padding: 8, cursor: "pointer" }}
                  >
                    <Icon name="trash" size={12} color="var(--text-2)" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  setDraftName("");
                  setModal({ kind: "create" });
                  setWsOpen(false);
                }}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: 0,
                  background: "transparent",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                className="t-13"
              >
                + New workspace
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
          {NAV.map((n) => {
            const active = pathname === n.path;
            return (
              <button
                key={n.path}
                onClick={() => navigate(n.path)}
                style={{
                  padding: "0 18px",
                  border: 0,
                  background: "transparent",
                  color: active ? "var(--text-0)" : "var(--text-1)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderBottom: active
                    ? "1px solid var(--accent)"
                    : "1px solid transparent",
                  marginBottom: -1,
                  letterSpacing: "0.01em",
                }}
              >
                <Icon
                  name={n.icon}
                  size={13}
                  color={active ? "var(--accent)" : "currentColor"}
                />
                {n.label}
              </button>
            );
          })}
        </nav>

        {/* Right-rail status */}
        <div
          ref={hwRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 18px",
            borderLeft: "1px solid var(--border)",
            position: "relative",
          }}
        >
          {ws && (
            <button
              aria-label="config export/import"
              title="Workspace config — export / import"
              onClick={() => setConfigOpen(true)}
              style={{
                border: 0,
                background: "transparent",
                color: "var(--text-1)",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="yaml" size={14} />
            </button>
          )}
          <button
            aria-label="external LLM provider keys"
            title="External LLM providers — manage API keys"
            onClick={() => navigate("/providers")}
            style={{
              border: 0,
              background: "transparent",
              color: pathname === "/providers" ? "var(--accent)" : "var(--text-1)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Icon name="lock" size={14} />
          </button>
          <button
            aria-label={`switch to ${theme === "noir" ? "light" : "dark"} theme`}
            title={`Theme: ${theme === "noir" ? "noir (dark)" : "pearl (light)"}`}
            onClick={toggleTheme}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Icon name={theme === "noir" ? "moon" : "sun"} size={14} />
          </button>
          <button
            onClick={() => setHwOpen((v) => !v)}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--text-1)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 0,
            }}
          >
            <Icon name="cpu" size={13} />
            <span className="t-mono t-12">{hwSummary}</span>
          </button>
          {hwOpen && profile && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 6px)",
                background: "var(--bg-1)",
                border: "1px solid var(--border-strong)",
                padding: 16,
                minWidth: 280,
                zIndex: 50,
              }}
            >
              <div className="t-label" style={{ marginBottom: 10 }}>
                System Profile
              </div>
              <div className="col gap-6 t-12 t-mono">
                <Row label="os" value={`${profile.os.platform} ${profile.os.version} ${profile.os.arch}`} />
                <Row label="cpu" value={profile.cpu.model} />
                <Row label="cores" value={`${profile.cpu.cores} / ${profile.cpu.threads}t`} />
                <Row
                  label="ram"
                  value={`${profile.ram.available_gb ?? "?"} / ${profile.ram.total_gb} GB`}
                />
                <Row label="gpu" value={profile.gpu.name ?? "—"} />
                <Row
                  label="backend"
                  value={profile.gpu.acceleration_backend}
                  accent
                />
              </div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span className="dot"></span>
            <span className="t-12 t-meta">local only</span>
          </div>
        </div>
      </header>
      <div className="fade-in" key={pathname}>
        {children}
      </div>
      {modal?.kind === "create" && (
        <Modal
          title="New workspace"
          onClose={() => {
            if (!pending) setModal(null);
          }}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitCreate}
                disabled={pending || draftName.trim().length === 0}
              >
                Create
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            Name
          </label>
          <input
            className="input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
          {error && (
            <p style={{ color: "var(--error)", marginTop: 8 }} className="t-12">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal?.kind === "rename" && (
        <Modal
          title="Rename workspace"
          onClose={() => {
            if (!pending) setModal(null);
          }}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitRename}
                disabled={
                  pending || draftName.trim().length === 0 || draftName === modal.ws.name
                }
              >
                Save
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            New name
          </label>
          <input
            className="input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
          />
          {error && (
            <p style={{ color: "var(--error)", marginTop: 8 }} className="t-12">
              {error}
            </p>
          )}
        </Modal>
      )}
      {configOpen && ws && (
        <ConfigPortModal
          workspaceId={ws.id}
          onClose={() => setConfigOpen(false)}
          onImported={() => {
            void refreshWorkspaces();
          }}
        />
      )}
      {modal?.kind === "delete" && (
        <Modal
          title="Delete workspace"
          onClose={() => {
            if (!pending) setModal(null);
          }}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={submitDelete}
                disabled={pending}
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="t-14">
            Delete <strong>{modal.ws.name}</strong>? This removes all documents,
            chunks, and experiments under it. This cannot be undone.
          </p>
          {error && (
            <p style={{ color: "var(--error)", marginTop: 8 }} className="t-12">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div className="row f-between">
      <span className="t-meta">{label}</span>
      <span style={accent ? { color: "var(--accent)" } : undefined}>{value}</span>
    </div>
  );
}
