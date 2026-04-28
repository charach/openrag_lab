"""EvaluatorJudge port — produces the four MVP metrics with rationales."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field


class Score(BaseModel):
    """A single metric score plus the judge's rationale.

    ``rationale`` is non-empty by contract — the UI exposes it on click so
    users can audit what drove the number (REQUIREMENTS_v4 §3.4.2).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    value: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1)


@runtime_checkable
class EvaluatorJudge(Protocol):
    async def score_faithfulness(
        self,
        answer: str,
        context: list[str],
    ) -> Score: ...

    async def score_answer_relevance(
        self,
        answer: str,
        question: str,
    ) -> Score: ...

    async def score_context_precision(
        self,
        question: str,
        context: list[str],
    ) -> Score: ...

    async def score_context_recall(
        self,
        expected_answer: str,
        context: list[str],
    ) -> Score: ...
