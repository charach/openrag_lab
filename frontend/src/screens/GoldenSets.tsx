/**
 * Golden Sets — manage evaluation pairs.
 *
 * Backed by /golden-sets and /pairs endpoints. CSV export hands off to
 * the browser via a download anchor pointing at the backend export URL.
 *
 * Add / edit pairs goes through the shared GoldenPairModal (which also
 * captures expected_chunk_ids); CSV import goes through the shared
 * UploadModal so it matches the document upload UX.
 */

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { GoldenPairModal } from "../components/modals/GoldenPairModal";
import { UploadModal } from "../components/modals/UploadModal";
import { confirmModal, useModal } from "../components/providers/ModalProvider";
import { useToast } from "../components/providers/ToastProvider";
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
  const modal = useModal();
  const toast = useToast();
  const [sets, setSets] = useState<SetItem[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [pairs, setPairs] = useState<PairItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
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
      toast.push({ eyebrow: "Created", message: `${createDraft} ready.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openAdd = (): void => {
    if (!activeSetId) return;
    modal.open({
      title: "Add golden pair",
      eyebrow: "Golden set",
      width: 520,
      render: ({ close }) => (
        <GoldenPairModal
          onSave={async (v) => {
            if (!workspaceId) return;
            await api.addGoldenPairs(workspaceId, activeSetId, [
              {
                question: v.question,
                expected_answer: v.expected_answer || null,
                expected_chunk_ids: v.expected_chunk_ids,
              },
            ]);
            await refreshPairs();
            await refreshSets();
            toast.push({
              eyebrow: "Added",
              message: "New pair saved to golden set.",
            });
          }}
          close={close}
        />
      ),
    });
  };

  const openEdit = (p: PairItem): void => {
    if (!activeSetId) return;
    modal.open({
      title: "Edit golden pair",
      eyebrow: "Golden set",
      width: 520,
      render: ({ close }) => (
        <GoldenPairModal
          initial={{
            question: p.question,
            expected_answer: p.expected_answer ?? "",
            expected_chunk_ids: p.expected_chunk_ids,
          }}
          onSave={async (v) => {
            if (!workspaceId) return;
            await api.updateGoldenPair(workspaceId, activeSetId, p.id, {
              question: v.question,
              expected_answer: v.expected_answer || null,
              expected_chunk_ids: v.expected_chunk_ids,
            });
            await refreshPairs();
            toast.push({ eyebrow: "Saved", message: "Pair updated." });
          }}
          close={close}
        />
      ),
    });
  };

  const askDelete = (p: PairItem): void => {
    if (!activeSetId) return;
    confirmModal(modal, {
      title: "Delete this pair?",
      message: p.question,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        if (!workspaceId) return;
        await api.deleteGoldenPair(workspaceId, activeSetId, p.id);
        await refreshPairs();
        toast.push({
          eyebrow: "Deleted",
          message: "Pair removed.",
          kind: "error",
        });
      },
    });
  };

  const openImport = (): void => {
    if (!activeSetId) return;
    modal.open({
      title: "Import golden set",
      eyebrow: "CSV upload",
      width: 480,
      render: ({ close }) => (
        <UploadModal
          accept=".csv"
          hint="CSV with columns: question, expected_answer, source"
          confirmLabel="Import"
          autoIndexToggle={false}
          onUpload={async (files) => {
            if (!workspaceId || files.length === 0) return;
            const f = files[0]!;
            const r = await api.importGoldenPairs(workspaceId, activeSetId, f);
            toast.push({
              eyebrow: "Imported",
              message: `+${r.added} pairs${r.skipped ? `, ${r.skipped} skipped` : ""}.`,
            });
            await refreshPairs();
            await refreshSets();
          }}
          close={close}
        />
      ),
    });
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
              onClick={openAdd}
            >
              + Add pair
            </button>
            {workspaceId && activeSetId && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={openImport}
                  disabled={busy}
                >
                  <Icon name="upload" size={11} /> Import CSV
                </button>
                <a
                  className="btn btn-sm"
                  href={api.exportGoldenSetUrl(workspaceId, activeSetId)}
                  download
                >
                  <Icon name="yaml" size={11} /> Export CSV
                </a>
              </>
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
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    alignItems: "start",
                  }}
                >
                  <div className="col gap-4">
                    <span className="t-13">{p.question}</span>
                    <span className="t-12 t-meta">
                      {p.expected_answer ?? "—"}
                    </span>
                    {p.expected_chunk_ids.length > 0 && (
                      <span className="t-12 t-mono t-meta">
                        chunks: {p.expected_chunk_ids.slice(0, 3).join(", ")}
                        {p.expected_chunk_ids.length > 3 && ` … +${p.expected_chunk_ids.length - 3}`}
                      </span>
                    )}
                  </div>
                  <span
                    className="t-12 t-mono t-meta"
                    style={{ textAlign: "right", whiteSpace: "nowrap" }}
                  >
                    {p.expected_chunk_ids.length} chunks
                  </span>
                  <div className="row gap-4">
                    <button
                      className="btn-ghost"
                      onClick={() => openEdit(p)}
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
                      onClick={() => askDelete(p)}
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
          onConfirm={() => {
            if (!busy && createDraft.trim().length > 0) void submitCreate();
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
          />
        </Modal>
      )}
    </section>
  );
}
