"""Workspace config import/export (API_SPEC §12)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

import yaml
from fastapi import APIRouter, Depends, Request, Response

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState
from openrag_lab.domain.errors import ConfigurationError
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import ChunkingStrategy, RetrievalStrategy
from openrag_lab.domain.models.experiment import ExperimentConfig
from openrag_lab.domain.models.ids import WorkspaceId
from openrag_lab.domain.models.workspace import WorkspaceMeta
from openrag_lab.infra.db.repositories.experiment_repo import ExperimentRepository
from openrag_lab.infra.db.repositories.workspace_repo import WorkspaceRepository

router = APIRouter(tags=["config"])


def _registry(state: AppState) -> WorkspaceRegistry:
    return WorkspaceRegistry(state.layout)


def _config_to_dict(config: ExperimentConfig) -> dict[str, Any]:
    return {
        "embedder_id": config.embedder_id,
        "chunking": {
            "strategy": config.chunking.strategy.value,
            "chunk_size": config.chunking.chunk_size,
            "chunk_overlap": config.chunking.chunk_overlap,
        },
        "retrieval_strategy": config.retrieval_strategy.value,
        "top_k": config.top_k,
        "reranker_id": config.reranker_id,
        "llm_id": config.llm_id,
        "judge_llm_id": config.judge_llm_id,
    }


def _config_from_dict(payload: dict[str, Any]) -> ExperimentConfig:
    try:
        chunking = payload["chunking"]
        return ExperimentConfig(
            embedder_id=str(payload["embedder_id"]),
            chunking=ChunkingConfig(
                strategy=ChunkingStrategy(chunking["strategy"]),
                chunk_size=int(chunking["chunk_size"]),
                chunk_overlap=int(chunking.get("chunk_overlap", 0)),
                extra=dict(chunking.get("extra") or {}),
            ),
            retrieval_strategy=RetrievalStrategy(payload.get("retrieval_strategy", "dense")),
            top_k=int(payload.get("top_k", 5)),
            reranker_id=payload.get("reranker_id"),
            llm_id=payload.get("llm_id"),
            judge_llm_id=payload.get("judge_llm_id"),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise ConfigurationError(
            "config 블록이 유효하지 않습니다.",
            code="CONFIG_VALIDATION_FAILED",
            details={"underlying": str(exc)},
        ) from exc


def _latest_config(registry: WorkspaceRegistry, ws_id: WorkspaceId) -> ExperimentConfig | None:
    with registry.open(ws_id) as conn:
        results = ExperimentRepository(conn).list_for_workspace(ws_id)
    return results[0].config if results else None


@router.get("/workspaces/{workspace_id}/config/export")
async def export_config(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
    format: str = "yaml",
) -> Response:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    workspace = registry.get(ws_id)
    if workspace is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": workspace_id},
        )
    config = _latest_config(registry, ws_id)
    if config is None:
        raise HttpError(
            status_code=409,
            code="CONFIG_VALIDATION_FAILED",
            message="아직 인덱싱된 실험이 없어 익스포트할 설정이 없습니다.",
            recoverable=False,
            details={"workspace_id": workspace_id},
        )
    payload: dict[str, Any] = {
        "version": "1",
        "workspace": {
            "name": workspace.meta.name,
            "description": workspace.meta.description,
            "tags": list(workspace.meta.tags),
        },
        "config": _config_to_dict(config),
        "meta": {
            "fingerprint": config.fingerprint(),
            "exported_at": datetime.now(UTC).isoformat(),
            "exported_by": "openrag-lab v0.0.1",
        },
    }
    if format == "json":
        import json

        return Response(content=json.dumps(payload), media_type="application/json")
    return Response(
        content=yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        media_type="application/yaml",
    )


@router.post("/workspaces/{workspace_id}/config/import")
async def import_config(
    workspace_id: str,
    request: Request,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    workspace = registry.get(ws_id)
    if workspace is None:
        raise HttpError(
            status_code=404,
            code="WORKSPACE_NOT_FOUND",
            message="워크스페이스를 찾을 수 없습니다.",
            recoverable=False,
            details={"workspace_id": workspace_id},
        )

    body_bytes = await request.body()
    raw = body_bytes.decode("utf-8", errors="replace")
    try:
        if (request.headers.get("content-type") or "").startswith("application/json"):
            import json

            payload = json.loads(raw)
        else:
            payload = yaml.safe_load(raw)
    except (yaml.YAMLError, ValueError) as exc:
        raise HttpError(
            status_code=400,
            code="BAD_REQUEST_FIELD",
            message="YAML/JSON 본문을 파싱할 수 없습니다.",
            recoverable=False,
            details={"underlying": str(exc)},
        ) from exc

    if not isinstance(payload, dict):
        raise HttpError(
            status_code=400,
            code="BAD_REQUEST_FIELD",
            message="설정 본문이 객체가 아닙니다.",
            recoverable=False,
            details={"received_type": type(payload).__name__},
        )

    if str(payload.get("version", "")) != "1":
        raise HttpError(
            status_code=422,
            code="CONFIG_VERSION_TOO_NEW",
            message=f"지원하지 않는 설정 버전입니다: {payload.get('version')!r}",
            recoverable=False,
            details={"version": payload.get("version")},
        )

    workspace_block = payload.get("workspace") or {}
    config_block = payload.get("config") or {}
    meta_block = payload.get("meta") or {}
    if not isinstance(workspace_block, dict) or not isinstance(config_block, dict):
        raise HttpError(
            status_code=422,
            code="CONFIG_VALIDATION_FAILED",
            message="workspace 또는 config 블록이 잘못된 형식입니다.",
            recoverable=False,
            details={},
        )

    # Surface oddly-named keys early — typos often hide behind silent ignores.
    errors: list[dict[str, str]] = []
    _allowed_workspace = {"name", "description", "tags"}
    _allowed_config = {
        "embedder_id",
        "chunking",
        "retrieval_strategy",
        "top_k",
        "reranker_id",
        "llm_id",
        "judge_llm_id",
    }
    for key in workspace_block:
        if key not in _allowed_workspace:
            errors.append(
                {
                    "path": f"workspace.{key}",
                    "code": "UNKNOWN_FIELD",
                    "message": f"알 수 없는 필드: workspace.{key}",
                }
            )
    for key in config_block:
        if key not in _allowed_config:
            errors.append(
                {
                    "path": f"config.{key}",
                    "code": "UNKNOWN_FIELD",
                    "message": f"알 수 없는 필드: config.{key}",
                }
            )
    if errors:
        raise HttpError(
            status_code=422,
            code="CONFIG_VALIDATION_FAILED",
            message="설정 검증 실패",
            recoverable=True,
            details={"errors": errors},
        )

    new_config = _config_from_dict(config_block)
    previous = _latest_config(registry, ws_id)

    warnings: list[str] = []
    exported_from = meta_block.get("exported_from_os") if isinstance(meta_block, dict) else None
    if isinstance(exported_from, str) and exported_from != state.profile.os.name:
        warnings.append(
            f"OPENRAG_VERSION_OS_MISMATCH:exported_from={exported_from},"
            f"current={state.profile.os.name}"
        )

    # Update workspace meta if anything changed.
    name = workspace_block.get("name", workspace.meta.name)
    description = workspace_block.get("description", workspace.meta.description)
    tags = tuple(workspace_block.get("tags") or workspace.meta.tags)
    new_meta = WorkspaceMeta(name=str(name), description=str(description), tags=tags)
    with registry.open(ws_id) as conn:
        WorkspaceRepository(conn).update_meta(ws_id, new_meta)

    embedder_changed = previous is not None and previous.embedder_id != new_config.embedder_id
    embedder_dim_changed = embedder_changed  # dim known only after model load — conservative
    chunking_changed = (
        previous is not None and previous.chunking.cache_key() != new_config.chunking.cache_key()
    )
    requires_reindex = embedder_changed or chunking_changed
    archived = 0
    if embedder_dim_changed:
        with registry.open(ws_id) as conn:
            from openrag_lab.infra.db.repositories.experiment_repo import (
                ExperimentRepository,
            )

            archived = ExperimentRepository(conn).archive_for_workspace(ws_id)

    return {
        "applied": True,
        "config_changed": previous is None or previous.fingerprint() != new_config.fingerprint(),
        "requires_reindex": requires_reindex,
        "embedder_changed": embedder_changed,
        "embedder_dim_changed": embedder_dim_changed,
        "previous_experiments_will_be_archived": archived,
        "fingerprint": new_config.fingerprint(),
        "warnings": warnings,
    }
