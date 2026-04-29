"""Golden-set endpoints (API_SPEC §10)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, UploadFile, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.ids import (
    GoldenSetId,
    WorkspaceId,
    new_golden_pair_id,
    new_golden_set_id,
)
from openrag_lab.domain.services.golden_set import parse_csv
from openrag_lab.infra.db.repositories.golden_set_repo import (
    GoldenPair,
    GoldenSet,
    GoldenSetRepository,
)

router = APIRouter(tags=["golden_sets"])


class CreateGoldenSetBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PairBody(BaseModel):
    question: str = Field(min_length=1)
    expected_answer: str | None = None
    expected_chunk_ids: list[str] = Field(default_factory=list)


class AddPairsBody(BaseModel):
    pairs: list[PairBody] = Field(min_length=1)


def _registry(state: AppState) -> WorkspaceRegistry:
    return WorkspaceRegistry(state.layout)


def _require_workspace(registry: WorkspaceRegistry, workspace_id: WorkspaceId) -> None:
    if registry.get(workspace_id) is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": str(workspace_id)},
        )


def _require_set(repo: GoldenSetRepository, gs_id: GoldenSetId, ws_id: WorkspaceId) -> GoldenSet:
    gs = repo.get_set(gs_id)
    if gs is None or gs.workspace_id != ws_id:
        raise HttpError(
            status_code=404,
            code="GOLDEN_SET_NOT_FOUND",
            message="골든 셋을 찾을 수 없습니다.",
            recoverable=False,
            details={"golden_set_id": str(gs_id)},
        )
    return gs


@router.get("/workspaces/{workspace_id}/golden-sets")
async def list_golden_sets(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    items: list[dict[str, Any]] = []
    with registry.open(ws_id) as conn:
        repo = GoldenSetRepository(conn)
        for gs in repo.list_sets_for_workspace(ws_id):
            pair_count = len(repo.list_pairs(gs.id))
            items.append(
                {
                    "id": str(gs.id),
                    "name": gs.name,
                    "pair_count": pair_count,
                }
            )
    return {"items": items}


@router.post(
    "/workspaces/{workspace_id}/golden-sets",
    status_code=status.HTTP_201_CREATED,
)
async def create_golden_set(
    workspace_id: str,
    body: CreateGoldenSetBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    gs = GoldenSet(id=new_golden_set_id(), workspace_id=ws_id, name=body.name)
    with registry.open(ws_id) as conn:
        GoldenSetRepository(conn).add_set(gs)
    return {"id": str(gs.id), "name": gs.name, "pair_count": 0}


@router.post(
    "/workspaces/{workspace_id}/golden-sets/{gs_id}/pairs",
    status_code=status.HTTP_201_CREATED,
)
async def add_pairs(
    workspace_id: str,
    gs_id: str,
    body: AddPairsBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    set_id = GoldenSetId(gs_id)
    new_ids: list[str] = []
    with registry.open(ws_id) as conn:
        repo = GoldenSetRepository(conn)
        _require_set(repo, set_id, ws_id)
        pairs: list[GoldenPair] = []
        for p in body.pairs:
            pid = new_golden_pair_id()
            pairs.append(
                GoldenPair(
                    id=pid,
                    question=p.question,
                    expected_answer=p.expected_answer,
                    expected_chunk_ids=tuple(p.expected_chunk_ids),  # type: ignore[arg-type]
                )
            )
            new_ids.append(str(pid))
        added = repo.add_pairs(set_id, pairs)
    return {"added": added, "skipped": 0, "ids": new_ids}


@router.post(
    "/workspaces/{workspace_id}/golden-sets/{gs_id}/pairs/import",
    status_code=status.HTTP_201_CREATED,
)
async def import_csv(
    workspace_id: str,
    gs_id: str,
    state: Annotated[AppState, Depends(get_state)],
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    set_id = GoldenSetId(gs_id)
    raw = (await file.read()).decode("utf-8", errors="replace")

    try:
        candidates = parse_csv(raw)
    except ValueError as exc:
        raise HttpError(
            status_code=422,
            code="BAD_REQUEST_FIELD",
            message=f"CSV 형식이 올바르지 않습니다: {exc}",
            recoverable=False,
            details={"underlying": str(exc)},
        ) from exc

    with registry.open(ws_id) as conn:
        repo = GoldenSetRepository(conn)
        _require_set(repo, set_id, ws_id)
        pairs = [
            GoldenPair(
                id=new_golden_pair_id(),
                question=c.question,
                expected_answer=c.expected_answer,
                expected_chunk_ids=(),
            )
            for c in candidates
        ]
        added = repo.add_pairs(set_id, pairs)
    return {"added": added, "skipped": 0, "errors": []}
