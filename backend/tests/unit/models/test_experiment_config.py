"""ExperimentConfig — fingerprint determinism + retrieval-only mode."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from openrag_lab.domain.models.chunk import ChunkingConfig
from openrag_lab.domain.models.enums import ChunkingStrategy, RetrievalStrategy
from openrag_lab.domain.models.experiment import ExperimentConfig


def _cfg(**overrides: object) -> ExperimentConfig:
    base: dict[str, object] = {
        "embedder_id": "BAAI/bge-small-en-v1.5",
        "chunking": ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE,
            chunk_size=512,
            chunk_overlap=64,
        ),
        "retrieval_strategy": RetrievalStrategy.DENSE,
        "top_k": 5,
        "llm_id": "local:llama-3-8b-q4",
    }
    base.update(overrides)
    return ExperimentConfig(**base)  # type: ignore[arg-type]


# --- determinism -------------------------------------------------------------


def test_experiment_config_fingerprint_same_for_equivalent_configs() -> None:
    assert _cfg().fingerprint() == _cfg().fingerprint()


def test_experiment_config_fingerprint_changes_with_embedder() -> None:
    a = _cfg(embedder_id="BAAI/bge-small-en-v1.5")
    b = _cfg(embedder_id="BAAI/bge-large-en-v1.5")
    assert a.fingerprint() != b.fingerprint()


def test_experiment_config_fingerprint_changes_with_chunking() -> None:
    a = _cfg()
    b = _cfg(
        chunking=ChunkingConfig(
            strategy=ChunkingStrategy.RECURSIVE,
            chunk_size=768,
            chunk_overlap=64,
        ),
    )
    assert a.fingerprint() != b.fingerprint()


def test_experiment_config_fingerprint_changes_with_top_k() -> None:
    assert _cfg(top_k=5).fingerprint() != _cfg(top_k=10).fingerprint()


def test_experiment_config_fingerprint_distinguishes_none_vs_set_llm() -> None:
    a = _cfg(llm_id=None)
    b = _cfg(llm_id="local:llama-3-8b-q4")
    assert a.fingerprint() != b.fingerprint()


def test_experiment_config_fingerprint_changes_with_retrieval_strategy() -> None:
    a = _cfg(retrieval_strategy=RetrievalStrategy.DENSE)
    b = _cfg(retrieval_strategy=RetrievalStrategy.SPARSE)
    assert a.fingerprint() != b.fingerprint()


def test_experiment_config_fingerprint_is_16_lowercase_hex() -> None:
    fp = _cfg().fingerprint()
    assert len(fp) == 16
    assert all(c in "0123456789abcdef" for c in fp)


# --- retrieval-only mode -----------------------------------------------------


def test_experiment_config_is_retrieval_only_when_llm_id_is_none() -> None:
    cfg = _cfg(llm_id=None)
    assert cfg.is_retrieval_only is True


def test_experiment_config_is_not_retrieval_only_when_llm_id_set() -> None:
    cfg = _cfg(llm_id="local:llama-3-8b-q4")
    assert cfg.is_retrieval_only is False


# --- validation --------------------------------------------------------------


def test_experiment_config_rejects_top_k_zero() -> None:
    with pytest.raises(ValidationError):
        _cfg(top_k=0)


def test_experiment_config_rejects_top_k_above_max() -> None:
    with pytest.raises(ValidationError):
        _cfg(top_k=51)


def test_experiment_config_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        ExperimentConfig(  # type: ignore[call-arg]
            embedder_id="BAAI/bge-small-en-v1.5",
            chunking=ChunkingConfig(
                strategy=ChunkingStrategy.RECURSIVE,
                chunk_size=512,
            ),
            retrieval_strategy=RetrievalStrategy.DENSE,
            top_k=5,
            extra_field=True,
        )


def test_experiment_config_is_frozen() -> None:
    cfg = _cfg()
    with pytest.raises(ValidationError):
        cfg.top_k = 10  # type: ignore[misc]
