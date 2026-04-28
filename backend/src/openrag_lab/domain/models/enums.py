"""Enumerations referenced across domain models.

Kept in one module so model files don't pull each other in just for an enum.
"""

from __future__ import annotations

from enum import StrEnum


class DocumentFormat(StrEnum):
    """Supported document formats. MVP P0: PDF, TXT, MD."""

    PDF = "pdf"
    TXT = "txt"
    MD = "md"


class ChunkingStrategy(StrEnum):
    FIXED = "fixed"
    RECURSIVE = "recursive"
    SENTENCE = "sentence"  # P1
    SEMANTIC = "semantic"  # P1


class RetrievalStrategy(StrEnum):
    DENSE = "dense"
    SPARSE = "sparse"  # P1
    HYBRID = "hybrid"  # P1


class DistanceMetric(StrEnum):
    COSINE = "cosine"
    L2 = "l2"
    INNER_PRODUCT = "ip"


class ExperimentStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class IndexingStage(StrEnum):
    """Per-document checkpoint stage. See ARCHITECTURE_v3.md §6.1."""

    PARSED = "parsed"
    CHUNKED = "chunked"
    EMBEDDED = "embedded"


class AccelBackend(StrEnum):
    """Acceleration backend selected for a model adapter.

    Authoritative selection logic lives in PLATFORM.md §3.3.
    """

    CPU = "cpu"
    CUDA = "cuda"
    METAL = "metal"
    ROCM = "rocm"
    XPU = "xpu"
    DIRECTML = "directml"
