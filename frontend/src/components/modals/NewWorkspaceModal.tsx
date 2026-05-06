/**
 * Header "+ New workspace" modal: name + preset row picker.
 *
 * Replaces the bare-name input that used to live inline in Shell.tsx so
 * the preset chosen here is sent to POST /workspaces — matching the
 * design handoff (modal-content.jsx :: NewWorkspaceModal). The preset
 * row layout is intentionally compact (one-line per preset) because
 * the full PresetCard belongs in the Auto-Pilot wizard, not in a header
 * popover-sized modal.
 */

import { useEffect, useState } from "react";
import { api, type PresetResponse } from "../../api/client";
import { Modal } from "../ui";

type PresetEntry = PresetResponse["presets"][number];

export interface NewWorkspaceModalProps {
  onCreate: (name: string, presetId: string) => Promise<void>;
  onClose: () => void;
  /** Inject presets directly to bypass the network fetch (used in tests). */
  presetsOverride?: PresetEntry[];
}

const FALLBACK_DEFAULT = "balanced";

export function NewWorkspaceModal({
  onCreate,
  onClose,
  presetsOverride,
}: NewWorkspaceModalProps): JSX.Element {
  const [name, setName] = useState("");
  const [presets, setPresets] = useState<PresetEntry[]>(presetsOverride ?? []);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (presetsOverride) return;
    api
      .systemPresets()
      .then((r) => setPresets(r.presets))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load presets"));
  }, [presetsOverride]);

  useEffect(() => {
    if (presetId !== null || presets.length === 0) return;
    const recommended = presets.find((p) => p.recommended && p.available);
    const balanced = presets.find((p) => p.id === FALLBACK_DEFAULT && p.available);
    const firstAvailable = presets.find((p) => p.available);
    const next = recommended ?? balanced ?? firstAvailable;
    if (next) setPresetId(next.id);
  }, [presets, presetId]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && presetId !== null && !pending;

  const submit = async (): Promise<void> => {
    if (!canSubmit || presetId === null) return;
    setPending(true);
    setError(null);
    try {
      await onCreate(trimmed, presetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="New workspace"
      onClose={() => {
        if (!pending) onClose();
      }}
      onConfirm={() => {
        if (canSubmit) void submit();
      }}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            Create workspace
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="col gap-6">
          <span className="t-label">Workspace name</span>
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 사내 매뉴얼"
            data-testid="new-workspace-name"
          />
          <span className="t-12 t-meta">1–200자. 다른 워크스페이스와 격리됩니다.</span>
        </div>

        <div className="col gap-6">
          <span className="t-label">Preset</span>
          {presets.length === 0 ? (
            <span className="t-12 t-meta">Loading presets…</span>
          ) : (
            <div className="col gap-1" role="radiogroup" aria-label="Preset">
              {presets.map((p) => {
                const selected = presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => p.available && setPresetId(p.id)}
                    disabled={!p.available}
                    data-testid={`preset-${p.id}`}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      background: selected ? "var(--bg-2)" : "var(--bg-0)",
                      border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                      color: "var(--text-0)",
                      cursor: p.available ? "pointer" : "not-allowed",
                      opacity: p.available ? 1 : 0.5,
                      fontFamily: "inherit",
                      marginBottom: -1,
                    }}
                  >
                    <div className="row f-between f-center">
                      <span className="t-13">
                        {p.name}
                        {p.recommended && (
                          <span
                            className="chip chip-gold"
                            style={{ fontSize: 9, marginLeft: 8 }}
                          >
                            Recommended
                          </span>
                        )}
                      </span>
                      <span className="t-mono t-12 t-meta">{p.config.embedder_id}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <p style={{ color: "var(--error)", margin: 0 }} className="t-12">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
