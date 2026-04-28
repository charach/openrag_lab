"""GoldenSetRepository — set + pair persistence."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from openrag_lab.domain.models.ids import (
    ChunkId,
    new_chunk_id,
    new_golden_pair_id,
    new_golden_set_id,
    new_workspace_id,
)
from openrag_lab.domain.models.workspace import Workspace, WorkspaceMeta
from openrag_lab.infra.db.repositories.golden_set_repo import (
    GoldenPair,
    GoldenSet,
    GoldenSetRepository,
)
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository


def _seed_ws(conn: sqlite3.Connection):  # type: ignore[no-untyped-def]
    ws = Workspace(
        id=new_workspace_id(),
        meta=WorkspaceMeta(name="ws"),
        created_at=datetime.now(UTC),
    )
    WorkspaceRepository(conn).add(ws)
    return ws


def test_add_set_and_pairs_round_trip(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = GoldenSetRepository(conn)
    gs = GoldenSet(id=new_golden_set_id(), workspace_id=ws.id, name="basic")
    repo.add_set(gs)

    expected_chunks = (new_chunk_id(), new_chunk_id())
    pairs = [
        GoldenPair(
            id=new_golden_pair_id(),
            question="What is RAG?",
            expected_answer="Retrieval-Augmented Generation",
            expected_chunk_ids=expected_chunks,
        ),
        GoldenPair(
            id=new_golden_pair_id(),
            question="질문은 한국어",
            expected_answer=None,
            expected_chunk_ids=(),
        ),
    ]
    written = repo.add_pairs(gs.id, pairs)
    assert written == 2

    out = repo.list_pairs(gs.id)
    assert len(out) == 2
    by_q = {p.question: p for p in out}
    assert by_q["What is RAG?"].expected_chunk_ids == expected_chunks
    assert by_q["질문은 한국어"].expected_answer is None


def test_get_set_missing_returns_none(conn: sqlite3.Connection) -> None:
    repo = GoldenSetRepository(conn)
    assert repo.get_set(new_golden_set_id()) is None


def test_list_sets_for_workspace_excludes_other_workspaces(
    conn: sqlite3.Connection,
) -> None:
    ws_a = _seed_ws(conn)
    ws_b = _seed_ws(conn)
    repo = GoldenSetRepository(conn)
    repo.add_set(GoldenSet(id=new_golden_set_id(), workspace_id=ws_a.id, name="a"))
    repo.add_set(GoldenSet(id=new_golden_set_id(), workspace_id=ws_b.id, name="b"))
    out = repo.list_sets_for_workspace(ws_a.id)
    assert {gs.name for gs in out} == {"a"}


def test_delete_set_cascades_to_pairs(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = GoldenSetRepository(conn)
    gs = GoldenSet(id=new_golden_set_id(), workspace_id=ws.id, name="x")
    repo.add_set(gs)
    repo.add_pairs(
        gs.id,
        [
            GoldenPair(
                id=new_golden_pair_id(),
                question="q",
                expected_chunk_ids=(ChunkId("chk_1"),),
            )
        ],
    )
    assert repo.delete_set(gs.id) == 1
    assert repo.list_pairs(gs.id) == []


def test_workspace_delete_cascades_to_golden_sets(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = GoldenSetRepository(conn)
    gs = GoldenSet(id=new_golden_set_id(), workspace_id=ws.id, name="x")
    repo.add_set(gs)
    WorkspaceRepository(conn).delete(ws.id)
    assert repo.get_set(gs.id) is None


def test_empty_add_pairs_is_a_noop(conn: sqlite3.Connection) -> None:
    ws = _seed_ws(conn)
    repo = GoldenSetRepository(conn)
    gs = GoldenSet(id=new_golden_set_id(), workspace_id=ws.id, name="x")
    repo.add_set(gs)
    assert repo.add_pairs(gs.id, []) == 0
