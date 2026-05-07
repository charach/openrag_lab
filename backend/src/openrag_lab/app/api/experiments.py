"""Experiment endpoints (API_SPEC §11) — list, detail, evaluate, batch."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.external_call_publisher import PublishingLLM
from openrag_lab.app.services.runtime import build_runtime
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState, TaskMetadata
from openrag_lab.app.ws.hub import WebSocketProgressReporter
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import (
    ChunkingStrategy,
    ExperimentStatus,
    RetrievalStrategy,
)
from openrag_lab.domain.models.experiment import (
    EvaluationScores,
    ExperimentConfig,
    ExperimentResult,
    PerformanceProfile,
)
from openrag_lab.domain.models.ids import (
    ExperimentId,
    GoldenSetId,
    WorkspaceId,
    new_batch_id,
    new_experiment_id,
)
from openrag_lab.domain.services.cancellation import CancellationToken, PauseSignal
from openrag_lab.domain.services.evaluation import (
    EvaluationService,
    GoldenPairInput,
)
from openrag_lab.domain.services.indexing import IndexingService
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


@router.delete(
    "/workspaces/{workspace_id}/experiments/{experiment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_experiment(
    workspace_id: str,
    experiment_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> None:
    """Permanently delete an experiment row + its chat turns.

    Cancelling a running experiment is a separate concern (handled by the
    existing tasks API). This endpoint is for the *historical* row in
    the matrix view; it does not stop an in-flight job.
    """
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    with registry.open(ws_id) as conn:
        from openrag_lab.infra.db.repositories.experiment_repo import (
            ExperimentRepository,
        )

        repo = ExperimentRepository(conn)
        existing = repo.get(ExperimentId(experiment_id))
        if existing is None or existing.workspace_id != ws_id:
            raise HttpError(
                status_code=404,
                code="EXPERIMENT_NOT_FOUND",
                message="실험을 찾을 수 없습니다.",
                recoverable=False,
                details={"experiment_id": experiment_id},
            )
        repo.delete(ExperimentId(experiment_id))


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

    async def _job(token: CancellationToken, pause_signal: PauseSignal) -> None:
        del pause_signal  # evaluation has no pause boundary today
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


class _ChunkingPayload(BaseModel):
    strategy: str
    chunk_size: int = Field(ge=32, le=4096)
    chunk_overlap: int = Field(default=0, ge=0)
    extra: dict[str, Any] = Field(default_factory=dict)


class BatchBody(BaseModel):
    """Define-Matrix payload — Cartesian product of embedders × chunkings × retrievals."""

    embedders: list[str] = Field(min_length=1)
    chunkings: list[_ChunkingPayload] = Field(min_length=1)
    retrievals: list[str] = Field(min_length=1)
    # Eval-side: which metrics to compute and which judge to use.
    evaluators: list[str] = Field(
        default_factory=lambda: [
            "faithfulness",
            "answer_relevance",
            "context_precision",
            "context_recall",
        ]
    )
    golden_set_id: str
    # All combos share the same answering LLM and judge for v1. Splitting
    # those into per-combo overrides is a P2 follow-up — too much UI surface
    # for the initial Define-Matrix modal.
    llm_id: str | None = None
    judge_llm_id: str | None = None
    top_k: int = Field(default=5, ge=1, le=50)


def _combo_config(
    *,
    embedder_id: str,
    chunking: _ChunkingPayload,
    retrieval: str,
    body: BatchBody,
) -> ExperimentConfig:
    return ExperimentConfig(
        embedder_id=embedder_id,
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy(chunking.strategy),
            chunk_size=chunking.chunk_size,
            chunk_overlap=chunking.chunk_overlap,
            extra=chunking.extra,
        ),
        retrieval_strategy=RetrievalStrategy(retrieval),
        top_k=body.top_k,
        llm_id=body.llm_id,
        judge_llm_id=body.judge_llm_id,
    )


@router.post(
    "/workspaces/{workspace_id}/experiments/batch",
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_batch(
    workspace_id: str,
    body: BatchBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    """Run a matrix of (embedder × chunking × retrieval) experiments serially.

    Each combo: index → evaluate against ``golden_set_id``. The whole run
    lives in one task (concurrency 1) so checkpoints from a cancel are
    preserved per the same semantics as a single ``/index`` call. Progress
    updates land on ``experiments.batch.{batch_id}`` for the BatchSessionBar.
    """
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)

    try:
        combos = [
            _combo_config(
                embedder_id=e, chunking=c, retrieval=r, body=body
            )
            for e in body.embedders
            for c in body.chunkings
            for r in body.retrievals
        ]
    except ValueError as exc:
        raise HttpError(
            status_code=422,
            code="CONFIG_VALIDATION_FAILED",
            message="설정이 유효하지 않습니다.",
            recoverable=True,
            details={"underlying": str(exc)},
        ) from exc

    # Resolve the golden set once up-front so we fail-fast on a typo.
    with registry.open(ws_id) as conn:
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

    pair_inputs = [
        GoldenPairInput(question=p.question, expected_answer=p.expected_answer) for p in pairs
    ]

    batch_id = new_batch_id()
    topic = f"experiments.batch.{batch_id}"
    total = len(combos)

    async def _job(token: CancellationToken, pause_signal: PauseSignal) -> None:
        await state.hub.publish(
            topic,
            {
                "type": "started",
                "batch_id": str(batch_id),
                "total": total,
                "combos": [
                    {
                        "embedder_id": c.embedder_id,
                        "chunking": {
                            "strategy": c.chunking.strategy.value,
                            "chunk_size": c.chunking.chunk_size,
                            "chunk_overlap": c.chunking.chunk_overlap,
                        },
                        "retrieval_strategy": c.retrieval_strategy.value,
                    }
                    for c in combos
                ],
            },
        )

        results: list[dict[str, Any]] = []
        for i, config in enumerate(combos):
            if token.is_cancelled:
                break

            # ── Index ──────────────────────────────────────────────────
            runtime = build_runtime(
                registry=registry,
                workspace_id=ws_id,
                embedder_id=config.embedder_id,
                factories=state.factories,
            )
            try:
                experiment_id = new_experiment_id()
                runtime.experiment_repo.add_pending(
                    experiment_id=experiment_id,
                    workspace_id=ws_id,
                    config=config,
                    started_at_iso=datetime.now(UTC).isoformat(),
                )
                documents = list(runtime.document_repo.list_for_workspace(ws_id))
                indexing = IndexingService(
                    parsers=runtime.parsers,
                    chunkers=runtime.chunkers,
                    embedder=runtime.embedder,
                    vector_store=runtime.vector_store,
                    chunk_repo=runtime.chunk_repo,  # type: ignore[arg-type]
                    checkpoint_repo=runtime.checkpoint_repo,
                )
                index_topic = f"experiment:{experiment_id}"
                reporter = WebSocketProgressReporter(state.hub)
                report = await indexing.run(
                    workspace_id=ws_id,
                    documents=documents,
                    config=config,
                    chunking=config.chunking,
                    token=token,
                    pause_signal=pause_signal,
                    progress=reporter,
                    topic=index_topic,
                )
                if report.cancelled:
                    break

                # ── Evaluate ──────────────────────────────────────────
                cfg_key = config.chunking.cache_key()
                chunks = []
                for doc in runtime.document_repo.list_for_workspace(ws_id):
                    chunks.extend(runtime.chunk_repo.list_for_document(doc.id, cfg_key))
                retrieval = RetrievalService(
                    embedder=runtime.embedder, vector_store=runtime.vector_store
                )
                retrieval.register_chunks(chunks)
                llm = (
                    None if config.is_retrieval_only else state.factories.llm(config.llm_id or "")
                )
                if llm is not None and not llm.is_local:
                    llm = PublishingLLM(
                        inner=llm,
                        hub=state.hub,
                        scope={"experiment_id": str(experiment_id)},
                    )
                pipeline = RAGPipeline(retrieval=retrieval, llm=llm, config=config)
                judge = state.factories.judge(
                    body.judge_llm_id or config.llm_id or ""
                )
                evaluator = EvaluationService(
                    pipeline=pipeline, judge=judge, config=config
                )
                scores = await evaluator.evaluate(pair_inputs)

                runtime.experiment_repo.save_result(
                    ExperimentResult(
                        experiment_id=experiment_id,
                        workspace_id=ws_id,
                        config=config,
                        scores=scores,
                        profile=PerformanceProfile(),
                        status=ExperimentStatus.COMPLETED,
                        started_at=datetime.now(UTC),
                        completed_at=datetime.now(UTC),
                    )
                )
                state.workspace_active_experiment[workspace_id] = experiment_id

                combo_scores = {
                    "faithfulness": scores.faithfulness,
                    "answer_relevance": scores.answer_relevance,
                    "context_precision": scores.context_precision,
                    "context_recall": scores.context_recall,
                }
                # Strip metrics the caller didn't ask for so the bar's
                # totals tally with the matrix's evaluator selection.
                filtered_scores = {k: v for k, v in combo_scores.items() if k in body.evaluators}
                results.append(
                    {
                        "experiment_id": str(experiment_id),
                        "scores": filtered_scores,
                    }
                )

                await state.hub.publish(
                    topic,
                    {
                        "type": "progress",
                        "batch_id": str(batch_id),
                        "done": i + 1,
                        "total": total,
                        "current_combo": {
                            "index": i,
                            "embedder_id": config.embedder_id,
                            "chunking": {
                                "strategy": config.chunking.strategy.value,
                                "chunk_size": config.chunking.chunk_size,
                                "chunk_overlap": config.chunking.chunk_overlap,
                            },
                            "retrieval_strategy": config.retrieval_strategy.value,
                            "experiment_id": str(experiment_id),
                            "scores": filtered_scores,
                        },
                    },
                )
            finally:
                runtime.close()

        await state.hub.publish(
            topic,
            {
                "type": "completed",
                "batch_id": str(batch_id),
                "results": results,
                "cancelled": token.is_cancelled,
            },
        )

    handle = state.task_queue.enqueue(_job)
    state.task_metadata[handle.id] = TaskMetadata(
        kind="batch",
        experiment_id=None,
        workspace_id=workspace_id,
        websocket_topic=topic,
    )
    return {
        "task_id": str(handle.id),
        "batch_id": str(batch_id),
        "total_evals": total * len(body.evaluators),
        "websocket_topic": topic,
    }
