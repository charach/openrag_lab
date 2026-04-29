"""FastAPI dependency providers.

These are imported by the per-feature routers. They look state up off of
``request.app.state.app_state`` (set by ``main.create_app`` lifespan) so
tests can swap the entire ``AppState`` with a single override.
"""

from __future__ import annotations

from fastapi import Request

from openrag_lab.app.state import AppState


def get_state(request: Request) -> AppState:
    """Return the ``AppState`` attached to the running app."""
    state: AppState = request.app.state.app_state
    return state
