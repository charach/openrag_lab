/**
 * External LLM provider key management.
 *
 * Lists the four providers (OpenAI / Anthropic / Gemini / OpenRouter) and lets
 * the user register, replace, or delete their API key. Keys are sent only
 * over the proxy to the local backend; the page never holds plaintext after
 * the request resolves.
 */

import { useEffect, useState } from "react";
import { api, ApiException, type ExternalProvider } from "../api/client";
import { Modal, PageHeader } from "../components/ui";

export function ExternalProviders(): JSX.Element {
  const [providers, setProviders] = useState<ExternalProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState<ExternalProvider | null>(null);
  const [deleting, setDeleting] = useState<ExternalProvider | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [validateNow, setValidateNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ message: string; workspaces: string[] } | null>(
    null,
  );

  const refresh = async (): Promise<void> => {
    try {
      const r = await api.listExternalProviders();
      setProviders(r.providers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const openRegister = (p: ExternalProvider): void => {
    setRegistering(p);
    setKeyDraft("");
    setValidateNow(true);
    setRegisterError(null);
  };

  const closeRegister = (): void => {
    if (busy) return;
    setRegistering(null);
    setKeyDraft("");
    setRegisterError(null);
  };

  const submitRegister = async (): Promise<void> => {
    if (!registering || keyDraft.trim().length === 0) return;
    setBusy(true);
    setRegisterError(null);
    try {
      await api.registerExternalProviderKey(registering.id, {
        key: keyDraft.trim(),
        validate_now: validateNow,
      });
      setRegistering(null);
      setKeyDraft("");
      await refresh();
    } catch (e) {
      if (e instanceof ApiException) {
        setRegisterError(e.error.message);
      } else {
        setRegisterError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async (): Promise<void> => {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteExternalProviderKey(deleting.id);
      setDeleting(null);
      await refresh();
    } catch (e) {
      if (e instanceof ApiException && e.error.code === "PROVIDER_IN_USE") {
        const ids = (e.error.details?.workspace_ids as string[] | undefined) ?? [];
        setDeleteError({ message: e.error.message, workspaces: ids });
      } else {
        setDeleteError({
          message: e instanceof Error ? e.message : String(e),
          workspaces: [],
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <PageHeader
        eyebrow="Settings"
        title="External LLM providers"
        sub="API 키를 등록하면 채팅·평가에서 'external:provider:model' id로 호출할 수 있습니다. 키는 로컬 디스크에만 저장됩니다."
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

      <div className="col gap-12" style={{ marginTop: 32 }}>
        {providers.map((p) => (
          <div
            key={p.id}
            className="card"
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div className="col gap-4">
              <div className="row gap-8 f-center">
                <span className="t-14">{p.name}</span>
                {p.key_registered ? (
                  <span
                    className="chip"
                    style={{ color: "var(--success)" }}
                    aria-label={`${p.id} key registered`}
                  >
                    <span className="dot" style={{ background: "var(--success)" }}></span>
                    Registered {p.key_suffix ? `(${p.key_suffix})` : ""}
                  </span>
                ) : (
                  <span className="chip t-meta" aria-label={`${p.id} key not registered`}>
                    <span className="dot" style={{ background: "var(--text-2)" }}></span>
                    No key
                  </span>
                )}
              </div>
              <span className="t-12 t-meta t-mono">
                models: {p.supported_models.slice(0, 3).join(", ")}
                {p.supported_models.length > 3 ? "…" : ""}
              </span>
            </div>
            <div className="row gap-8">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => openRegister(p)}
                aria-label={`register ${p.id} key`}
              >
                {p.key_registered ? "Replace key" : "Add key"}
              </button>
              {p.key_registered && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setDeleting(p);
                    setDeleteError(null);
                  }}
                  aria-label={`delete ${p.id} key`}
                  style={{ borderColor: "var(--error)", color: "var(--error)" }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {registering && (
        <Modal
          title={`${registering.name} — API key`}
          onClose={closeRegister}
          footer={
            <>
              <button className="btn" onClick={closeRegister} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitRegister}
                disabled={busy || keyDraft.trim().length === 0}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <label className="t-label" style={{ display: "block", marginBottom: 8 }}>
            API key
          </label>
          <input
            className="input"
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={registering.id === "openai" ? "sk-..." : "API key"}
            aria-label="api key"
          />
          <label
            className="row gap-8 f-center t-12"
            style={{ marginTop: 12, cursor: "pointer", userSelect: "none" }}
          >
            <input
              type="checkbox"
              checked={validateNow}
              onChange={(e) => setValidateNow(e.target.checked)}
              disabled={busy}
            />
            <span>Validate against {registering.name} now</span>
          </label>
          {registerError && (
            <p className="t-12" style={{ color: "var(--error)", marginTop: 12 }} role="alert">
              {registerError}
            </p>
          )}
        </Modal>
      )}

      {deleting && (
        <Modal
          title={`Delete ${deleting.name} key`}
          onClose={() => {
            if (!busy) {
              setDeleting(null);
              setDeleteError(null);
            }
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  if (!busy) {
                    setDeleting(null);
                    setDeleteError(null);
                  }
                }}
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
                {busy ? "…" : "Delete"}
              </button>
            </>
          }
        >
          <p className="t-14">
            Remove the API key for <em>{deleting.name}</em>?
          </p>
          {deleteError && (
            <div className="col gap-4" style={{ marginTop: 12 }} role="alert">
              <p className="t-12" style={{ color: "var(--error)" }}>
                {deleteError.message}
              </p>
              {deleteError.workspaces.length > 0 && (
                <p className="t-12 t-meta t-mono">
                  In use by: {deleteError.workspaces.join(", ")}
                </p>
              )}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
