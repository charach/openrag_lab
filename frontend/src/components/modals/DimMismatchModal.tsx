/**
 * Dim-mismatch modal — shown when the user tries to switch the embedder
 * to one with a different vector dimension. ChromaDB collections are
 * keyed by dim, so a switch forces a full re-index. Existing experiment
 * results stay searchable but are flipped to ``archived`` so the user
 * doesn't accidentally compare scores across incompatible runs.
 */

import { Icon, RetrievalOnlyBadge } from "../ui";

export interface DimMismatchModalProps {
  from: { name: string; dim: number };
  to: { name: string; dim: number };
  /** How many active experiments will be archived by the switch. */
  archivedCount: number;
  /** Optional ETA string for the reindex. */
  etaLabel?: string;
  onConfirm?: () => void | Promise<void>;
  close: () => void;
}

export function DimMismatchModal({
  from,
  to,
  archivedCount,
  etaLabel,
  onConfirm,
  close,
}: DimMismatchModalProps): JSX.Element {
  return (
    <div className="col gap-14">
      <p className="t-13 t-dim" style={{ margin: 0, lineHeight: 1.6 }}>
        임베더가 차원이 다른 모델로 변경되었습니다. ChromaDB 컬렉션이 차원별로
        분리되며, 전체 재인덱싱이 필요합니다.
      </p>
      <div className="card" style={{ padding: 14, background: "var(--bg-0)" }}>
        <div
          className="row gap-16 f-center"
          style={{ justifyContent: "space-between" }}
        >
          <div className="col gap-2">
            <span className="t-label" style={{ fontSize: 9 }}>
              From
            </span>
            <span className="t-mono t-13">{from.name}</span>
            <span className="t-mono t-12 t-meta">dim {from.dim}</span>
          </div>
          <Icon name="right" size={16} color="var(--accent)" />
          <div className="col gap-2">
            <span
              className="t-label"
              style={{ fontSize: 9, color: "var(--accent)" }}
            >
              To
            </span>
            <span className="t-mono t-13" style={{ color: "var(--accent)" }}>
              {to.name}
            </span>
            <span className="t-mono t-12" style={{ color: "var(--accent)" }}>
              dim {to.dim}
            </span>
          </div>
        </div>
      </div>
      <div
        className="card"
        style={{
          padding: 12,
          background: "var(--bg-0)",
          borderLeft: "2px solid var(--accent)",
        }}
      >
        <div className="row gap-8 f-center t-12" style={{ flexWrap: "wrap" }}>
          <Icon name="archive" size={11} />
          <span>기존 실험 결과</span>
          <span className="t-mono" style={{ color: "var(--accent)" }}>
            {archivedCount}개
          </span>
          <span>는 archived 상태로 보존되어 비교에 사용할 수 있습니다.</span>
          <RetrievalOnlyBadge />
        </div>
      </div>
      {etaLabel && (
        <div className="t-12 t-mono t-meta">
          예상 재인덱싱 시간 ≈ {etaLabel}
        </div>
      )}
      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={close}>
          Cancel — keep current
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={async () => {
            await onConfirm?.();
            close();
          }}
        >
          Accept &amp; reindex
        </button>
      </div>
    </div>
  );
}
