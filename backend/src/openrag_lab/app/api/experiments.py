"""Experiment endpoints (API_SPEC §11) — list, detail, evaluate."""

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
from openrag_lab.domain.models.experiment import (
    ExperimentResult,
    PerformanceProfile,
)
from openrag_lab.domain.models.ids import (
    ExperimentId,
    GoldenSetId,
    WorkspaceId,
)
from openrag_lab.domain.services.cancellation import CancellationToken
from openrag_lab.domain.services.evaluation import (
    EvaluationService,
    GoldenPairInput,
)
from openrag_lab.domain.services.pipeline import RAGPipeline
from openrag_lab.domain.services.retrieval import RetrievalService
from openrag_lab.infra.db.repositories.golden_set_repo import GoldenSetRepository

router = APIRouter(tags=["experiments"])


class EvaluateBody(BaseModel):
    golden_set_id: str
    metrics: list[str] = Field(
        default_factory=lambda: [
            "faithfulness",
            "answer_relevance",
            "context_precision",
            "context_recall",
        ]
    )
    judge_llm_id: str | None = None


def _registry(state: AppState) -> WorkspaceRegistry:
    return WorkspaceRegistry(state.layout)


def _require_workspace(registry: WorkspaceRegistry, ws_id: WorkspaceId) -> None:
    if registry.get(ws_id) is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": str(ws_id)},
        )


def _serialize_summary(result: ExperimentResult) -> dict[str, Any]:
    return {
        "id": str(result.experiment_id),
        "config_fingerprint": result.config.fingerprint(),
        "status": result.status.value,
        "started_at": result.started_at.isoformat(),
        "completed_at": result.completed_at.isoformat() if result.completed_at else None,
        "scores": {
            "faithfulness": result.scores.faithfulness,
            "answer_relevance": result.scores.answer_relevance,
            "context_precision": result.scores.context_precision,
            "context_recall": result.scores.context_recall,
        },
    }


def _serialize_detail(result: ExperimentResult) -> dict[str, Any]:
    payload = _serialize_summary(result)
    payload["config"] = {
        "embedder_id": result.config.embedder_id,
        "chunking": {
            "strategy": result.config.chunking.strategy.value,
            "chunk_size": result.config.chunking.chunk_size,
            "chunk_overlap": result.config.chunking.chunk_overlap,
        },
        "retrieval_strategy": result.config.retrieval_strategy.value,
        "top_k": result.config.top_k,
        "llm_id": result.config.llm_id,
    }
    payload["profile"] = {
        "total_latency_ms": result.profile.total_latency_ms,
        "stages": {s.stage: s.latency_ms for s in result.profile.stages},
    }
    payload["pair_results"] = []
    return payload


@router.get("/workspaces/{workspace_id}/experiments")
async def list_experiments(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    with registry.open(ws_id) as conn:
        from openrag_lab.infra.db.repositories.experiment_repo import (
            ExperimentRepository,
        )

        results = ExperimentRepository(conn).list_for_workspace(ws_id)
    return {
        "items": [_serialize_summary(r) for r in results],
        "next_cursor": None,
    }


@router.get("/workspaces/{workspace_id}/experiments/{experiment_id}")
async def get_experiment(
    workspace_id: str,
    experiment_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    with registry.open(ws_id) as conn:
        from openrag_lab.infra.db.repositories.experiment_repo import (
            ExperimentRepository,
        )

        result = ExperimentRepository(conn).get(ExperimentId(experiment_id))
    if result is None or result.workspace_id != ws_id:
        raise HttpError(
            status_code=404,
            code="EXPERIMENT_NOT_FOUND",
            message="실험을 찾을 수 없습니다.",
            recoverable=False,
            details={"experiment_id": experiment_id},
        )
    return _serialize_detail(result)


@router.post(
    "/workspaces/{workspace_id}/experiments/{experiment_id}/evaluate",
    status_code=status.HTTP_202_ACCEPTED,
)
async def evaluate_experiment(
    workspace_id: str,
    experiment_id: str,
    body: EvaluateBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    exp_id = ExperimentId(experiment_id)

    # Load experiment + pairs eagerly so the async job has a stable input.
    with registry.open(ws_id) as conn:
        from openrag_lab.infra.db.repositories.experiment_repo import (
            ExperimentRepository,
        )

        result = ExperimentRepository(conn).get(exp_id)
        if result is None or result.workspace_id != ws_id:
            raise HttpError(
                status_code=404,
                code="EXPERIMENT_NOT_FOUND",
                message="실험을 찾을 수 없습니다.",
                recoverable=False,
                details={"experiment_id": experiment_id},
            )
        gs_repo = GoldenSetRepository(conn)
        gs_id = GoldenSetId(body.golden_set_id)
        gs = gs_repo.get_set(gs_id)
        if gs is None or gs.workspace_id != ws_id:
            raise HttpError(
                status_code=404,
                code="GOLDEN_SET_NOT_FOUND",
                message="골든 셋을 찾을 수 없습니다.",
                recoverable=False,
                details={"golden_set_id": body.golden_set_id},
            )
        pairs = gs_repo.list_pairs(gs_id)

    config = result.config
    pair_inputs = [
        GoldenPairInput(question=p.question, expected_answer=p.expected_answer) for p in pairs
    ]
    topic = f"evaluation:{experiment_id}"

    async def _job(token: CancellationToken) -> None:
        runtime = build_runtime(
            registry=registry,
            workspace_id=ws_id,
            embedder_id=config.embedder_id,
            factories=state.factories,
        )
        try:
            await state.hub.publish(topic, {"type": "started", "total_pairs": len(pair_inputs)})
            cfg_key = config.chunking.cache_key()
            chunks = []
            for doc in runtime.document_repo.list_for_workspace(ws_id):
                chunks.extend(runtime.chunk_repo.list_for_document(doc.id, cfg_key))
            retrieval = RetrievalService(
                embedder=runtime.embedder, vector_store=runtime.vector_store
            )
            retrieval.register_chunks(chunks)
            llm = None if config.is_retrieval_only else state.factories.llm(config.llm_id or "")
            pipeline = RAGPipeline(retrieval=retrieval, llm=llm, config=config)
            judge = state.factories.judge(body.judge_llm_id or config.llm_id or "")
            evaluator = EvaluationService(pipeline=pipeline, judge=judge, config=config)
            scores = await evaluator.evaluate(pair_inputs)
            token.raise_if_cancelled(stage="evaluation")

            updated = ExperimentResult(
                experiment_id=result.experiment_id,
                workspace_id=ws_id,
                config=config,
                scores=scores,
                profile=PerformanceProfile(),
                status=result.status,
                started_at=result.started_at,
                completed_at=datetime.now(UTC),
            )
            runtime.experiment_repo.save_result(updated)

            await state.hub.publish(
                topic,
                {
                    "type": "completed",
                    "experiment_id": str(exp_id),
                    "aggregate": {
                        "faithfulness": scores.faithfulness,
                        "answer_relevance": scores.answer_relevance,
                        "context_precision": scores.context_precision,
                        "context_recall": scores.context_recall,
                    },
                },
            )
        finally:
            runtime.close()

    handle = state.task_queue.enqueue(_job)
    state.task_metadata[handle.id] = TaskMetadata(
        kind="evaluation",
        experiment_id=exp_id,
        workspace_id=workspace_id,
        websocket_topic=topic,
    )
    return {
        "task_id": str(handle.id),
        "websocket_topic": topic,
        "estimated_duration_seconds": max(5, len(pair_inputs) * 3),
        "external_calls": [],
    }
