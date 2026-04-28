"""sentence-transformers embedder.

Wraps a HuggingFace ``SentenceTransformer`` model. Backend selection
follows PLATFORM.md §3.3 — the constructor consults a ``SystemProfile``
and picks the highest-priority backend that PyTorch reports as
available.

We never download a model implicitly: the caller passes ``model_id`` and
the model must already be cached locally (or a real network policy must
be in effect at the application layer).
"""

from __future__ import annotations

import asyncio

import numpy as np

from openrag_lab.domain.errors import ModelNotLoadedError
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.models.hardware import SystemProfile
from openrag_lab.domain.ports.embedder import ProgressCallback

try:  # heavy deps
    import torch
    from sentence_transformers import SentenceTransformer

    _HAS_ST = True
except ImportError:  # pragma: no cover
    _HAS_ST = False


_BACKEND_TO_TORCH_DEVICE = {
    AccelBackend.CUDA: "cuda",
    AccelBackend.METAL: "mps",
    AccelBackend.CPU: "cpu",
}


def _select_torch_device(profile: SystemProfile | None) -> tuple[str, AccelBackend]:
    """Pick a torch device string + the AccelBackend label for the result."""
    if not _HAS_ST:
        return ("cpu", AccelBackend.CPU)
    candidates: list[AccelBackend]
    if profile is None:
        candidates = []
    else:
        candidates = list(profile.available_backends)
    # Priority: CUDA > METAL > CPU.
    for cand in (AccelBackend.CUDA, AccelBackend.METAL):
        if cand in candidates and _torch_supports(cand):
            return (_BACKEND_TO_TORCH_DEVICE[cand], cand)
    return ("cpu", AccelBackend.CPU)


def _torch_supports(backend: AccelBackend) -> bool:
    if not _HAS_ST:
        return False
    if backend is AccelBackend.CUDA:
        return bool(torch.cuda.is_available())
    if backend is AccelBackend.METAL:
        return bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    return True


class SentenceTransformerEmbedder:
    """Adapter for ``sentence-transformers`` models."""

    def __init__(
        self,
        model_id: str,
        *,
        profile: SystemProfile | None = None,
        model_version: str = "unknown",
    ) -> None:
        if not _HAS_ST:
            raise ModelNotLoadedError(
                "sentence-transformers / torch is not installed.",
                code="MODEL_NOT_LOADED",
                recoverable=False,
            )
        self._model_id = model_id
        self._model_version = model_version
        device, backend = _select_torch_device(profile)
        try:
            self._model = SentenceTransformer(model_id, device=device)
        except Exception as e:
            raise ModelNotLoadedError(
                f"Failed to load embedder '{model_id}' on {device}: {e}",
                code="MODEL_NOT_LOADED",
                recoverable=False,
                details={"model_id": model_id, "device": device},
            ) from e
        self._backend = backend
        self._dim = int(self._model.get_sentence_embedding_dimension())
        max_seq = getattr(self._model, "max_seq_length", None)
        self._max_tokens = int(max_seq) if max_seq else 512

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def model_version(self) -> str:
        return self._model_version

    @property
    def dim(self) -> int:
        return self._dim

    @property
    def max_tokens(self) -> int:
        return self._max_tokens

    @property
    def active_backend(self) -> AccelBackend:
        return self._backend

    async def embed_query(self, text: str) -> np.ndarray:
        vector = await asyncio.to_thread(self._encode_one, text)
        return vector.astype("float32")

    async def embed_documents(
        self,
        texts: list[str],
        progress: ProgressCallback | None = None,
    ) -> list[np.ndarray]:
        vectors = await asyncio.to_thread(self._encode_many, texts)
        if progress is not None:
            await progress(len(texts), len(texts))
        return [v.astype("float32") for v in vectors]

    def _encode_one(self, text: str) -> np.ndarray:
        return np.asarray(self._model.encode(text, convert_to_numpy=True))

    def _encode_many(self, texts: list[str]) -> list[np.ndarray]:
        out = self._model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
        return [np.asarray(v) for v in out]
