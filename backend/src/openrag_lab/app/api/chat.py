"""Chat endpoint (API_SPEC §9) — POST /workspaces/{id}/chat.

For MVP we return a synchronous response always (the streaming variant is
P1; clients that pass ``stream=true`` get the same envelope back, just
without an active websocket topic). Retrieval-only mode is honored per
§9.1.1 — when the experiment's ``llm_id`` is ``None`` the response carries
``mode="retrieval_only"`` and ``answer=None``.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.runtime import build_runtime
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.ids import ExperimentId, WorkspaceId
from openrag_lab.domain.services.pipeline import RAGPipeline
from openrag_lab.domain.services.retrieval import RetrievalService

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

    payload: dict[str, Any] = {
        "turn_id": f"turn_{body.experiment_id[-8:]}",
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
        payload["answer"] = output.answer
        payload["citations"] = []
        payload["tokens_generated"] = len(output.answer.split()) if output.answer else 0
        payload["duration_ms"] = output.retrieval.latency_ms

    return payload
