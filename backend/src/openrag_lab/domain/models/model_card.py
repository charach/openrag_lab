"""Catalog metadata for downloadable models.

A ``ModelCard`` describes one model's identity, size, and license — the
data the LicenseModal needs to render a click-through. We keep this in
the domain layer because the catalog is a pure value list; the
application layer adds runtime state (cached / accepted) on top.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelCard:
    """One downloadable model."""

    id: str
    """Stable identifier — also the HuggingFace repo id where applicable."""
    kind: str
    """``embedder`` | ``llm`` | ``judge``."""
    display_name: str
    license_id: str
    """SPDX-style id (e.g. ``Apache-2.0``, ``MIT``, ``Llama-3-Community``)."""
    license_url: str | None
    size_estimate_bytes: int
    commercial_use: str
    """``yes`` | ``research-only`` | arbitrary string."""
