"""Model catalog + license-acceptance endpoints.

The frontend calls these before kicking off the first ``/index`` against
a freshly-installed model so the LicenseModal can render the SPDX id +
size estimate. Acceptance persists to ``layout.root`` so the modal
appears once per model, not once per indexing run.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.errors import HttpError
from openrag_lab.app.state import AppState, license_store_for
from openrag_lab.domain.models.model_card import ModelCard
from openrag_lab.domain.services.model_catalog import (
    get_card,
    license_body,
    list_cards,
)

router = APIRouter(prefix="/models", tags=["models"])


def _serialize(card: ModelCard, *, accepted: bool) -> dict[str, Any]:
    return {
        "id": card.id,
        "kind": card.kind,
        "display_name": card.display_name,
        "license_id": card.license_id,
        "license_url": card.license_url,
        "size_estimate_bytes": card.size_estimate_bytes,
        "commercial_use": card.commercial_use,
        "license_body": license_body(card.license_id) or "",
        "license_accepted": accepted,
    }


@router.get("")
async def list_models(state: Annotated[AppState, Depends(get_state)]) -> dict[str, Any]:
    store = license_store_for(state)
    return {
        "items": [
            _serialize(c, accepted=store.is_accepted(c.id)) for c in list_cards()
        ]
    }


@router.get("/{model_id:path}")
async def get_model(
    model_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    card = get_card(model_id)
    if card is None:
        raise HttpError(
            status_code=404,
            code="MODEL_NOT_FOUND",
            message="모델 카탈로그에 없는 ID입니다.",
            recoverable=False,
            details={"model_id": model_id},
        )
    store = license_store_for(state)
    return _serialize(card, accepted=store.is_accepted(card.id))


@router.post("/{model_id:path}/accept-license")
async def accept_license(
    model_id: str,
    state: Annotated[AppState, Depends(get_state)],
) -> dict[str, Any]:
    card = get_card(model_id)
    if card is None:
        raise HttpError(
            status_code=404,
            code="MODEL_NOT_FOUND",
            message="모델 카탈로그에 없는 ID입니다.",
            recoverable=False,
            details={"model_id": model_id},
        )
    store = license_store_for(state)
    store.accept(card.id)
    return {"accepted": True, "model_id": card.id, "license_id": card.license_id}
