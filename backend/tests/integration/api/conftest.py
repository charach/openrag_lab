"""Shared fixtures for FastAPI integration tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from openrag_lab.adapters.embedders.fake import FakeEmbedder
from openrag_lab.adapters.evaluators.llm_judge import LLMJudge
from openrag_lab.adapters.llms.null import EchoLLM
from openrag_lab.adapters.vector_stores.in_memory import InMemoryVectorStore
from openrag_lab.app.services.runtime import RuntimeFactories
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.models.hardware import (
    CPUInfo,
    GPUInfo,
    OSInfo,
    RAMInfo,
    SystemProfile,
)
from openrag_lab.infra.fs.workspace_layout import WorkspaceLayout


@pytest.fixture
def fake_layout(tmp_path: Path) -> WorkspaceLayout:
    layout = WorkspaceLayout(root=tmp_path / "openrag-home")
    layout.ensure()
    return layout


@pytest.fixture
def fake_profile() -> SystemProfile:
    return SystemProfile(
        os=OSInfo(name="darwin", release="23.4.0", arch="arm64"),
        cpu=CPUInfo(cores_logical=8, cores_physical=8, brand="Apple M2"),
        ram=RAMInfo(total_bytes=16 * 1024**3, available_bytes=8 * 1024**3),
        gpus=(GPUInfo(name="Apple M2 GPU", backend=AccelBackend.METAL),),
        available_backends=(AccelBackend.CPU, AccelBackend.METAL),
        acceleration_backend=AccelBackend.METAL,
        warnings=(),
    )


@pytest.fixture
def fake_factories() -> RuntimeFactories:
    """Inject deterministic fakes for embedder + vector store.

    Each call returns the same in-memory store so retrieval after indexing
    sees the upserted vectors. The embedder is dim=32 to keep state small.
    """
    shared_store = InMemoryVectorStore()
    echo = EchoLLM()
    return RuntimeFactories(
        embedder=lambda _model_id: FakeEmbedder(dim=32),
        vector_store=lambda _ws_id, _path: shared_store,
        llm=lambda _llm_id: echo,
        judge=lambda _judge_id: LLMJudge(echo),
    )


@pytest.fixture
def app_state(
    fake_layout: WorkspaceLayout,
    fake_profile: SystemProfile,
    fake_factories: RuntimeFactories,
) -> AppState:
    return AppState(
        layout=fake_layout,
        profile=fake_profile,
        factories=fake_factories,
    )
