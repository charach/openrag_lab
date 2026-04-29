"""System endpoints — hardware profile + recommended presets.

API_SPEC §4. Both endpoints are read-only and never mutate state.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from openrag_lab.app.dependencies import get_state
from openrag_lab.app.state import AppState
from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.models.hardware import SystemProfile
from openrag_lab.domain.services.preset import Preset, list_presets, recommend

router = APIRouter(prefix="/system", tags=["system"])


def _bytes_to_gb(value: int | None) -> float | None:
    if value is None:
        return None
    return round(value / (1024**3), 2)


def _serialize_profile(profile: SystemProfile, layout_root: str) -> dict[str, Any]:
    primary_gpu = profile.gpus[0] if profile.gpus else None
    gpu_payload: dict[str, Any] = {
        "available": primary_gpu is not None and primary_gpu.backend != AccelBackend.CPU,
        "vendor": _vendor_for(primary_gpu.backend) if primary_gpu else None,
        "name": primary_gpu.name if primary_gpu else None,
        "vram_gb": _bytes_to_gb(primary_gpu.vram_bytes) if primary_gpu else None,
        "acceleration_backend": profile.acceleration_backend.value,
        "available_backends": [b.value for b in profile.available_backends],
    }
    return {
        "cpu": {
            "cores": profile.cpu.cores_logical,
            "threads": profile.cpu.cores_logical,
            "model": profile.cpu.brand,
        },
        "ram": {
            "total_gb": _bytes_to_gb(profile.ram.total_bytes) or 0,
            "available_gb": _bytes_to_gb(profile.ram.available_bytes),
        },
        "gpu": gpu_payload,
        "os": {
            "platform": profile.os.name,
            "version": profile.os.release,
            "arch": profile.os.arch,
        },
        "paths": {
            "openrag_home": layout_root,
        },
        "warnings": list(profile.warnings),
    }


def _vendor_for(backend: AccelBackend) -> str | None:
    if backend == AccelBackend.CUDA:
        return "nvidia"
    if backend == AccelBackend.METAL:
        return "apple"
    if backend == AccelBackend.ROCM:
        return "amd"
    if backend == AccelBackend.XPU:
        return "intel"
    if backend == AccelBackend.DIRECTML:
        return "directml"
    return None


def _serialize_preset(preset: Preset, profile: SystemProfile) -> dict[str, Any]:
    recommended = recommend(profile)
    return {
        "id": preset.name,
        "name": preset.name,
        "available": True,
        "recommended": preset.name == recommended.name,
        "config": {
            "embedder_id": preset.embedder_id,
            "chunking": {
                "strategy": preset.chunking.strategy.value,
                "chunk_size": preset.chunking.chunk_size,
                "chunk_overlap": preset.chunking.chunk_overlap,
            },
            "retrieval_strategy": preset.retrieval_strategy.value,
            "top_k": preset.top_k,
            "llm_id": None,
        },
        "rationale": preset.rationale,
    }


@router.get("/profile")
async def get_profile(state: Annotated[AppState, Depends(get_state)]) -> dict[str, Any]:
    return _serialize_profile(state.profile, str(state.layout.root))


@router.get("/presets")
async def get_presets(state: Annotated[AppState, Depends(get_state)]) -> dict[str, Any]:
    return {"presets": [_serialize_preset(p, state.profile) for p in list_presets()]}
