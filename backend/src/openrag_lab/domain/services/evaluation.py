"""EvaluationService — runs the four MVP metrics across a golden set.

Reference: docs/ARCHITECTURE_v3.md §6.3. In retrieval-only mode (no LLM
configured) we skip the metrics that require an answer string and report
those as ``None`` (REQUIREMENTS_v4 §3.4.2).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from openrag_lab.domain.models.experiment import EvaluationScores, ExperimentConfig
from openrag_lab.domain.ports.evaluator_judge import EvaluatorJudge
from openrag_lab.domain.services.pipeline import RAGPipeline


@dataclass(frozen=True)
class GoldenPairInput:
    """Subset of ``GoldenPair`` the evaluator needs (decoupled from infra)."""

    question: str
    expected_answer: str | None = None


def _mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


class EvaluationService:
    """Orchestrate retrieve+answer per pair, then judge with ``EvaluatorJudge``."""

    def __init__(
        self,
        *,
        pipeline: RAGPipeline,
        judge: EvaluatorJudge,
        config: ExperimentConfig,
    ) -> None:
        self._pipeline = pipeline
        self._judge = judge
        self._config = config

    async def evaluate(self, pairs: list[GoldenPairInput]) -> EvaluationScores:
        faith: list[float] = []
        rel: list[float] = []
        prec: list[float] = []
        recall: list[float] = []

        for pair in pairs:
            output = await self._pipeline.answer(pair.question)
            ctx = [hit.chunk.content for hit in output.retrieval.retrieved]

            # Context precision is independent of the answering LLM.
            p = await self._judge.score_context_precision(pair.question, ctx)
            prec.append(p.value)

            if pair.expected_answer is not None:
                r = await self._judge.score_context_recall(pair.expected_answer, ctx)
                recall.append(r.value)

            if not self._config.is_retrieval_only and output.answer is not None:
                f = await self._judge.score_faithfulness(output.answer, ctx)
                a = await self._judge.score_answer_relevance(output.answer, pair.question)
                faith.append(f.value)
                rel.append(a.value)

        return EvaluationScores(
            faithfulness=_mean(faith),
            answer_relevance=_mean(rel),
            context_precision=_mean(prec),
            context_recall=_mean(recall),
        )
