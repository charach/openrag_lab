"""CancellationToken — flag flip + raise behaviour."""

from __future__ import annotations

import pytest

from openrag_lab.domain.errors import CancelledError
from openrag_lab.domain.services.cancellation import CancellationToken


def test_starts_uncancelled() -> None:
    t = CancellationToken()
    assert t.is_cancelled is False
    t.raise_if_cancelled()  # no error


def test_cancel_then_raise() -> None:
    t = CancellationToken()
    t.cancel()
    with pytest.raises(CancelledError) as ei:
        t.raise_if_cancelled(stage="parse")
    assert ei.value.code == "OPERATION_CANCELLED"
    assert ei.value.details.get("stage") == "parse"


def test_cancel_is_idempotent() -> None:
    t = CancellationToken()
    t.cancel()
    t.cancel()
    assert t.is_cancelled is True
