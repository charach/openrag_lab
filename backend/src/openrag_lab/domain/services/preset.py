"""HardwareProfiler + PresetRecommender.

Trivial domain service that converts a ``SystemProfile`` into a default
``ExperimentConfig`` suggestion. The recommender does NOT consult the
profile's exact hardware — it picks a tier based on RAM, then maps the
tier to a fixed preset (REQUIREMENTS_v4 §3.4 wizard).
"""

from __future__ import annotations

from dataclasses import dataclass

from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import (
    ChunkingStrategy,
    DistanceMetric,
    RetrievalStrategy,
)
from openrag_lab.domain.models.experiment import ExperimentConfig
from openrag_lab.domain.models.hardware import SystemProfile


@dataclass(frozen=True)
class Preset:
    """A named bundle the wizard offers."""

    name: str
    """Stable internal identifier (e.g. ``lite``). Persisted in
    workspace configs; do not rename without a migration."""
    display_name: str
    """Human-facing label rendered in the wizard (e.g. ``Speed``)."""
    embedder_id: str
    embedder_dim: int
    chunking: ChunkingConfig
    retrieval_strategy: RetrievalStrategy
    top_k: int
    metric: DistanceMetric
    rationale: str


_TIER_PRESETS: dict[str, Preset] = {
    "lite": Preset(
        name="lite",
        display_name="Speed",
        embedder_id="all-MiniLM-L6-v2",
        embedder_dim=384,
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE, chunk_size=256, chunk_overlap=32
        ),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=4,
        metric=DistanceMetric.COSINE,
        rationale="8GB 미만 GPU 또는 CPU 환경에서 빠른 응답.",
    ),
    "balanced": Preset(
        name="balanced",
        display_name="Balanced",
        embedder_id="BAAI/bge-base-en-v1.5",
        embedder_dim=768,
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE, chunk_size=512, chunk_overlap=64
        ),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=5,
        metric=DistanceMetric.COSINE,
        rationale="일반적인 PC 환경에서 정확도와 속도의 균형.",
    ),
    "quality": Preset(
        name="quality",
        display_name="Accuracy",
        embedder_id="BAAI/bge-m3",
        embedder_dim=1024,
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE, chunk_size=512, chunk_overlap=64
        ),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=8,
        metric=DistanceMetric.COSINE,
        rationale="대형 모델·높은 top_k. 24 GB+ RAM 권장.",
    ),
}


def _tier_for(profile: SystemProfile) -> str:
    gib = profile.ram.total_bytes / (1024**3)
    if gib < 6:
        return "lite"
    if gib < 12:
        return "balanced"
    return "quality"


def recommend(profile: SystemProfile) -> Preset:
    """Pick a preset based on the host RAM."""
    return _TIER_PRESETS[_tier_for(profile)]


def to_experiment_config(preset: Preset, *, llm_id: str | None = None) -> ExperimentConfig:
    """Convert a preset to an ``ExperimentConfig`` ready for indexing."""
    return ExperimentConfig(
        embedder_id=preset.embedder_id,
        chunking=preset.chunking,
        retrieval_strategy=preset.retrieval_strategy,
        top_k=preset.top_k,
        llm_id=llm_id,
    )


def list_presets() -> list[Preset]:
    return list(_TIER_PRESETS.values())
