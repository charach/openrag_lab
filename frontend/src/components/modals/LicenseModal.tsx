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
  return (
    <div className="col gap-14">
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
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
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
          <button className="btn btn-sm" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={!accepted}
            onClick={async () => {
              await onAccept?.();
              close();
            }}
          >
            Accept &amp; download
          </button>
        </div>
      </div>
    </div>
  );
}
