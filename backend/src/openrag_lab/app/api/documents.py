"""Document upload + list + delete + chunking preview (API_SPEC §6, §7)."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, UploadFile, status
from pydantic import BaseModel, Field

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.services.adapters_factory import (
    chunker_for,
    detect_format,
    parser_for,
)
from openrag_lab.app.services.workspace_registry import WorkspaceRegistry
from openrag_lab.app.state import AppState
from openrag_lab.domain.errors import OpenRagError, ParseError
from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import ChunkingStrategy
from openrag_lab.domain.models.ids import DocumentId, WorkspaceId, new_document_id
from openrag_lab.infra.db.repositories.document_repo import DocumentRepository
from openrag_lab.infra.fs.workspace_layout import is_inside

router = APIRouter(tags=["documents"])

_HASH_CHUNK = 1 << 20  # 1 MiB streaming hash chunks


def _safe_filename(raw: str) -> str:
    """Strip directory components and reject empty/dotfile-only names.

    Defends against ``../../etc/passwd``-style traversal that the upload
    handler would otherwise honor when joining the workspace documents
    dir with ``UploadFile.filename`` (PLATFORM.md §2.4).
    """
    # ``Path.name`` discards everything before the final separator on
    # POSIX. On Windows we additionally have to handle backslashes.
    name = Path(raw.replace("\\", "/")).name
    if not name or name in {".", ".."}:
        raise ParseError(
            "파일명이 올바르지 않습니다.",
            code="PATH_OUTSIDE_WORKSPACE",
            recoverable=False,
            details={"filename": raw},
        )
    return name


class ChunkingPreviewBody(BaseModel):
    document_id: str | None = None
    config: dict[str, Any]
    max_chunks: int = Field(default=50, ge=1, le=2000)


class RenameDocumentBody(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


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


async def _save_and_hash(target: Path, source: UploadFile) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0

    def _write_sync() -> None:
        nonlocal size
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("wb") as out:
            while True:
                chunk = source.file.read(_HASH_CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                digest.update(chunk)
                size += len(chunk)

    await asyncio.to_thread(_write_sync)
    return size, digest.hexdigest()


def _serialize_document(
    doc: Document, *, indexing_status: str, chunk_count: int = 0
) -> dict[str, Any]:
    return {
        "id": str(doc.id),
        "filename": doc.source_path.name,
        "format": doc.format.value,
        "size_bytes": doc.size_bytes,
        "content_hash": f"sha256:{doc.content_hash}",
        "added_at": doc.added_at.isoformat(),
        "indexing_status": indexing_status,
        "chunk_count": chunk_count,
    }


@router.get("/workspaces/{workspace_id}/documents")
async def list_documents(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    items: list[dict[str, Any]] = []
    with registry.open(ws_id) as conn:
        repo = DocumentRepository(conn)
        for doc in repo.list_for_workspace(ws_id):
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM chunk WHERE document_id = ?",
                (str(doc.id),),
            ).fetchone()
            total = int(row["n"]) if row else 0
            status_str = "indexed" if total > 0 else "not_indexed"
            items.append(
                _serialize_document(doc, indexing_status=status_str, chunk_count=total)
            )
    return {"items": items, "next_cursor": None}


@router.post(
    "/workspaces/{workspace_id}/documents",
    status_code=status.HTTP_201_CREATED,
)
async def upload_documents(
    workspace_id: str,
    state: Annotated[AppState, Depends(get_state)],
    files: Annotated[list[UploadFile], File()],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    paths = registry.paths_for(ws_id)
    paths.ensure()

    uploaded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    with registry.open(ws_id) as conn:
        repo = DocumentRepository(conn)
        for upload in files:
            raw_filename = upload.filename or "untitled"
            try:
                filename = _safe_filename(raw_filename)
                fmt = detect_format(filename)
            except ParseError as exc:
                failed.append(
                    {
                        "filename": raw_filename,
                        "error": {
                            "code": exc.code,
                            "message": exc.user_message,
                            "recoverable": exc.recoverable,
                        },
                    }
                )
                continue

            target = paths.documents_dir / filename
            # Belt-and-suspenders: even after the basename strip, refuse
            # to write outside ``documents_dir`` (catches symlink + odd
            # filesystem cases that ``Path.name`` alone wouldn't).
            documents_root = paths.documents_dir.resolve()
            documents_root.mkdir(parents=True, exist_ok=True)
            if not is_inside(documents_root, target):
                failed.append(
                    {
                        "filename": raw_filename,
                        "error": {
                            "code": "PATH_OUTSIDE_WORKSPACE",
                            "message": "파일명이 워크스페이스 디렉토리를 벗어납니다.",
                            "recoverable": False,
                        },
                    }
                )
                continue

            try:
                size_bytes, sha = await _save_and_hash(target, upload)
            except OSError as exc:
                failed.append(
                    {
                        "filename": filename,
                        "error": {
                            "code": "PARSE_CORRUPTED_FILE",
                            "message": "파일을 저장할 수 없습니다.",
                            "recoverable": False,
                            "details": {"underlying": str(exc)},
                        },
                    }
                )
                continue

            existing = repo.get_by_hash(ws_id, sha)
            if existing is not None:
                # Drop the duplicate we just wrote — the existing copy stays.
                if target.exists() and target.resolve() != existing.source_path.resolve():
                    target.unlink(missing_ok=True)
                skipped.append(
                    {
                        "filename": filename,
                        "reason": "DUPLICATE_CONTENT_HASH",
                        "existing_id": str(existing.id),
                    }
                )
                continue

            doc = Document(
                id=new_document_id(),
                workspace_id=ws_id,
                source_path=target,
                content_hash=sha,
                format=fmt,
                size_bytes=size_bytes,
                added_at=datetime.now(UTC),
            )
            try:
                repo.add(doc)
            except Exception as exc:
                # Roll back the saved file to keep state consistent.
                target.unlink(missing_ok=True)
                failed.append(
                    {
                        "filename": filename,
                        "error": {
                            "code": "INTERNAL_ERROR",
                            "message": "문서 등록에 실패했습니다.",
                            "recoverable": False,
                            "details": {"underlying": str(exc)},
                        },
                    }
                )
                continue
            uploaded.append(_serialize_document(doc, indexing_status="not_indexed"))

    return {"uploaded": uploaded, "skipped": skipped, "failed": failed}


@router.patch("/workspaces/{workspace_id}/documents/{document_id}")
async def rename_document(
    workspace_id: str,
    document_id: str,
    body: RenameDocumentBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    doc_id = DocumentId(document_id)

    try:
        new_name = _safe_filename(body.filename)
    except ParseError as exc:
        raise HttpError(
            status_code=400,
            code=exc.code,
            message=exc.user_message,
            recoverable=exc.recoverable,
            details=exc.details,
        ) from exc

    paths = registry.paths_for(ws_id)
    documents_root = paths.documents_dir.resolve()
    new_path = paths.documents_dir / new_name
    if not is_inside(documents_root, new_path):
        raise HttpError(
            status_code=400,
            code="PATH_OUTSIDE_WORKSPACE",
            message="파일명이 워크스페이스 디렉토리를 벗어납니다.",
            recoverable=False,
            details={"filename": body.filename},
        )

    with registry.open(ws_id) as conn:
        repo = DocumentRepository(conn)
        doc = repo.get(doc_id)
        if doc is None or doc.workspace_id != ws_id:
            raise HttpError(
                status_code=404,
                code="DOCUMENT_NOT_FOUND",
                message="문서를 찾을 수 없습니다.",
                recoverable=False,
                details={"document_id": document_id},
            )
        if new_path.exists() and new_path.resolve() != doc.source_path.resolve():
            raise HttpError(
                status_code=409,
                code="DOCUMENT_FILENAME_CONFLICT",
                message="동일한 이름의 파일이 이미 존재합니다.",
                recoverable=True,
                details={"filename": new_name},
            )
        try:
            if doc.source_path.exists():
                doc.source_path.rename(new_path)
        except OSError as exc:
            raise HttpError(
                status_code=500,
                code="INTERNAL_ERROR",
                message="파일 이름을 변경할 수 없습니다.",
                recoverable=False,
                details={"underlying": str(exc)},
            ) from exc
        repo.update_path(doc_id, new_path)
        renamed = repo.get(doc_id)
        assert renamed is not None
        chunk_count_row = conn.execute(
            "SELECT COUNT(*) AS n FROM chunk WHERE document_id = ?",
            (str(doc_id),),
        ).fetchone()
        total = int(chunk_count_row["n"]) if chunk_count_row else 0
    return _serialize_document(
        renamed,
        indexing_status="indexed" if total > 0 else "not_indexed",
    )


@router.delete(
    "/workspaces/{workspace_id}/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_document(
    workspace_id: str,
    document_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> None:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)
    doc_id = DocumentId(document_id)
    with registry.open(ws_id) as conn:
        repo = DocumentRepository(conn)
        doc = repo.get(doc_id)
        if doc is None or doc.workspace_id != ws_id:
            raise HttpError(
                status_code=404,
                code="DOCUMENT_NOT_FOUND",
                message="문서를 찾을 수 없습니다.",
                recoverable=False,
                details={"document_id": document_id},
            )
        repo.delete(doc_id)
    # Best-effort source file cleanup.
    try:
        if doc.source_path.exists():
            doc.source_path.unlink()
    except OSError:
        pass


@router.post("/workspaces/{workspace_id}/chunking/preview")
async def chunking_preview(
    workspace_id: str,
    body: ChunkingPreviewBody,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    registry = _registry(state)
    ws_id = WorkspaceId(workspace_id)
    _require_workspace(registry, ws_id)

    try:
        strategy = ChunkingStrategy(body.config["strategy"])
        chunk_size = int(body.config["chunk_size"])
        chunk_overlap = int(body.config.get("chunk_overlap", 0))
        extra = dict(body.config.get("extra") or {})
    except (KeyError, ValueError, TypeError) as exc:
        raise HttpError(
            status_code=400,
            code="BAD_REQUEST_FIELD",
            message="청킹 설정이 올바르지 않습니다.",
            recoverable=True,
            details={"field": "config", "underlying": str(exc)},
        ) from exc

    try:
        chunking_config = ChunkingConfig(
            strategy=strategy,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            extra=extra,
        )
    except Exception as exc:  # pydantic.ValidationError
        raise HttpError(
            status_code=422,
            code="CONFIG_VALIDATION_FAILED",
            message="청킹 설정 값이 허용 범위를 벗어났습니다.",
            recoverable=True,
            details={"underlying": str(exc)},
        ) from exc

    chunker = chunker_for(strategy)

    with registry.open(ws_id) as conn:
        repo = DocumentRepository(conn)
        if body.document_id is not None:
            doc = repo.get(DocumentId(body.document_id))
            if doc is None or doc.workspace_id != ws_id:
                raise HttpError(
                    status_code=404,
                    code="DOCUMENT_NOT_FOUND",
                    message="문서를 찾을 수 없습니다.",
                    recoverable=False,
                    details={"document_id": body.document_id},
                )
        else:
            docs = repo.list_for_workspace(ws_id)
            if not docs:
                raise HttpError(
                    status_code=404,
                    code="DOCUMENT_NOT_FOUND",
                    message="워크스페이스에 문서가 없습니다.",
                    recoverable=False,
                    details={"workspace_id": str(ws_id)},
                )
            doc = docs[0]

    parser = parser_for(doc.format)
    try:
        parsed = await parser.parse(doc)
    except OpenRagError:
        raise
    full_text = "\n\n".join(p.text for p in parsed.pages)

    previews = await chunker.preview(full_text, chunking_config, max_chunks=body.max_chunks)

    chunks_payload: list[dict[str, Any]] = []
    for p in previews:
        chunks_payload.append(
            {
                "sequence": p.sequence,
                "content": p.content,
                "char_offset": p.char_offset,
                "char_length": p.char_length,
                "color_hint": _color_hint(p.sequence),
            }
        )

    document_total_chars = len(full_text)
    if previews:
        token_lengths = [len(p.content) for p in previews]
        avg = sum(token_lengths) / len(token_lengths)
        # The chunker is capped at ``max_chunks`` so ``len(previews)`` is
        # only the full count when it stops short on its own. Otherwise
        # extrapolate from how much of the document the sample covered —
        # the slider UI shows this with a ``≈`` prefix to signal that
        # it's an estimate, not a measurement.
        last = previews[-1]
        consumed_chars = last.char_offset + last.char_length
        sample_exhausted_doc = len(previews) < body.max_chunks
        if sample_exhausted_doc or consumed_chars >= document_total_chars:
            total_chunks_estimated = len(previews)
        else:
            total_chunks_estimated = max(
                len(previews),
                round(len(previews) * document_total_chars / max(1, consumed_chars)),
            )
        stats = {
            "total_chunks_estimated": total_chunks_estimated,
            "total_chunks_is_estimate": not sample_exhausted_doc,
            "avg_token_count": round(avg, 1),
            "min_token_count": min(token_lengths),
            "max_token_count": max(token_lengths),
            "document_total_chars": document_total_chars,
        }
    else:
        stats = {
            "total_chunks_estimated": 0,
            "total_chunks_is_estimate": False,
            "avg_token_count": 0,
            "min_token_count": 0,
            "max_token_count": 0,
            "document_total_chars": document_total_chars,
        }

    return {
        "config_key": chunking_config.cache_key(),
        "chunks": chunks_payload,
        "stats": stats,
    }


_GOLDEN_RATIO = 0.61803398875


def _color_hint(sequence: int) -> str:
    """Deterministic HSL hue per chunk sequence (API_SPEC §7.1 note)."""
    hue = int((sequence * _GOLDEN_RATIO * 360) % 360)
    return f"hsl({hue}, 65%, 80%)"
