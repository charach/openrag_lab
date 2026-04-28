"""Adapter port (Protocol) definitions. Implementations live in adapters/."""

from openrag_lab.domain.ports.chunker import Chunker
from openrag_lab.domain.ports.embedder import Embedder, ProgressCallback
from openrag_lab.domain.ports.evaluator_judge import EvaluatorJudge, Score
from openrag_lab.domain.ports.llm import LLM
from openrag_lab.domain.ports.parser import DocumentParser
from openrag_lab.domain.ports.vector_store import (
    CollectionStats,
    VectorHit,
    VectorItem,
    VectorStore,
)

__all__ = [
    "LLM",
    "Chunker",
    "CollectionStats",
    "DocumentParser",
    "Embedder",
    "EvaluatorJudge",
    "ProgressCallback",
    "Score",
    "VectorHit",
    "VectorItem",
    "VectorStore",
]
