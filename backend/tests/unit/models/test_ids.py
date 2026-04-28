"""ID generation — uniqueness, prefix, length budget."""

from __future__ import annotations

import re

from openrag_lab.domain.models.ids import (
    new_chunk_id,
    new_document_id,
    new_experiment_id,
    new_workspace_id,
)

_HEX12 = re.compile(r"^[a-z]+_[0-9a-f]{12}$")
_HEX16 = re.compile(r"^[a-z]+_[0-9a-f]{16}$")


def test_new_workspace_id_uses_ws_prefix_and_12_hex() -> None:
    wid = new_workspace_id()
    assert _HEX12.match(wid), wid


def test_new_document_id_uses_doc_prefix_and_12_hex() -> None:
    did = new_document_id()
    assert did.startswith("doc_")
    assert _HEX12.match(did), did


def test_new_chunk_id_uses_chk_prefix_and_16_hex() -> None:
    cid = new_chunk_id()
    assert cid.startswith("chk_")
    assert _HEX16.match(cid), cid


def test_new_experiment_id_uses_exp_prefix() -> None:
    eid = new_experiment_id()
    assert eid.startswith("exp_")
    assert _HEX12.match(eid), eid


def test_id_generators_yield_unique_values_in_a_sample() -> None:
    sample = {new_chunk_id() for _ in range(1_000)}
    assert len(sample) == 1_000


def test_id_length_fits_path_budget() -> None:
    # PLATFORM.md §2.5 keeps the longest workspace path < 240 chars on Windows.
    # workspace + document + chunk together must fit.
    assert len(new_workspace_id()) <= 16
    assert len(new_document_id()) <= 16
    assert len(new_chunk_id()) <= 20
