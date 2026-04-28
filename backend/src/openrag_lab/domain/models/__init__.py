"""Pure-data domain models. Each module is independently importable."""

from openrag_lab.domain.models.chunk import (
    Chunk,
    ChunkingConfig,
    ChunkMetadata,
    ChunkPreview,
)
from openrag_lab.domain.models.document import Document, ParsedDocument, ParsedPage
from openrag_lab.domain.models.embedding import Embedding, EmbeddingBatch
from openrag_lab.domain.models.enums import (
    AccelBackend,
    ChunkingStrategy,
    DistanceMetric,
    DocumentFormat,
    ExperimentStatus,
    IndexingStage,
    RetrievalStrategy,
)
from openrag_lab.domain.models.experiment import (
    EvaluationScores,
    ExperimentConfig,
    ExperimentResult,
    PerformanceProfile,
    StageProfile,
)
from openrag_lab.domain.models.ids import (
    ChunkId,
    DocumentId,
    ExperimentId,
    GoldenPairId,
    GoldenSetId,
    TaskId,
    WorkspaceId,
    new_chunk_id,
    new_document_id,
    new_experiment_id,
    new_golden_pair_id,
    new_golden_set_id,
    new_task_id,
    new_workspace_id,
)
from openrag_lab.domain.models.retrieval import Query, RetrievalResult, RetrievedChunk
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta

__all__ = [
    "AccelBackend",
    "Chunk",
    "ChunkId",
    "ChunkMetadata",
    "ChunkPreview",
    "ChunkingConfig",
    "ChunkingStrategy",
    "DistanceMetric",
    "Document",
    "DocumentFormat",
    "DocumentId",
    "Embedding",
    "EmbeddingBatch",
    "EvaluationScores",
    "ExperimentConfig",
    "ExperimentId",
    "ExperimentResult",
    "ExperimentStatus",
    "GoldenPairId",
    "GoldenSetId",
    "IndexingStage",
    "ParsedDocument",
    "ParsedPage",
    "PerformanceProfile",
    "Query",
    "RetrievalResult",
    "RetrievalStrategy",
    "RetrievedChunk",
    "StageProfile",
    "TaskId",
    "Workspace",
    "WorkspaceId",
    "WorkspaceMeta",
    "new_chunk_id",
    "new_document_id",
    "new_experiment_id",
    "new_golden_pair_id",
    "new_golden_set_id",
    "new_task_id",
    "new_workspace_id",
]
