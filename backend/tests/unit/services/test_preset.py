"""PresetRecommender — RAM-tier mapping."""

from __future__ import annotations

from openrag_lab.domain.models.enums import AccelBackend
from openrag_lab.domain.models.hardware import (
    CPUInfo,
    OSInfo,
    RAMInfo,
    SystemProfile,
)
from openrag_lab.domain.services.preset import (
    list_presets,
    recommend,
    to_experiment_config,
)


def _profile(ram_gib: float) -> SystemProfile:
    return SystemProfile(
        os=OSInfo(name="darwin", release="24.0", arch="arm64"),
        cpu=CPUInfo(cores_logical=8),
        ram=RAMInfo(total_bytes=int(ram_gib * 1024**3)),
        available_backends=(AccelBackend.CPU,),
    )


def test_low_ram_recommends_lite() -> None:
    p = recommend(_profile(4))
    assert p.name == "lite"


def test_mid_ram_recommends_balanced() -> None:
    p = recommend(_profile(8))
    assert p.name == "balanced"


def test_high_ram_recommends_quality() -> None:
    p = recommend(_profile(32))
    assert p.name == "quality"


def test_to_experiment_config_propagates_llm_id() -> None:
    p = recommend(_profile(8))
    cfg = to_experiment_config(p, llm_id="echo")
    assert cfg.llm_id == "echo"
    assert cfg.embedder_id == p.embedder_id


def test_to_experiment_config_retrieval_only_when_no_llm() -> None:
    p = recommend(_profile(8))
    cfg = to_experiment_config(p)
    assert cfg.is_retrieval_only is True


def test_list_presets_returns_three_named_tiers() -> None:
    names = {p.name for p in list_presets()}
    assert names == {"lite", "balanced", "quality"}
