"""GoldenSetService — direct entry + CSV import (P0).

CSV format (header required):

    question,expected_answer
    What is RAG?,Retrieval-Augmented Generation

Empty cells are allowed for ``expected_answer`` (retrieval-only sets).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class GoldenPairCandidate:
    """One row not yet persisted — caller assigns IDs."""

    question: str
    expected_answer: str | None = None


def parse_csv(text: str) -> list[GoldenPairCandidate]:
    """Parse a CSV blob into pair candidates.

    Raises ``ValueError`` for missing/extra columns or empty questions.
    """
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise ValueError("CSV is empty")
    header = [h.strip().lower() for h in rows[0]]
    if header[:1] != ["question"]:
        raise ValueError(f"first column must be 'question', got {header[0]!r}")
    has_answer = len(header) > 1 and header[1] == "expected_answer"
    out: list[GoldenPairCandidate] = []
    for line_no, row in enumerate(rows[1:], start=2):
        if not row:
            continue
        question = row[0].strip()
        if not question:
            raise ValueError(f"empty question at line {line_no}")
        answer: str | None = None
        if has_answer and len(row) > 1:
            raw = row[1].strip()
            answer = raw if raw else None
        out.append(GoldenPairCandidate(question=question, expected_answer=answer))
    return out


def from_pairs(pairs: Iterable[GoldenPairCandidate]) -> list[GoldenPairCandidate]:
    """Pass-through helper used by the API layer for direct entry."""
    return list(pairs)
