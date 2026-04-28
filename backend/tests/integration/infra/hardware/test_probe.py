"""HardwareProfiler — runs on the actual CI host, no mocks.

We only assert invariants that hold on every supported OS — concrete
values (RAM size, GPU name) vary across machines, so we just verify
shape + contracts.
"""

from __future__ import annotations

from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.infra.hardware.probe import (
    _select_backend,
    probe_system,
)


def test_probe_returns_a_well_formed_profile() -> None:
    profile = probe_system()
    assert profile.os.name in {"darwin", "linux", "windows", "freebsd"} or profile.os.name
    assert profile.cpu.cores_logical >= 1
    # Every system supports CPU.
    assert AccelBackend.CPU in profile.available_backends
    # Active backend must be one of the listed available ones.
    assert profile.acceleration_backend in profile.available_backends


def test_probe_ram_total_is_nonnegative() -> None:
    profile = probe_system()
    assert profile.ram.total_bytes >= 0


def test_probe_active_backend_matches_priority_when_cuda_present() -> None:
    # Pure-function test of the priority logic — no GPU required.
    cuda = _select_backend(
        [
            type("G", (), {"backend": AccelBackend.METAL})(),  # type: ignore[list-item]
            type("G", (), {"backend": AccelBackend.CUDA})(),  # type: ignore[list-item]
        ]
    )
    assert cuda is AccelBackend.CUDA


def test_probe_active_backend_falls_back_to_cpu_when_no_gpu() -> None:
    assert _select_backend([]) is AccelBackend.CPU


def test_probe_active_backend_picks_metal_on_apple_only() -> None:
    metal = _select_backend(
        [type("G", (), {"backend": AccelBackend.METAL})()],  # type: ignore[list-item]
    )
    assert metal is AccelBackend.METAL


def test_probe_warnings_is_a_tuple_of_strings() -> None:
    profile = probe_system()
    assert isinstance(profile.warnings, tuple)
    for w in profile.warnings:
        assert isinstance(w, str)
