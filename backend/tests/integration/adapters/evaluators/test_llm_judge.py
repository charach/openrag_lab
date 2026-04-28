"""LLMJudge — prompt construction + response parsing."""

from __future__ import annotations

from collections.abc import AsyncIterator

from openrag_lab.adapters.evaluators.llm_judge import LLMJudge
from openrag_lab.domain.models.enums import AccelBackend


class _ScriptedLLM:
    """Test double — returns a canned response and records each prompt."""

    def __init__(self, response: str) -> None:
        self._response = response
        self.prompts: list[str] = []

    @property
    def model_id(self) -> str:
        return "scripted"

    @property
    def is_local(self) -> bool:
        return True

    @property
    def active_backend(self) -> AccelBackend | None:
        return AccelBackend.CPU

    async def generate(self, prompt: str, max_tokens: int = 512, temperature: float = 0.0) -> str:
        self.prompts.append(prompt)
        return self._response

    async def stream(  # type: ignore[override]
        self, prompt: str, max_tokens: int = 512, temperature: float = 0.0
    ) -> AsyncIterator[str]:
        yield self._response


async def test_faithfulness_parses_score_and_rationale() -> None:
    llm = _ScriptedLLM("SCORE=0.9 RATIONALE=The answer is well-supported.")
    judge = LLMJudge(llm)
    score = await judge.score_faithfulness("answer text", ["chunk one", "chunk two"])
    assert score.value == 0.9
    assert "well-supported" in score.rationale


async def test_answer_relevance_includes_question_and_answer_in_prompt() -> None:
    llm = _ScriptedLLM("SCORE=0.5 RATIONALE=partial match")
    judge = LLMJudge(llm)
    await judge.score_answer_relevance("the answer", "the question")
    assert "the question" in llm.prompts[0]
    assert "the answer" in llm.prompts[0]


async def test_score_clamped_to_unit_interval() -> None:
    llm = _ScriptedLLM("SCORE=2.0 RATIONALE=overshoot")
    judge = LLMJudge(llm)
    score = await judge.score_context_precision("q", ["c"])
    assert score.value == 1.0


async def test_unparseable_response_falls_back_to_zero() -> None:
    llm = _ScriptedLLM("I refuse to follow the format.")
    judge = LLMJudge(llm)
    score = await judge.score_context_recall("expected answer", ["context"])
    assert score.value == 0.0
    assert "unparseable" in score.rationale.lower()


async def test_context_recall_uses_expected_answer() -> None:
    llm = _ScriptedLLM("SCORE=0.7 RATIONALE=mostly present")
    judge = LLMJudge(llm)
    await judge.score_context_recall("the gold answer", ["c1", "c2"])
    assert "the gold answer" in llm.prompts[0]
    # Context chunks are numbered.
    assert "[1] c1" in llm.prompts[0]


async def test_negative_score_clamped_to_zero() -> None:
    llm = _ScriptedLLM("SCORE=0.0 RATIONALE=nope")
    judge = LLMJudge(llm)
    score = await judge.score_faithfulness("a", ["c"])
    assert score.value == 0.0
