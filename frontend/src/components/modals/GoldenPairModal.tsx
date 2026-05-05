/**
 * Add / edit a single golden-set pair. The expected_chunk_ids field is
 * optional and parsed as a comma-separated list — empty string yields
 * an empty array. Used from the inline GoldenSetPanel inside the
 * Experiment Matrix screen.
 */

import { useState } from "react";

export interface GoldenPairValue {
  question: string;
  expected_answer: string;
  expected_chunk_ids: string[];
}

export interface GoldenPairModalProps {
  initial?: GoldenPairValue;
  onSave: (value: GoldenPairValue) => void | Promise<void>;
  close: () => void;
}

export function GoldenPairModal({
  initial,
  onSave,
  close,
}: GoldenPairModalProps): JSX.Element {
  const [q, setQ] = useState(initial?.question ?? "");
  const [a, setA] = useState(initial?.expected_answer ?? "");
  const [chunks, setChunks] = useState(
    initial?.expected_chunk_ids.join(", ") ?? "",
  );

  const submit = async (): Promise<void> => {
    const parsed = chunks
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await onSave({
      question: q.trim(),
      expected_answer: a.trim(),
      expected_chunk_ids: parsed,
    });
    close();
  };

  return (
    <div className="col gap-14">
      <div className="col gap-6">
        <span className="t-label">Question</span>
        <textarea
          className="input"
          rows={2}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="평가용 질문…"
        />
      </div>
      <div className="col gap-6">
        <span className="t-label">Expected answer</span>
        <textarea
          className="input"
          rows={4}
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder="정답 예시…"
        />
      </div>
      <div className="col gap-6">
        <span className="t-label">Expected chunk IDs (optional)</span>
        <input
          className="input"
          placeholder="chunk_111, chunk_142"
          value={chunks}
          onChange={(e) => setChunks(e.target.value)}
        />
        <span className="t-12 t-meta">
          쉼표로 구분. 검색 평가에서 정답 청크가 검색 결과에 포함되었는지
          확인합니다.
        </span>
      </div>
      <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={close}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!q.trim() || !a.trim()}
          onClick={submit}
        >
          {initial ? "Save changes" : "Add pair"}
        </button>
      </div>
    </div>
  );
}
