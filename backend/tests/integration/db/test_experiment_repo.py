"""ExperimentRepository — config + result round-trip, archive, fingerprint lookup."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

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
from openrag_lab.domain.models.ids import new_experiment_id, new_workspace_id
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories._common import to_iso
from openrag_lab.infra.db.repositories.experiment_repo import ExperimentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _seed_ws(conn: sqlite3.Connection):  # type: ignore[no-untyped-def]
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ws"),
        created_at=datetime.now(UTC),
    )
    WorkspaceRepository(conn).add(ws)
    return ws


def _make_config(top_k: int = 5, llm_id: str | None = None) -> ExperimentConfig:
    return ExperimentConfig(
        embedder_id="bge-m3",
        chunking=ChunkingConfig(strategy=ChunkingStrategy.FIXED, chunk_size=64, chunk_overlap=8),
        retrieval_strategy=RetrievalStrategy.DENSE,
        top_k=top_k,
        llm_id=llm_id,
    )


def test_add_pending_then_save_result_round_trips(
    conn: sqlite3.Connection,
) -> None:
    ws = _seed_ws(conn)
    repo = ExperimentRepository(conn)
    exp_id = new_experiment_id()
    config = _make_config(llm_id="llama-3-8b")
    started = datetime.now(UTC)
    repo.add_pending(exp_id, ws.id, config, to_iso(started))

    completed = datetime.now(UTC)
    result = ExperimentResult(
        experiment_id=exp_id,
        workspace_id=ws.id,
        config=config,
        scores=EvaluationScores(
            faithfulness=0.9, answer_relevance=0.85, context_precision=0.7, context_recall=0.6
        ),
        profile=PerformanceProfile(
            stages=(
                StageProfile(stage="parse", latency_ms=120),
                StageProfile(stage="retrieval", latency_ms=45, peak_memory_mb=512.0),
            )
        ),
        status=ExperimentStatus.COMPLETED,
        started_at=started,
        completed_at=completed,
    )
    repo.save_result(result)

    out = repo.get(exp_id)
    assert out is not None
    assert out.config.fingerprint() == config.fingerprint()
    assert out.scores.faithfulness == 0.9
    assert out.profile.total_latency_ms == 165
    assert out.status is ExperimentStatus.COMPLETED


def test_retrieval_only_config_preserves_none_llm_id(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = ExperimentRepository(conn)
    exp_id = new_experiment_id()
    config = _make_config(llm_id=None)
    repo.add_pending(exp_id, ws.id, config, to_iso(datetime.now(UTC)))
    out = repo.get(exp_id)
    assert out is not None
    assert out.config.is_retrieval_only is True
    assert out.config.llm_id is None


def test_find_by_fingerprint_returns_latest(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = ExperimentRepository(conn)
    config = _make_config()
    repo.add_pending(new_experiment_id(), ws.id, config, "2026-01-01T00:00:00+00:00")
    repo.add_pending(new_experiment_id(), ws.id, config, "2026-02-01T00:00:00+00:00")
    out = repo.find_by_fingerprint(ws.id, config.fingerprint())
    assert out is not None
    assert out.started_at.isoformat() == "2026-02-01T00:00:00+00:00"


def test_archive_for_workspace_filters_default_listing(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = ExperimentRepository(conn)
    repo.add_pending(new_experiment_id(), ws.id, _make_config(), to_iso(datetime.now(UTC)))
    repo.add_pending(new_experiment_id(), ws.id, _make_config(top_k=10), to_iso(datetime.now(UTC)))
    repo.archive_for_workspace(ws.id)
    assert repo.list_for_workspace(ws.id) == []
    archived = repo.list_for_workspace(ws.id, include_archived=True)
    assert len(archived) == 2
    assert all(r.archived for r in archived)


def test_get_missing_returns_none(conn: sqlite3.Connection) -> None:
    repo = ExperimentRepository(conn)
    assert repo.get(new_experiment_id()) is None
