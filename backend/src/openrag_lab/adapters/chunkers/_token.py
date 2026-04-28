"""Whitespace-token utilities used by every chunker.

For the MVP we approximate "tokens" as whitespace-separated runs. This
matches user intuition for English/Korean prose closely enough for
sizing decisions, and it is purely deterministic — no model dependency.
True tokenizer-aware chunking is left as a P1 enhancement; embedders
still enforce their hard token limit at index time
(CHUNK_SIZE_EXCEEDS_EMBEDDER_LIMIT).
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"\S+")


def token_count(text: str) -> int:
    """Number of whitespace-separated tokens in ``text``."""
    return sum(1 for _ in _TOKEN_RE.finditer(text))


def token_offsets(text: str) -> list[tuple[int, int]]:
    """Char offsets ``(start, end)`` for every token, in source order."""
    return [(m.start(), m.end()) for m in _TOKEN_RE.finditer(text)]
