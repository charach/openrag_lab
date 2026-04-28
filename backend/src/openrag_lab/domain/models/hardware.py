"""Hardware / system-profile domain model.

Reference: PLATFORM.md §3 + API_SPEC_v4.md §4.1. This is the snapshot the
``HardwareProfiler`` returns; the application layer hands it to adapters
so they can pick an acceleration backend without sniffing the OS.

Fields are intentionally sparse — anything we can't detect cheaply on a
given OS is left out (``None`` / empty list) rather than guessed.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.enums import AccelBackend


class OSInfo(BaseModel):
    """Operating-system summary."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str  # "darwin" | "windows" | "linux" | ...
    release: str  # uname release string
    arch: str  # "x86_64" | "arm64" | ...


class CPUInfo(BaseModel):
    """CPU summary. ``brand`` is best-effort; empty when unavailable."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    cores_logical: int = Field(ge=1)
    cores_physical: int | None = Field(default=None, ge=1)
    brand: str = ""


class RAMInfo(BaseModel):
    """RAM totals in bytes. ``available_bytes`` may be ``None`` if not probed."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    total_bytes: int = Field(ge=0)
    available_bytes: int | None = Field(default=None, ge=0)


class GPUInfo(BaseModel):
    """One discovered accelerator. ``vram_bytes`` is ``None`` when unknown."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    backend: AccelBackend
    vram_bytes: int | None = Field(default=None, ge=0)


class SystemProfile(BaseModel):
    """Aggregate snapshot returned by the hardware probe."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    os: OSInfo
    cpu: CPUInfo
    ram: RAMInfo
    gpus: tuple[GPUInfo, ...] = Field(default_factory=tuple)
    available_backends: tuple[AccelBackend, ...] = Field(
        default_factory=lambda: (AccelBackend.CPU,)
    )
    acceleration_backend: AccelBackend = AccelBackend.CPU
    warnings: tuple[str, ...] = Field(default_factory=tuple)
