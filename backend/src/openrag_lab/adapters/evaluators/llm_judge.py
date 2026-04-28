"""LLM-as-a-judge evaluator (RAGAS-style, four MVP metrics).

Reference: docs/REQUIREMENTS_v4.md §3.4.2. Each metric prompt is a small
template that asks the LLM to return a number in [0,1] and a one-line
rationale. We parse the response defensively: if the LLM returns
something we cannot interpret, the score falls back to ``0.0`` with a
rationale that names the issue (so the user sees *something* in the UI
instead of a crash).
"""

from __future__ import annotations

import re

from openrag_lab.domain.ports.evaluator_judge import Score
from openrag_lab.domain.ports.llm import LLM

_PROMPT_FAITHFULNESS = """Evaluate whether the ANSWER is supported by the CONTEXT.
Score from 0.0 (unsupported) to 1.0 (fully supported).

CONTEXT:
{context}

ANSWER:
{answer}

Respond on a single line: SCORE=<0.0-1.0> RATIONALE=<one line>"""

_PROMPT_ANSWER_RELEVANCE = """Evaluate how well the ANSWER addresses the QUESTION.
Score from 0.0 (off-topic) to 1.0 (directly relevant).

QUESTION:
{question}

ANSWER:
{answer}

Respond on a single line: SCORE=<0.0-1.0> RATIONALE=<one line>"""

_PROMPT_CONTEXT_PRECISION = """Evaluate what fraction of the CONTEXT is
needed to answer the QUESTION. Score from 0.0 (mostly noise) to 1.0
(all relevant).

QUESTION:
{question}

CONTEXT:
{context}

Respond on a single line: SCORE=<0.0-1.0> RATIONALE=<one line>"""

_PROMPT_CONTEXT_RECALL = """Evaluate whether the CONTEXT contains the
information in the EXPECTED_ANSWER. Score from 0.0 (info missing) to 1.0
(info present).

EXPECTED_ANSWER:
{expected_answer}

CONTEXT:
{context}

Respond on a single line: SCORE=<0.0-1.0> RATIONALE=<one line>"""


_RESPONSE_RE = re.compile(
    r"SCORE\s*=\s*(?P<score>-?\d+(?:\.\d+)?)\s*RATIONALE\s*=\s*(?P<rationale>.+)",
    re.IGNORECASE | re.DOTALL,
)


def _parse(response: str) -> Score:
    match = _RESPONSE_RE.search(response)
    if not match:
        return Score(value=0.0, rationale=f"unparseable judge response: {response[:80]!r}")
    try:
        value = float(match.group("score"))
    except ValueError:
        return Score(value=0.0, rationale=f"non-numeric score in: {response[:80]!r}")
    value = max(0.0, min(1.0, value))
    rationale = match.group("rationale").strip()
    if not rationale:
        rationale = "(no rationale)"
    return Score(value=value, rationale=rationale)


def _join_context(chunks: list[str]) -> str:
    return "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(chunks))


class LLMJudge:
    """An ``EvaluatorJudge`` that delegates to a single LLM for all four metrics."""

    def __init__(self, llm: LLM) -> None:
        self._llm = llm

    async def score_faithfulness(self, answer: str, context: list[str]) -> Score:
        prompt = _PROMPT_FAITHFULNESS.format(context=_join_context(context), answer=answer)
        return _parse(await self._llm.generate(prompt, max_tokens=160, temperature=0.0))

    async def score_answer_relevance(self, answer: str, question: str) -> Score:
        prompt = _PROMPT_ANSWER_RELEVANCE.format(question=question, answer=answer)
        return _parse(await self._llm.generate(prompt, max_tokens=160, temperature=0.0))

    async def score_context_precision(self, question: str, context: list[str]) -> Score:
        prompt = _PROMPT_CONTEXT_PRECISION.format(question=question, context=_join_context(context))
        return _parse(await self._llm.generate(prompt, max_tokens=160, temperature=0.0))

    async def score_context_recall(self, expected_answer: str, context: list[str]) -> Score:
        prompt = _PROMPT_CONTEXT_RECALL.format(
            expected_answer=expected_answer, context=_join_context(context)
        )
        return _parse(await self._llm.generate(prompt, max_tokens=160, temperature=0.0))
