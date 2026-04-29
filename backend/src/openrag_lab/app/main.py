"""FastAPI application factory.

``create_app()`` is the canonical entry point. ``uvicorn`` wires it up via
``openrag_lab.app.main:create_app`` (factory mode) and tests build an in-process
``TestClient(create_app(state=...))`` to avoid touching the user's home dir.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from openrag_lab.app.api.chat import router as chat_router
from openrag_lab.app.api.config import router as config_router
from openrag_lab.app.api.documents import router as documents_router
from openrag_lab.app.api.experiments import router as experiments_router
from openrag_lab.app.api.golden_sets import router as golden_sets_router
from openrag_lab.app.api.indexing import router as indexing_router
from openrag_lab.app.api.system import router as system_router
from openrag_lab.app.api.tasks import router as tasks_router
from openrag_lab.app.api.workspaces import router as workspaces_router
from openrag_lab.app.errors import install_exception_handlers
from openrag_lab.app.runtime_lock import acquire, release
from openrag_lab.app.services.runtime import RuntimeFactories
from openrag_lab.app.state import AppState
from openrag_lab.app.ws.endpoint import router as ws_router
from openrag_lab.config.settings import load as load_settings
from openrag_lab.infra.fs.workspace_layout import default_layout
from openrag_lab.infra.hardware.probe import probe_system


def _e2e_factories() -> RuntimeFactories:
    """Deterministic adapter wiring used when ``OPENRAG_LAB_TEST_MODE=1``.

    Lets Playwright drive the real HTTP surface without pulling in
    sentence-transformers / Chroma / a local LLM. Echoes through
    ``EchoLLM`` so chat answers are stable across runs.
    """
    from openrag_lab.adapters.embedders.fake import FakeEmbedder
    from openrag_lab.adapters.evaluators.llm_judge import LLMJudge
    from openrag_lab.adapters.llms.null import EchoLLM
    from openrag_lab.adapters.vector_stores.in_memory import InMemoryVectorStore

    shared_store = InMemoryVectorStore()
    echo = EchoLLM()
    return RuntimeFactories(
        embedder=lambda _model_id: FakeEmbedder(dim=32),
        vector_store=lambda _ws_id, _path: shared_store,
        llm=lambda _llm_id: echo,
        judge=lambda _judge_id: LLMJudge(echo),
    )


def _bootstrap_state() -> AppState:
    import os

    from openrag_lab.app.services.runtime import default_factories

    layout = default_layout()
    layout.ensure()
    profile = probe_system()
    settings = load_settings(layout.settings_yaml)
    factories = (
        _e2e_factories() if os.environ.get("OPENRAG_LAB_TEST_MODE") == "1" else default_factories()
    )
    return AppState(
        layout=layout,
        profile=profile,
        settings=settings,
        factories=factories,
    )


def create_app(*, state: AppState | None = None) -> FastAPI:
    """Build a FastAPI app bound to the given state.

    Tests pass an in-memory ``state`` so the runtime lock targets a tmp dir
    instead of ``OPENRAG_HOME``. Production callers pass nothing and accept
    the standard layout.
    """
    bound_state = state if state is not None else _bootstrap_state()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        acquire(bound_state.layout.runtime_lock)
        app.state.app_state = bound_state
        try:
            yield
        finally:
            release(bound_state.layout.runtime_lock)

    app = FastAPI(
        title="OpenRAG-Lab",
        version="0.0.1",
        lifespan=lifespan,
    )
    install_exception_handlers(app)
    app.include_router(system_router)
    app.include_router(workspaces_router)
    app.include_router(documents_router)
    app.include_router(indexing_router)
    app.include_router(chat_router)
    app.include_router(golden_sets_router)
    app.include_router(experiments_router)
    app.include_router(config_router)
    app.include_router(tasks_router)
    app.include_router(ws_router)
    return app
