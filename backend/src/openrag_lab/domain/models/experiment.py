"""Experiment configuration + result.

The fingerprint is the canonical identity of an experiment — same fingerprint
means the same experiment was already run (caches can be reused, results
shown side-by-side, A/B comparisons made meaningful).
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import ExperimentStatus, RetrievalStrategy
from openrag_lab.domain.models.ids import ExperimentId, WorkspaceId


class ExperimentConfig(BaseModel):
    """Everything that determines what an experiment will produce."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    embedder_id: str = Field(min_length=1)
    chunking: ChunkingConfig
    retrieval_strategy: RetrievalStrategy
    top_k: int = Field(ge=1, le=50)
    reranker_id: str | None = None
    llm_id: str | None = None
    judge_llm_id: str | None = None

    @property
    def is_retrieval_only(self) -> bool:
        """True when no answering LLM is configured.

        See REQUIREMENTS_v4 §3.3.4 — retrieval-only mode is a P0 first-class
        feature. ``RAGPipeline`` skips generation entirely; LLM-dependent
        evaluation metrics are reported as ``None``.
        """
        return self.llm_id is None

    def fingerprint(self) -> str:
        """Deterministic 16-char identity of this configuration.

        ``None`` values are preserved (not stripped) so a config that
        explicitly opts out of an LLM stays distinct from one that
        defaults to a llm.
        """
        payload = {
            "embedder_id": self.embedder_id,
            "chunking": {
                "strategy": self.chunking.strategy.value,
                "chunk_size": self.chunking.chunk_size,
                "chunk_overlap": self.chunking.chunk_overlap,
                "extra": self.chunking.extra,
            },
            "retrieval_strategy": self.retrieval_strategy.value,
            "top_k": self.top_k,
            "reranker_id": self.reranker_id,
            "llm_id": self.llm_id,
            "judge_llm_id": self.judge_llm_id,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()[:16]


class EvaluationScores(BaseModel):
    """The four MVP metrics. ``None`` means "not measured" (retrieval-only mode)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    faithfulness: float | None = Field(default=None, ge=0.0, le=1.0)
    answer_relevance: float | None = Field(default=None, ge=0.0, le=1.0)
    context_precision: float | None = Field(default=None, ge=0.0, le=1.0)
    context_recall: float | None = Field(default=None, ge=0.0, le=1.0)


class StageProfile(BaseModel):
    """Per-stage performance numbers captured during a run."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    stage: str
    latency_ms: int = Field(ge=0)
    peak_memory_mb: float | None = Field(default=None, ge=0.0)


class PerformanceProfile(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    stages: tuple[StageProfile, ...] = Field(default_factory=tuple)

    @property
    def total_latency_ms(self) -> int:
        return sum(s.latency_ms for s in self.stages)


class ExperimentResult(BaseModel):
    """A completed experiment's outcome."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    experiment_id: ExperimentId
    workspace_id: WorkspaceId
    config: ExperimentConfig
    scores: EvaluationScores
    profile: PerformanceProfile
    status: ExperimentStatus
    started_at: datetime
    completed_at: datetime | None = None
    archived: bool = False  # Set True when its embedder dim becomes obsolete.
