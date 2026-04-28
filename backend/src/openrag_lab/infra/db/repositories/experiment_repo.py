"""Experiment repository — config + result storage."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

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
    StageProfile,
)
from openrag_lab.domain.models.ids import ExperimentId, WorkspaceId
from openrag_lab.infra.db.repositories._common import from_iso, to_iso


class ExperimentRepository:
    """SQLite-backed experiment store."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def add_pending(
        self,
        experiment_id: ExperimentId,
        workspace_id: WorkspaceId,
        config: ExperimentConfig,
        started_at_iso: str,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO experiment (
                id, workspace_id, config_fingerprint, config_yaml,
                status, started_at, completed_at, scores_json,
                profile_json, archived
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)
            """,
            (
                str(experiment_id),
                str(workspace_id),
                config.fingerprint(),
                json.dumps(_config_to_dict(config)),
                ExperimentStatus.PENDING.value,
                started_at_iso,
            ),
        )
        self._conn.commit()

    def save_result(self, result: ExperimentResult) -> None:
        self._conn.execute(
            """
            UPDATE experiment
               SET status = ?,
                   completed_at = ?,
                   scores_json = ?,
                   profile_json = ?,
                   archived = ?
             WHERE id = ?
            """,
            (
                result.status.value,
                to_iso(result.completed_at) if result.completed_at else None,
                json.dumps(_scores_to_dict(result.scores)),
                json.dumps(_profile_to_dict(result.profile)),
                1 if result.archived else 0,
                str(result.experiment_id),
            ),
        )
        self._conn.commit()

    def get(self, experiment_id: ExperimentId) -> ExperimentResult | None:
        row = self._conn.execute(
            """
            SELECT id, workspace_id, config_fingerprint, config_yaml,
                   status, started_at, completed_at, scores_json,
                   profile_json, archived
              FROM experiment WHERE id = ?
            """,
            (str(experiment_id),),
        ).fetchone()
        return _row_to_result(row) if row else None

    def list_for_workspace(
        self,
        workspace_id: WorkspaceId,
        *,
        include_archived: bool = False,
    ) -> list[ExperimentResult]:
        if include_archived:
            rows = self._conn.execute(
                "SELECT * FROM experiment WHERE workspace_id = ? ORDER BY started_at DESC",
                (str(workspace_id),),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM experiment WHERE workspace_id = ? AND archived = 0 "
                "ORDER BY started_at DESC",
                (str(workspace_id),),
            ).fetchall()
        return [_row_to_result(r) for r in rows]

    def archive_for_workspace(self, workspace_id: WorkspaceId) -> int:
        cur = self._conn.execute(
            "UPDATE experiment SET archived = 1 WHERE workspace_id = ?",
            (str(workspace_id),),
        )
        self._conn.commit()
        return cur.rowcount

    def find_by_fingerprint(
        self, workspace_id: WorkspaceId, fingerprint: str
    ) -> ExperimentResult | None:
        row = self._conn.execute(
            "SELECT * FROM experiment "
            "WHERE workspace_id = ? AND config_fingerprint = ? "
            "ORDER BY started_at DESC LIMIT 1",
            (str(workspace_id), fingerprint),
        ).fetchone()
        return _row_to_result(row) if row else None


def _config_to_dict(config: ExperimentConfig) -> dict[str, object]:
    return {
        "embedder_id": config.embedder_id,
        "chunking": {
            "strategy": config.chunking.strategy.value,
            "chunk_size": config.chunking.chunk_size,
            "chunk_overlap": config.chunking.chunk_overlap,
            "extra": config.chunking.extra,
        },
        "retrieval_strategy": config.retrieval_strategy.value,
        "top_k": config.top_k,
        "reranker_id": config.reranker_id,
        "llm_id": config.llm_id,
        "judge_llm_id": config.judge_llm_id,
    }


def _dict_to_config(payload: dict[str, Any]) -> ExperimentConfig:
    chunking = payload["chunking"]
    return ExperimentConfig(
        embedder_id=str(payload["embedder_id"]),
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy(chunking["strategy"]),
            chunk_size=int(chunking["chunk_size"]),
            chunk_overlap=int(chunking["chunk_overlap"]),
            extra=chunking.get("extra", {}) or {},
        ),
        retrieval_strategy=RetrievalStrategy(payload["retrieval_strategy"]),
        top_k=int(payload["top_k"]),
        reranker_id=payload.get("reranker_id"),
        llm_id=payload.get("llm_id"),
        judge_llm_id=payload.get("judge_llm_id"),
    )


def _scores_to_dict(scores: EvaluationScores) -> dict[str, float | None]:
    return {
        "faithfulness": scores.faithfulness,
        "answer_relevance": scores.answer_relevance,
        "context_precision": scores.context_precision,
        "context_recall": scores.context_recall,
    }


def _dict_to_scores(payload: dict[str, Any] | None) -> EvaluationScores:
    payload = payload or {}
    return EvaluationScores(
        faithfulness=payload.get("faithfulness"),
        answer_relevance=payload.get("answer_relevance"),
        context_precision=payload.get("context_precision"),
        context_recall=payload.get("context_recall"),
    )


def _profile_to_dict(profile: PerformanceProfile) -> dict[str, object]:
    return {
        "stages": [
            {
                "stage": s.stage,
                "latency_ms": s.latency_ms,
                "peak_memory_mb": s.peak_memory_mb,
            }
            for s in profile.stages
        ],
    }


def _dict_to_profile(payload: dict[str, Any] | None) -> PerformanceProfile:
    if not payload:
        return PerformanceProfile()
    raw_stages = payload.get("stages") or []
    stages = [
        StageProfile(
            stage=str(s["stage"]),
            latency_ms=int(s["latency_ms"]),
            peak_memory_mb=s.get("peak_memory_mb"),
        )
        for s in raw_stages
    ]
    return PerformanceProfile(stages=tuple(stages))


def _row_to_result(row: sqlite3.Row) -> ExperimentResult:
    config = _dict_to_config(json.loads(row["config_yaml"]))
    scores = _dict_to_scores(json.loads(row["scores_json"]) if row["scores_json"] else None)
    profile = _dict_to_profile(json.loads(row["profile_json"]) if row["profile_json"] else None)
    return ExperimentResult(
        experiment_id=ExperimentId(row["id"]),
        workspace_id=WorkspaceId(row["workspace_id"]),
        config=config,
        scores=scores,
        profile=profile,
        status=ExperimentStatus(row["status"]),
        started_at=from_iso(row["started_at"]),
        completed_at=from_iso(row["completed_at"]) if row["completed_at"] else None,
        archived=bool(row["archived"]),
    )
