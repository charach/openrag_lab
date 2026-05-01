/**
 * Golden Sets — manage evaluation pairs.
 *
 * Backed by /golden-sets and /pairs endpoints. CSV export is just an
 * anchor pointing at the export URL; the browser handles the download.
 */

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useWorkspaceStore } from "../stores/workspace";
import { Icon, Modal, PageHeader } from "../components/ui";

interface SetItem {
  id: string;
  name: string;
  pair_count: number;
}

interface PairItem {
  id: string;
  question: string;
  expected_answer: string | null;
  expected_chunk_ids: string[];
}

export function GoldenSets(): JSX.Element {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [sets, setSets] = useState<SetItem[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [pairs, setPairs] = useState<PairItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [editing, setEditing] = useState<PairItem | null>(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<PairItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [addA, setAddA] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshSets = async (): Promise<void> => {
    if (!workspaceId) return;
    const r = await api.listGoldenSets(workspaceId);
    setSets(r.items);
    if (!activeSetId && r.items[0]) setActiveSetId(r.items[0].id);
  };

  const refreshPairs = async (): Promise<void> => {
    if (!workspaceId || !activeSetId) {
      setPairs([]);
      return;
    }
    const r = await api.listGoldenPairs(workspaceId, activeSetId);
    setPairs(r.items);
  };

  useEffect(() => {
    if (!workspaceId) return;
    refreshSets().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    refreshPairs().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, activeSetId]);

  const submitCreate = async (): Promise<void> => {
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createGoldenSet(workspaceId, createDraft);
      setCreateOpen(false);
      setCreateDraft("");
      await refreshSets();
      setActiveSetId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (): Promise<void> => {
    if (!workspaceId || !activeSetId || !editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateGoldenPair(workspaceId, activeSetId, editing.id, {
        question: editQ,
        expected_answer: editA || null,
      });
      setEditing(null);
      await refreshPairs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async (): Promise<void> => {
    if (!workspaceId || !activeSetId || !confirmDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGoldenPair(workspaceId, activeSetId, confirmDelete.id);
      setConfirmDelete(null);
      await refreshPairs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitAdd = async (): Promise<void> => {
    if (!workspaceId || !activeSetId) return;
    setBusy(true);
    setError(null);
    try {
      await api.addGoldenPairs(workspaceId, activeSetId, [
        { question: addQ, expected_answer: addA || null },
      ]);
      setAddOpen(false);
      setAddQ("");
      setAddA("");
      await refreshPairs();
      await refreshSets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!workspaceId)
    return (
      <section className="page">
        <p className="t-meta">워크스페이스를 먼저 선택하세요.</p>
      </section>
    );

  return (
    <section className="page">
      <PageHeader
        eyebrow="Golden Sets"
        title="Ground truth, version-controlled."
        sub="평가용 (질문, 정답) 페어를 관리합니다. CSV로 내보내고 다시 가져올 수 있습니다."
        right={
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            + New set
          </button>
        }
      />

      {error && (
        <div
          className="card"
          style={{
            padding: "10px 14px",
            marginTop: 24,
            borderColor: "var(--error)",
            color: "var(--error)",
          }}
        >
          <span className="t-12 t-mono">{error}</span>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: 24,
          marginTop: 32,
        }}
      >
        <div className="card" style={{ padding: 0 }}>
          <div
            className="t-label"
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            Sets
          </div>
          {sets.length === 0 ? (
            <p className="t-meta t-13" style={{ padding: 16 }}>
              No sets yet.
            </p>
          ) : (
            sets.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSetId(s.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  border: 0,
                  borderBottom: "1px solid var(--border)",
                  background: s.id === activeSetId ? "var(--bg-2)" : "transparent",
                  color: "var(--text-0)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span className="t-13">{s.name}</span>
                <span className="t-12 t-meta t-mono">{s.pair_count} pairs</span>
              </button>
            ))
          )}
        </div>

        <div className="col gap-12">
          <div className="row gap-8 f-center">
            <span className="t-label" style={{ flex: 1 }}>
              Pairs ({pairs.length})
            </span>
            <button
              className="btn btn-sm"
              disabled={!activeSetId}
              onClick={() => setAddOpen(true)}
            >
              + Add pair
            </button>
            {workspaceId && activeSetId && (
              <a
                className="btn btn-sm"
                href={api.exportGoldenSetUrl(workspaceId, activeSetId)}
                download
              >
                <Icon name="ext" size={11} /> Export CSV
              </a>
            )}
          </div>
          <div className="card">
            {pairs.length === 0 ? (
              <p
                className="t-meta t-13"
                style={{ padding: 32, textAlign: "center" }}
              >
                {activeSetId ? "No pairs yet." : "Pick or create a set."}
              </p>
            ) : (
              pairs.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "start",
                  }}
                >
                  <div className="col gap-4">
                    <span className="t-13">{p.question}</span>
                    <span className="t-12 t-meta">
                      {p.expected_answer ?? "—"}
                    </span>
                  </div>
                  <div className="row gap-4">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setEditing(p);
                        setEditQ(p.question);
                        setEditA(p.expected_answer ?? "");
                      }}
                      style={{
                        border: 0,
                        background: "transparent",
                        cursor: "pointer",
                        padding: 4,
                      }}
                      aria-label={`edit pair`}
                    >
                      <Icon name="settings" size={12} color="var(--text-2)" />
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => setConfirmDelete(p)}
                      style={{
                        border: 0,
                        background: "transparent",
                        cursor: "pointer",
                        padding: 4,
                      }}
                      aria-label={`delete pair`}
                    >
                      <Icon name="trash" size={12} color="var(--text-2)" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {createOpen && (
        <Modal
          title="New golden set"
          onClose={() => {
            if (!busy) setCreateOpen(false);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setCreateOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitCreate}
                disabled={busy || createDraft.trim().length === 0}
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
            value={createDraft}
            onChange={(e) => setCreateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
        </Modal>
      )}

      {editing && (
        <Modal
          title="Edit pair"
          onClose={() => {
            if (!busy) setEditing(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitEdit}
                disabled={busy || editQ.trim().length === 0}
              >
                Save
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            Question
          </label>
          <textarea
            className="input"
            rows={3}
            value={editQ}
            onChange={(e) => setEditQ(e.target.value)}
          />
          <label
            className="t-label"
            style={{ display: "block", margin: "12px 0 8px" }}
          >
            Expected answer (optional)
          </label>
          <textarea
            className="input"
            rows={3}
            value={editA}
            onChange={(e) => setEditA(e.target.value)}
          />
        </Modal>
      )}

      {addOpen && (
        <Modal
          title="Add pair"
          onClose={() => {
            if (!busy) setAddOpen(false);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setAddOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitAdd}
                disabled={busy || addQ.trim().length === 0}
              >
                Add
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            Question
          </label>
          <textarea
            className="input"
            autoFocus
            rows={3}
            value={addQ}
            onChange={(e) => setAddQ(e.target.value)}
          />
          <label
            className="t-label"
            style={{ display: "block", margin: "12px 0 8px" }}
          >
            Expected answer (optional)
          </label>
          <textarea
            className="input"
            rows={3}
            value={addA}
            onChange={(e) => setAddA(e.target.value)}
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="Delete pair"
          onClose={() => {
            if (!busy) setConfirmDelete(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => setConfirmDelete(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={submitDelete}
                disabled={busy}
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="t-14">
            Delete this pair? <em>{confirmDelete.question}</em>
          </p>
        </Modal>
      )}
    </section>
  );
}
