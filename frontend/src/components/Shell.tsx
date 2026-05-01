/**
 * Global header for OpenRAG-Lab — wordmark, workspace selector, route nav,
 * hardware chip. All state besides the active workspace is local (open/closed
 * dropdowns, last-known system profile).
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type SystemProfileResponse, type WorkspaceSummary } from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon } from "./ui";

const NAV: Array<{ path: string; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { path: "/", label: "Auto-Pilot", icon: "wand" },
  { path: "/chunking", label: "Chunking Lab", icon: "scissors" },
  { path: "/chat", label: "Chat", icon: "chat" },
  { path: "/experiments", label: "Experiments", icon: "grid" },
];

export function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActive = useWorkspaceStore((s) => s.setActiveWorkspace);

  const [profile, setProfile] = useState<SystemProfileResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  const [hwOpen, setHwOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);
  const hwRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .systemProfile()
      .then(setProfile)
      .catch(() => undefined);
    api
      .listWorkspaces()
      .then((r) => {
        setWorkspaces(r.items);
        const first = r.items[0];
        if (!activeId && first) setActive(first.id);
      })
      .catch(() => undefined);
  }, [activeId, setActive]);

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
          {wsOpen && workspaces.length > 0 && (
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
                <button
                  key={w.id}
                  onClick={() => {
                    setActive(w.id);
                    setWsOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    background: w.id === ws?.id ? "var(--bg-2)" : "transparent",
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
              ))}
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
