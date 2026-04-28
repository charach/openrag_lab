"""On-disk cache for chunk embeddings.

Cache key is ``chunk_id + embedder.model_id + embedder.model_version``
(ARCHITECTURE_v3.md §8.3). The vector is stored in NumPy's ``.npy``
format — small, deterministic, and we can ``mmap`` it back if needed.

Storage layout::

    <cache_root>/<key[:2]>/<key>.npy        # the vector
    <cache_root>/<key[:2]>/<key>.json       # the metadata sidecar

A miss returns ``None``; the caller then computes the embedding and
writes it back. Vector dtype/dim are validated on read so a partial
write or schema drift becomes a clean miss instead of a crash.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from openrag_lab.domain.models.embedding import Embedding
from openrag_lab.domain.models.ids import ChunkId


def _key(chunk_id: str, model_id: str, model_version: str) -> str:
    raw = f"{chunk_id}|{model_id}|{model_version}".encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def _vec_path(root: Path, key: str) -> Path:
    return root / key[:2] / f"{key}.npy"


def _meta_path(root: Path, key: str) -> Path:
    return root / key[:2] / f"{key}.json"


class EmbeddingCache:
    """Filesystem cache for individual ``Embedding`` records."""

    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    def key_for(self, chunk_id: ChunkId, model_id: str, model_version: str) -> str:
        return _key(str(chunk_id), model_id, model_version)

    def get(
        self,
        chunk_id: ChunkId,
        model_id: str,
        model_version: str,
    ) -> Embedding | None:
        key = _key(str(chunk_id), model_id, model_version)
        vec_path = _vec_path(self._root, key)
        meta_path = _meta_path(self._root, key)
        if not vec_path.is_file() or not meta_path.is_file():
            return None
        try:
            vector = np.load(vec_path, allow_pickle=False)
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        try:
            return Embedding(
                chunk_id=ChunkId(meta["chunk_id"]),
                vector=vector,
                model_id=meta["model_id"],
                model_version=meta["model_version"],
                created_at=datetime.fromisoformat(meta["created_at"]),
            )
        except (KeyError, ValueError, TypeError):
            return None

    def put(self, embedding: Embedding) -> None:
        """Atomic write of vector + sidecar."""
        key = _key(str(embedding.chunk_id), embedding.model_id, embedding.model_version)
        vec_path = _vec_path(self._root, key)
        meta_path = _meta_path(self._root, key)
        vec_path.parent.mkdir(parents=True, exist_ok=True)

        tmp_vec = vec_path.with_suffix(vec_path.suffix + ".tmp")
        # np.save() appends .npy when given a Path/str without .npy suffix —
        # write to a file handle so the on-disk name is exactly tmp_vec.
        with tmp_vec.open("wb") as fh:
            np.save(fh, embedding.vector, allow_pickle=False)
        tmp_vec.replace(vec_path)

        meta = {
            "schema": 1,
            "chunk_id": str(embedding.chunk_id),
            "model_id": embedding.model_id,
            "model_version": embedding.model_version,
            "dim": embedding.dim,
            "created_at": embedding.created_at.isoformat(),
        }
        tmp_meta = meta_path.with_suffix(meta_path.suffix + ".tmp")
        tmp_meta.write_text(json.dumps(meta), encoding="utf-8")
        tmp_meta.replace(meta_path)

    def has(self, chunk_id: ChunkId, model_id: str, model_version: str) -> bool:
        key = _key(str(chunk_id), model_id, model_version)
        return _vec_path(self._root, key).is_file() and _meta_path(self._root, key).is_file()

    def evict(self, chunk_id: ChunkId, model_id: str, model_version: str) -> bool:
        key = _key(str(chunk_id), model_id, model_version)
        deleted = False
        for path in (_vec_path(self._root, key), _meta_path(self._root, key)):
            if path.is_file():
                path.unlink()
                deleted = True
        return deleted


def make_embedding(
    *,
    chunk_id: ChunkId,
    vector: np.ndarray,
    model_id: str,
    model_version: str,
) -> Embedding:
    """Helper used by adapters / tests to build an ``Embedding`` with a now timestamp."""
    return Embedding(
        chunk_id=chunk_id,
        vector=vector,
        model_id=model_id,
        model_version=model_version,
        created_at=datetime.now(UTC),
    )
