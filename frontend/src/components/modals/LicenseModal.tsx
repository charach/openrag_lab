/**
 * License modal — gate model downloads behind a click-through. Used by
 * Auto-Pilot when a preset references a model whose license requires
 * acceptance (Llama 3 Community, Gemma 7B Terms, etc.). The accept
 * checkbox must be ticked before the primary button activates.
 */

import { useState } from "react";

export interface LicenseModalProps {
  model: {
    name: string;
    licenseId: string;
    size: string;
    /** "yes" / "research-only" / arbitrary string. */
    commercial: string;
    /** Optional URL to the canonical license document. */
    licenseUrl?: string;
  };
  /** License body text. Pre-rendered so the caller can fetch from disk. */
  body: string;
  onAccept?: () => void | Promise<void>;
  close: () => void;
}

export function LicenseModal({
  model,
  body,
  onAccept,
  close,
}: LicenseModalProps): JSX.Element {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="col gap-14" style={{ position: "relative" }}>
      <div className="card" style={{ padding: 14, background: "var(--bg-0)" }}>
        <div className="row f-between f-center">
          <span className="t-13">{model.name}</span>
          <span className="chip chip-mono">{model.licenseId}</span>
        </div>
        <div className="t-12 t-meta" style={{ marginTop: 6 }}>
          {model.size} · commercial use {model.commercial}
        </div>
      </div>
      <pre
        style={{
          maxHeight: 220,
          overflowY: "auto",
          padding: 14,
          background: "var(--bg-0)",
          border: "1px solid var(--border)",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          lineHeight: 1.6,
          color: "var(--text-1)",
          margin: 0,
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </pre>
      <label className="row gap-8 f-center t-13">
        <input
          type="checkbox"
          data-testid="license-accept-checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          disabled={submitting}
          style={{ accentColor: "var(--accent)" }}
        />
        라이선스 본문을 읽고 동의합니다.
      </label>
      <div
        className="row gap-8"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        {model.licenseUrl ? (
          <a
            href={model.licenseUrl}
            target="_blank"
            rel="noreferrer"
            className="t-12"
            style={{ color: "var(--accent)" }}
          >
            Open full license ↗
          </a>
        ) : (
          <span />
        )}
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={close} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            data-testid="license-accept-confirm"
            disabled={!accepted || submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onAccept?.();
                close();
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Accepting…" : "Accept & download"}
          </button>
        </div>
      </div>
      {submitting && (
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(2px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            zIndex: 5,
          }}
        >
          <span className="dot dot-gold pulse-gold"></span>
          <span className="t-13" style={{ color: "var(--text-0)" }}>
            라이선스 등록 후 모델 다운로드 준비 중…
          </span>
          <span className="t-12 t-meta">잠시만 기다려 주세요. 인덱싱이 곧 시작됩니다.</span>
        </div>
      )}
    </div>
  );
}
