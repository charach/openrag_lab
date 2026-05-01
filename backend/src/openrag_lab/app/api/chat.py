"""Chat endpoint (API_SPEC §9) — POST /workspaces/{id}/chat.

For MVP we return a synchronous response always (the streaming variant is
P1; clients that pass ``stream=true`` get the same envelope back, just
without an active websocket topic). Retrieval-only mode is honored per
§9.1.1 — when the experiment's ``llm_id`` is ``None`` the response carries
``mode="retrieval_only"`` and ``answer=None``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.runtime import build_runtime
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.ids import (
    ChatTurnId,
    ExperimentId,
    WorkspaceId,
    new_chat_turn_id,
)
from openrag_lab.domain.services.pipeline import RAGPipeline
from openrag_lab.domain.services.retrieval import RetrievalService
from openrag_lab.infra.db.repositories.chat_turn_repo import (
    ChatTurnRecord,
    ChatTurnRepository,
)

router = APIRouter(tags=["chat"])


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    experiment_id: str
    question: str = Field(min_length=1)
    history: list[ChatTurn] = Field(default_factory=list)
    stream: bool = False


@router.post("/workspaces/{workspace_id}/chat")
async def chat(
    workspace_id: str,
    body: ChatBody,
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

    # Look up the experiment via a temporary connection (config_yaml is needed).
    paths = registry.paths_for(ws_id)
    from openrag_lab.infra.db.repositories.experiment_repo import (
        ExperimentRepository,
    )
    from openrag_lab.infra.db.sqlite import connect

    conn = connect(paths.db)
    try:
        repo = ExperimentRepository(conn)
        result = repo.get(ExperimentId(body.experiment_id))
    finally:
        conn.close()

    if result is None or result.workspace_id != ws_id:
        raise HttpError(
            status_code=404,
            code="EXPERIMENT_NOT_FOUND",
            message="실험을 찾을 수 없습니다.",
            recoverable=False,
            details={"experiment_id": body.experiment_id},
        )

    config = result.config

    runtime = build_runtime(
        registry=registry,
        workspace_id=ws_id,
        embedder_id=config.embedder_id,
        factories=state.factories,
    )
    try:
        # Hydrate every chunk persisted at this chunking config.
        cfg_key = config.chunking.cache_key()
        all_chunks = []
        for doc in runtime.document_repo.list_for_workspace(ws_id):
            all_chunks.extend(runtime.chunk_repo.list_for_document(doc.id, cfg_key))

        retrieval = RetrievalService(embedder=runtime.embedder, vector_store=runtime.vector_store)
        retrieval.register_chunks(all_chunks)

        llm = None if config.is_retrieval_only else state.factories.llm(config.llm_id or "")
        pipeline = RAGPipeline(retrieval=retrieval, llm=llm, config=config)
        output = await pipeline.answer(body.question)
    finally:
        runtime.close()

    chunks_payload = [
        {
            "chunk_id": str(hit.chunk.id),
            "document_id": str(hit.chunk.document_id),
            "page": hit.chunk.metadata.page_number,
            "content": hit.chunk.content,
            "score": hit.score,
            "rank": hit.rank,
        }
        for hit in output.retrieval.retrieved
    ]

    turn_id = new_chat_turn_id()
    answer = None if config.is_retrieval_only else output.answer
    tokens = (
        len(output.answer.split()) if (output.answer and not config.is_retrieval_only) else None
    )

    # Persist the turn so the frontend can rebuild history on reload.
    record = ChatTurnRecord(
        id=turn_id,
        workspace_id=ws_id,
        experiment_id=ExperimentId(body.experiment_id),
        question=body.question,
        answer=answer,
        citations=(),
        chunks=tuple(chunks_payload),
        latency_ms=output.retrieval.latency_ms,
        tokens=tokens,
        created_at=datetime.now(UTC),
    )
    with registry.open(ws_id) as conn2:
        ChatTurnRepository(conn2).add(record)

    payload: dict[str, Any] = {
        "turn_id": str(turn_id),
        "retrieval": {
            "latency_ms": output.retrieval.latency_ms,
            "chunks": chunks_payload,
        },
        "external_calls": [],
    }

    if config.is_retrieval_only:
        payload["mode"] = "retrieval_only"
        payload["answer"] = None
        payload["citations"] = None
    else:
        payload["answer"] = answer
        payload["citations"] = []
        payload["tokens_generated"] = tokens or 0
        payload["duration_ms"] = output.retrieval.latency_ms

    return payload


def _serialize_turn(turn: ChatTurnRecord) -> dict[str, Any]:
    return {
        "id": str(turn.id),
        "experiment_id": str(turn.experiment_id),
        "question": turn.question,
        "answer": turn.answer,
        "citations": list(turn.citations),
        "chunks": list(turn.chunks),
        "latency_ms": turn.latency_ms,
        "tokens": turn.tokens,
        "created_at": turn.created_at.isoformat(),
    }


@router.get("/workspaces/{workspace_id}/experiments/{experiment_id}/turns")
async def list_turns(
    workspace_id: str,
    experiment_id: str,
    state: Annotated[AppState, Depends(get_state)],
    cursor: str | None = None,
    limit: int = 50,
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
    exp_id = ExperimentId(experiment_id)
    with registry.open(ws_id) as conn:
        turns = ChatTurnRepository(conn).list_for_experiment(
            exp_id, limit=limit, before=cursor
        )
    next_cursor = turns[-1].created_at.isoformat() if len(turns) == limit else None
    return {
        "items": [_serialize_turn(t) for t in turns],
        "next_cursor": next_cursor,
    }


@router.delete(
    "/workspaces/{workspace_id}/turns/{turn_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_turn(
    workspace_id: str,
    turn_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> None:
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
    t_id = ChatTurnId(turn_id)
    with registry.open(ws_id) as conn:
        repo = ChatTurnRepository(conn)
        existing = repo.get(t_id)
        if existing is None or existing.workspace_id != ws_id:
            raise HttpError(
                status_code=404,
                code="CHAT_TURN_NOT_FOUND",
                message="턴을 찾을 수 없습니다.",
                recoverable=False,
                details={"turn_id": turn_id},
            )
        repo.delete(t_id)
