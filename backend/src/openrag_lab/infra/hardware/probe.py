"""Best-effort hardware probe — OS, CPU, RAM, GPU.

OS branching is allowed here per CLAUDE.md (this *is* the platform-aware
infra layer). We never raise on missing data: each detector returns a
sensible default and may append a string to ``warnings`` so the user
sees what we couldn't determine.

GPU detection is intentionally conservative for the MVP:

* Apple Silicon → ``METAL`` (always available on darwin/arm64)
* If ``torch`` happens to be importable and reports CUDA, expose ``CUDA``
* Otherwise → ``CPU`` only

Heavier detection (ROCm, XPU, DirectML) is P1 and lives behind feature
flags so we don't import optional deps unconditionally.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.models.hardware import (
    CPUInfo,
    GPUInfo,
    OSInfo,
    RAMInfo,
    SystemProfile,
)


def _probe_os() -> OSInfo:
    return OSInfo(
        name=platform.system().lower(),
        release=platform.release(),
        arch=platform.machine(),
    )


def _probe_cpu() -> CPUInfo:
    logical = os.cpu_count() or 1
    physical: int | None = None
    try:
        # ``os.sched_getaffinity`` is Linux/some-BSDs; treat as upper bound.
        if hasattr(os, "sched_getaffinity"):
            logical = max(logical, len(os.sched_getaffinity(0)))
    except OSError:
        pass
    brand = platform.processor() or ""
    return CPUInfo(cores_logical=logical, cores_physical=physical, brand=brand)


def _probe_ram_bytes_macos() -> int | None:
    out = _run(["sysctl", "-n", "hw.memsize"])
    if out is None:
        return None
    try:
        return int(out.strip())
    except ValueError:
        return None


def _probe_ram_bytes_linux() -> int | None:
    meminfo = Path("/proc/meminfo")
    if not meminfo.is_file():
        return None
    try:
        for line in meminfo.read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                kb = int(line.split()[1])
                return kb * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def _probe_ram_bytes_windows() -> int | None:
    # GlobalMemoryStatusEx via ctypes — no extra deps.
    try:
        import ctypes
        from ctypes import wintypes

        class MEMSTAT(ctypes.Structure):
            _fields_ = [
                ("dwLength", wintypes.DWORD),
                ("dwMemoryLoad", wintypes.DWORD),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMSTAT()
        stat.dwLength = ctypes.sizeof(MEMSTAT)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):  # type: ignore[attr-defined]
            return int(stat.ullTotalPhys)
    except Exception:
        return None
    return None


def _probe_ram(os_name: str) -> RAMInfo:
    if os_name == "darwin":
        total = _probe_ram_bytes_macos()
    elif os_name == "linux":
        total = _probe_ram_bytes_linux()
    elif os_name == "windows":
        total = _probe_ram_bytes_windows()
    else:
        total = None
    return RAMInfo(total_bytes=total or 0)


def _run(cmd: list[str]) -> str | None:
    """Run a small system probe command. Returns stdout, or ``None`` on failure."""
    if not cmd or shutil.which(cmd[0]) is None:
        return None
    try:
        result = subprocess.run(  # noqa: S603 — fixed argv, no shell
            cmd, capture_output=True, text=True, timeout=2, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def _probe_apple_silicon_gpu() -> GPUInfo | None:
    if sys.platform != "darwin":
        return None
    if platform.machine() not in {"arm64", "aarch64"}:
        return None
    return GPUInfo(name="Apple Silicon GPU", backend=AccelBackend.METAL)


def _probe_cuda_gpu() -> GPUInfo | None:
    """Detect NVIDIA GPU via ``nvidia-smi``. Returns the first device only."""
    out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    if not out:
        return None
    line = out.splitlines()[0].strip() if out.splitlines() else ""
    if not line:
        return None
    parts = [p.strip() for p in line.split(",")]
    name = parts[0] if parts else "NVIDIA GPU"
    vram_mib: int | None = None
    if len(parts) >= 2:
        try:
            vram_mib = int(parts[1])
        except ValueError:
            vram_mib = None
    vram_bytes = vram_mib * 1024 * 1024 if vram_mib is not None else None
    return GPUInfo(name=name, backend=AccelBackend.CUDA, vram_bytes=vram_bytes)


def _probe_gpus(os_name: str, warnings: list[str]) -> list[GPUInfo]:
    found: list[GPUInfo] = []
    apple = _probe_apple_silicon_gpu()
    if apple is not None:
        found.append(apple)
    cuda = _probe_cuda_gpu()
    if cuda is not None:
        found.append(cuda)
    if not found and os_name in {"linux", "windows"}:
        warnings.append("no NVIDIA GPU detected via nvidia-smi — falling back to CPU")
    return found


def _select_backend(gpus: list[GPUInfo]) -> AccelBackend:
    """Pick the highest-priority backend that is actually available.

    Priority follows PLATFORM.md §3.3: CUDA > METAL > CPU. (ROCm / XPU /
    DirectML are P1 and currently unreachable from this probe.)
    """
    backends = {g.backend for g in gpus}
    for preferred in (AccelBackend.CUDA, AccelBackend.METAL):
        if preferred in backends:
            return preferred
    return AccelBackend.CPU


def probe_system() -> SystemProfile:
    """Return the full ``SystemProfile`` for the current host."""
    warnings: list[str] = []
    os_info = _probe_os()
    cpu_info = _probe_cpu()
    ram_info = _probe_ram(os_info.name)
    gpus = _probe_gpus(os_info.name, warnings)

    available: list[AccelBackend] = [AccelBackend.CPU]
    for g in gpus:
        if g.backend not in available:
            available.append(g.backend)
    active = _select_backend(gpus)

    return SystemProfile(
        os=os_info,
        cpu=cpu_info,
        ram=ram_info,
        gpus=tuple(gpus),
        available_backends=tuple(available),
        acceleration_backend=active,
        warnings=tuple(warnings),
    )
