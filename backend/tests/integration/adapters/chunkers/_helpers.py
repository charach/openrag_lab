"""Helpers shared by chunker tests."""

from __future__ import annotations

from openrag_lab.domain.models.document import ParsedDocument, ParsedPage
from openrag_lab.domain.models.ids import new_document_id


def parsed_from(*pages: str) -> ParsedDocument:
    """Build a ParsedDocument from raw page strings."""
    return ParsedDocument.from_pages(
        new_document_id(),
        [ParsedPage(page_number=i + 1, text=t, char_count=len(t)) for i, t in enumerate(pages)],
        parser_version="test-1.0",
    )


def make_tokens(n: int, sep: str = " ") -> str:
    """Generate ``n`` whitespace-separated tokens ``t0 t1 t2 ...``."""
    return sep.join(f"t{i}" for i in range(n))
