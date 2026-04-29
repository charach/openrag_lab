"""Application state container — the home of process-wide singletons.

The FastAPI app reaches in via ``Depends(get_state)``. Tests build their
own ``AppState`` and inject it with ``app.dependency_overrides``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from openrag_lab.app.services.runtime import RuntimeFactories, default_factories
from openrag_lab.app.ws.hub import WebSocketHub
from openrag_lab.domain.models.hardware import SystemProfile
from openrag_lab.domain.models.ids import ExperimentId, TaskId
from openrag_lab.domain.services.task_queue import TaskQueue
from openrag_lab.infra.fs.workspace_layout import WorkspaceLayout


@dataclass
class AppState:
    """Long-lived objects shared across requests.

    Heavyweight components (vector stores, embedders) are lazily built per
    workspace via ``factories`` to avoid loading every model on boot. The
    base layout + system profile are cheap and computed once.
    """

    layout: WorkspaceLayout
    profile: SystemProfile
    factories: RuntimeFactories = field(default_factory=default_factories)
    hub: WebSocketHub = field(default_factory=WebSocketHub)
    task_queue: TaskQueue = field(default_factory=lambda: TaskQueue(max_concurrent=1))
    # Map task_id → (experiment_id, kind, websocket_topic) for status responses.
    task_metadata: dict[TaskId, TaskMetadata] = field(default_factory=dict)
    # Latest experiment per workspace, used by retrieval/chat (P0).
    workspace_active_experiment: dict[str, ExperimentId] = field(default_factory=dict)


@dataclass
class TaskMetadata:
    kind: str  # "indexing" | "evaluation" | ...
    experiment_id: ExperimentId | None = None
    workspace_id: str | None = None
    websocket_topic: str | None = None
