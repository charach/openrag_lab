/**
 * Global header for OpenRAG-Lab — wordmark, workspace selector, route nav,
 * hardware chip. All state besides the active workspace is local (open/closed
 * dropdowns, last-known system profile).
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type SystemProfileResponse, type WorkspaceSummary } from "../api/client";
import { useExternalCallStore } from "../stores/externalCall";
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
  const externalCall = useExternalCallStore((s) => s.call);

  const [profile, setProfile] = useState<SystemProfileResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [wsOpen, setWsOpen] = useState(false);
  const [hwOpen, setHwOpen] = useState(false);
  const [modal, setModal] = useState<
    | { kind: "create" }
    | { kind: "rename"; ws: WorkspaceSummary }
    | { kind: "delete"; targets: WorkspaceSummary[] }
    | null
  >(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // Bulk-select state lives only while the dropdown is open. Cleared on
  // open/close so the user always starts from a clean slate.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
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
        const stillExists = activeId && items.some((w) => w.id === activeId);
        if (!stillExists && first) setActive(first.id);
        else if (!first) setActive(null);
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
    const targets = modal.targets;
    try {
      // Issue deletes in parallel — the API has no batch endpoint and a
      // sequential loop made the user wait one round-trip per workspace.
      const settled = await Promise.allSettled(
        targets.map((w) => api.deleteWorkspace(w.id)),
      );
      const failures = settled
        .map((r, i) => (r.status === "rejected" ? targets[i]!.name : null))
        .filter((x): x is string => x !== null);
      const items = await refreshWorkspaces();
      const deletedActive = targets.some((t) => t.id === activeId);
      if (deletedActive) setActive(items[0]?.id ?? null);
      if (failures.length > 0) {
        setError(`삭제 실패: ${failures.join(", ")}`);
      } else {
        setModal(null);
        setSelectedIds(new Set());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  const toggleSelected = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectedWorkspaces = workspaces.filter((w) => selectedIds.has(w.id));
  const canBulkDelete = selectedWorkspaces.length > 0 && selectedWorkspaces.length < workspaces.length;
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
        <button
          type="button"
          aria-label="OpenRAG-Lab home"
          onClick={() => navigate("/")}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 24px",
            borderRight: "1px solid var(--border)",
            minWidth: 220,
            background: "transparent",
            border: 0,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <h1
            className="t-wordmark"
            style={{ fontSize: 17, color: "var(--text-0)", margin: 0, fontWeight: 400 }}
          >
            OpenRAG<span style={{ color: "var(--accent)" }}>·</span>Lab
          </h1>
        </button>

        {/* Workspace selector */}
        <div
          ref={wsRef}
          style={{ position: "relative", borderRight: "1px solid var(--border)" }}
        >
          <button
            onClick={() => {
              setWsOpen((v) => {
                const next = !v;
                if (next) setSelectedIds(new Set());
                return next;
              });
            }}
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
              {workspaces.map((w) => {
                const isChecked = selectedIds.has(w.id);
                return (
                  <div
                    key={w.id}
                    className="row f-center"
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: w.id === ws?.id ? "var(--bg-2)" : "transparent",
                    }}
                  >
                    <label
                      aria-label={`select ${w.name} for bulk action`}
                      style={{ padding: "10px 6px 10px 12px", cursor: "pointer", display: "flex" }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelected(w.id)}
                        style={{ accentColor: "var(--accent)" }}
                      />
                    </label>
                    <button
                      onClick={() => {
                        setActive(w.id);
                        setWsOpen(false);
                      }}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        padding: "10px 14px 10px 6px",
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
                      disabled={workspaces.length === 1}
                      onClick={() => {
                        setModal({ kind: "delete", targets: [w] });
                        setWsOpen(false);
                      }}
                      className="btn-ghost"
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 8,
                        cursor: workspaces.length === 1 ? "not-allowed" : "pointer",
                        opacity: workspaces.length === 1 ? 0.3 : 1,
                      }}
                    >
                      <Icon name="trash" size={12} color="var(--text-2)" />
                    </button>
                  </div>
                );
              })}
              {selectedWorkspaces.length > 0 && (
                <div
                  className="row f-between f-center"
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-2)",
                  }}
                >
                  <span className="t-12 t-meta">
                    {selectedWorkspaces.length} selected
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={!canBulkDelete}
                    title={
                      canBulkDelete
                        ? `Delete ${selectedWorkspaces.length} workspaces`
                        : "최소 1개의 워크스페이스는 남아있어야 합니다"
                    }
                    onClick={() => {
                      setModal({ kind: "delete", targets: selectedWorkspaces });
                      setWsOpen(false);
                    }}
                    style={{ borderColor: "var(--error)", color: "var(--error)" }}
                  >
                    <Icon name="trash" size={11} /> Delete selected
                  </button>
                </div>
              )}
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
          {profile?.test_mode && (
            <span
              className="chip"
              title="Backend booted with OPENRAG_LAB_TEST_MODE=1 — fake adapters in place of real models."
              style={{ color: "var(--text-2)", borderColor: "var(--border)" }}
            >
              Test mode · fake adapters
            </span>
          )}
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
                  value={
                    profile.ram.available_gb !== null && profile.ram.available_gb !== undefined
                      ? `${profile.ram.available_gb} / ${profile.ram.total_gb} GB`
                      : `${profile.ram.total_gb} GB`
                  }
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
          <div
            style={{ display: "flex", alignItems: "center", gap: 7 }}
            title={
              externalCall
                ? `Talking to ${externalCall.provider} — your prompt is leaving local-only mode.`
                : "All inference is happening on your machine."
            }
          >
            <span className={"dot" + (externalCall ? " dot-gold pulse-gold" : "")}></span>
            <span
              className="t-12 t-meta"
              style={{
                color: externalCall ? "var(--accent)" : "var(--text-2)",
              }}
            >
              {externalCall
                ? `${externalCall.provider} · ${externalCall.stage}`
                : "local only"}
            </span>
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
          onConfirm={() => {
            if (!pending && draftName.trim().length > 0) void submitCreate();
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
          onConfirm={() => {
            if (
              !pending &&
              draftName.trim().length > 0 &&
              draftName !== modal.ws.name
            ) {
              void submitRename();
            }
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
          title={
            modal.targets.length === 1
              ? "Delete workspace"
              : `Delete ${modal.targets.length} workspaces`
          }
          onClose={() => {
            if (!pending) setModal(null);
          }}
          onConfirm={() => {
            if (!pending) void submitDelete();
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
                autoFocus
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </>
          }
        >
          {modal.targets.length === 1 ? (
            <p className="t-14">
              Delete <strong>{modal.targets[0]!.name}</strong>? This removes all
              documents, chunks, and experiments under it. This cannot be undone.
            </p>
          ) : (
            <>
              <p className="t-14">
                Delete the following {modal.targets.length} workspaces? All
                documents, chunks, and experiments under them are removed
                permanently.
              </p>
              <ul className="t-13" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {modal.targets.map((t) => (
                  <li key={t.id} style={{ color: "var(--text-1)", lineHeight: 1.7 }}>
                    {t.name}
                    <span className="t-12 t-meta t-mono" style={{ marginLeft: 8 }}>
                      {t.stats.document_count} docs · {t.stats.chunk_count.toLocaleString()} chunks
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="t-12 t-meta" style={{ marginTop: 12 }}>
            Press <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to cancel.
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
