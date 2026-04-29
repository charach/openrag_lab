"""Indexing endpoint (API_SPEC §8) — POST /workspaces/{id}/index."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.runtime import build_runtime
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState, TaskMetadata
from openrag_lab.app.ws.hub import WebSocketProgressReporter
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import ChunkingStrategy, ExperimentStatus, RetrievalStrategy
from openrag_lab.domain.models.experiment import (
    EvaluationScores,
    ExperimentConfig,
    ExperimentResult,
    PerformanceProfile,
)
from openrag_lab.domain.models.ids import (
    WorkspaceId,
    new_experiment_id,
)
from openrag_lab.domain.services.cancellation import CancellationToken
from openrag_lab.domain.services.indexing import IndexingService
from openrag_lab.domain.services.task_queue import TaskState

router = APIRouter(tags=["indexing"])


class ChunkingPayload(BaseModel):
    strategy: str
    chunk_size: int = Field(ge=32, le=4096)
    chunk_overlap: int = Field(default=0, ge=0)
    extra: dict[str, Any] = Field(default_factory=dict)


class ConfigPayload(BaseModel):
    embedder_id: str = Field(min_length=1)
    chunking: ChunkingPayload
    retrieval_strategy: str = "dense"
    top_k: int = Field(default=5, ge=1, le=50)
    reranker_id: str | None = None
    llm_id: str | None = None
    judge_llm_id: str | None = None


class IndexBody(BaseModel):
    config: ConfigPayload
    document_ids: list[str] | None = None
    force_reindex: bool = False


def _to_experiment_config(payload: ConfigPayload) -> ExperimentConfig:
    return ExperimentConfig(
        embedder_id=payload.embedder_id,
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy(payload.chunking.strategy),
            chunk_size=payload.chunking.chunk_size,
            chunk_overlap=payload.chunking.chunk_overlap,
            extra=payload.chunking.extra,
        ),
        retrieval_strategy=RetrievalStrategy(payload.retrieval_strategy),
        top_k=payload.top_k,
        reranker_id=payload.reranker_id,
        llm_id=payload.llm_id,
        judge_llm_id=payload.judge_llm_id,
    )


@router.post(
    "/workspaces/{workspace_id}/index",
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_indexing(
    workspace_id: str,
    body: IndexBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = WorkspaceRegistry(state.layout)
    ws_id = WorkspaceId(workspace_id)
    if registry.get(ws_id) is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": workspace_id},
        )

    # Reject a concurrent indexing run on the same workspace.
    for task_id, meta in state.task_metadata.items():
        if meta.kind != "indexing" or meta.workspace_id != workspace_id:
            continue
        handle = state.task_queue.status(task_id)
        if handle is not None and handle.state in {
            TaskState.PENDING,
            TaskState.RUNNING,
        }:
            raise HttpError(
                status_code=409,
                code="INDEXING_IN_PROGRESS",
                message="이미 인덱싱이 진행 중입니다.",
                recoverable=True,
                details={"running_task_id": str(task_id)},
            )

    try:
        config = _to_experiment_config(body.config)
    except ValueError as exc:
        raise HttpError(
            status_code=422,
            code="CONFIG_VALIDATION_FAILED",
            message="설정이 유효하지 않습니다.",
            recoverable=True,
            details={"underlying": str(exc)},
        ) from exc

    # Build runtime + select documents.
    runtime = build_runtime(
        registry=registry,
        workspace_id=ws_id,
        embedder_id=config.embedder_id,
        factories=state.factories,
    )
    try:
        all_docs = runtime.document_repo.list_for_workspace(ws_id)
        if body.document_ids is not None:
            wanted = set(body.document_ids)
            documents = [d for d in all_docs if str(d.id) in wanted]
        else:
            documents = list(all_docs)

        # Validate chunk_size against embedder.
        if config.chunking.chunk_size > runtime.embedder.max_tokens:
            raise HttpError(
                status_code=422,
                code="CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT",
                message=(
                    f"청크 크기({config.chunking.chunk_size})가 임베더 "
                    f"'{runtime.embedder.model_id}'의 최대 토큰"
                    f"({runtime.embedder.max_tokens})을 초과합니다."
                ),
                recoverable=False,
                details={
                    "chunk_size": config.chunking.chunk_size,
                    "embedder_max_tokens": runtime.embedder.max_tokens,
                },
            )

        experiment_id = new_experiment_id()
        runtime.experiment_repo.add_pending(
            experiment_id=experiment_id,
            workspace_id=ws_id,
            config=config,
            started_at_iso=datetime.now(UTC).isoformat(),
        )
    except BaseException:
        runtime.close()
        raise

    topic = f"experiment:{experiment_id}"
    reporter = WebSocketProgressReporter(state.hub)
    indexing_service = IndexingService(
        parsers=runtime.parsers,
        chunkers=runtime.chunkers,
        embedder=runtime.embedder,
        vector_store=runtime.vector_store,
        chunk_repo=runtime.chunk_repo,  # type: ignore[arg-type]
        checkpoint_repo=runtime.checkpoint_repo,
    )

    async def _job(token: CancellationToken) -> None:
        try:
            await state.hub.publish(
                topic,
                {"type": "started", "task_id": None, "total_documents": len(documents)},
            )
            report = await indexing_service.run(
                workspace_id=ws_id,
                documents=documents,
                config=config,
                chunking=config.chunking,
                token=token,
                progress=reporter,
                topic=topic,
            )
            final_status = (
                ExperimentStatus.CANCELLED if report.cancelled else ExperimentStatus.COMPLETED
            )
            runtime.experiment_repo.save_result(
                ExperimentResult(
                    experiment_id=experiment_id,
                    workspace_id=ws_id,
                    config=config,
                    scores=EvaluationScores(),
                    profile=PerformanceProfile(),
                    status=final_status,
                    started_at=datetime.now(UTC),
                    completed_at=datetime.now(UTC),
                )
            )
            state.workspace_active_experiment[workspace_id] = experiment_id
            await state.hub.publish(
                topic,
                {
                    "type": "completed",
                    "experiment_id": str(experiment_id),
                    "summary": {
                        "indexed": len(report.indexed),
                        "skipped": len(report.skipped),
                        "failed": len(report.failed),
                    },
                },
            )
        finally:
            runtime.close()

    handle = state.task_queue.enqueue(_job)
    state.task_metadata[handle.id] = TaskMetadata(
        kind="indexing",
        experiment_id=experiment_id,
        workspace_id=workspace_id,
        websocket_topic=topic,
    )
    return {
        "task_id": str(handle.id),
        "experiment_id": str(experiment_id),
        "config_fingerprint": config.fingerprint(),
        "estimated_duration_seconds": max(5, len(documents) * 5),
        "websocket_topic": topic,
        "external_calls": [],
    }
