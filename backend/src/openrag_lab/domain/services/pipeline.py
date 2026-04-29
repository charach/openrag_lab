"""RAGPipeline — retrieval (always) + answer generation (when LLM configured).

Implements the retrieval-only-mode branch from REQUIREMENTS_v4 §3.3.4:
when ``ExperimentConfig.is_retrieval_only`` is True the pipeline returns
the retrieval result with ``answer = None`` and no LLM call is made.
"""

from __future__ import annotations

from dataclasses import dataclass

from openrag_lab.domain.models.experiment import ExperimentConfig
from openrag_lab.domain.models.retrieval import Query, RetrievalResult
from openrag_lab.domain.ports.llm import LLM
from openrag_lab.domain.services.retrieval import RetrievalService


@dataclass(frozen=True)
class RAGOutput:
    """Output of one RAG turn. ``answer is None`` ⇔ retrieval-only."""

    retrieval: RetrievalResult
    answer: str | None


class RAGPipeline:
    """Compose retrieval and (optional) answer generation."""

    def __init__(
        self,
        *,
        retrieval: RetrievalService,
        llm: LLM | None,
        config: ExperimentConfig,
    ) -> None:
        self._retrieval = retrieval
        self._llm = llm
        self._config = config

    async def answer(self, question: str) -> RAGOutput:
        result = await self._retrieval.retrieve(Query(text=question, top_k=self._config.top_k))
        if self._config.is_retrieval_only or self._llm is None:
            return RAGOutput(retrieval=result, answer=None)

        prompt = _format_prompt(
            question=question,
            contexts=[hit.chunk.content for hit in result.retrieved],
        )
        answer = await self._llm.generate(prompt, max_tokens=512, temperature=0.0)
        return RAGOutput(retrieval=result, answer=answer)


def _format_prompt(*, question: str, contexts: list[str]) -> str:
    joined = "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(contexts))
    return (
        "Answer the question using only the provided context. "
        "Cite sources by their bracket number.\n\n"
        f"CONTEXT:\n{joined}\n\nQUESTION: {question}\n\nANSWER:"
    )
