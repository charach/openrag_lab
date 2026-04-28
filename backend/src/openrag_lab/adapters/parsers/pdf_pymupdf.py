"""PDF parser backed by PyMuPDF (``fitz``).

Reference: docs/PLATFORM.md §3.4 — pymupdf is part of the MVP cross-OS
supported set. The parser respects ``Document`` only as a path source;
file lifecycle stays with the user (PLATFORM.md §4.1).

Failure modes are translated into ``ParseError`` with codes from
ERROR_CODES.md §3 (PARSE_*).
"""

from __future__ import annotations

import asyncio

from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.document import Document, ParsedDocument, ParsedPage
from openrag_lab.domain.models.enums import DocumentFormat

try:  # PyMuPDF is heavy, so we accept its absence gracefully at import time.
    import fitz  # type: ignore[import-untyped]

    _HAS_PYMUPDF = True
except ImportError:  # pragma: no cover — exercised on lean test envs only
    _HAS_PYMUPDF = False


PARSER_VERSION = "pymupdf-1.0"


class PDFParser:
    """Adapter for ``DocumentFormat.PDF`` files using PyMuPDF."""

    def __init__(self) -> None:
        if not _HAS_PYMUPDF:
            raise ParseError(
                "PyMuPDF (pymupdf) is not installed.",
                code="PARSE_UNSUPPORTED_FORMAT",
                recoverable=False,
            )

    @property
    def parser_version(self) -> str:
        return PARSER_VERSION

    def supports(self, fmt: DocumentFormat) -> bool:
        return fmt is DocumentFormat.PDF

    async def parse(self, document: Document) -> ParsedDocument:
        if not self.supports(document.format):
            raise ParseError(
                f"PDFParser does not support format={document.format.value}",
                code="PARSE_UNSUPPORTED_FORMAT",
            )
        return await asyncio.to_thread(_parse_sync, document)


def _parse_sync(document: Document) -> ParsedDocument:
    path = document.source_path
    try:
        doc = fitz.open(str(path))
    except FileNotFoundError as e:
        raise ParseError(
            f"PDF file not found: {path}",
            code="PARSE_CORRUPTED_FILE",
            details={"path": path.as_posix()},
        ) from e
    except RuntimeError as e:
        raise ParseError(
            f"PDF could not be opened: {e}",
            code="PARSE_CORRUPTED_FILE",
            details={"path": path.as_posix()},
        ) from e

    try:
        if doc.is_encrypted and not doc.authenticate(""):
            raise ParseError(
                "PDF is password-protected and cannot be parsed.",
                code="PARSE_ENCRYPTED_PDF",
                details={"path": path.as_posix()},
            )
        pages: list[ParsedPage] = []
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text") or ""
            pages.append(
                ParsedPage(page_number=i, text=text, char_count=len(text)),
            )
    finally:
        doc.close()

    if not pages or all(p.char_count == 0 for p in pages):
        raise ParseError(
            "PDF contains no extractable text (image-only PDF?).",
            code="PARSE_EMPTY_DOCUMENT",
            details={"path": path.as_posix(), "pages": len(pages)},
        )

    return ParsedDocument.from_pages(
        document_id=document.id,
        pages=pages,
        parser_version=PARSER_VERSION,
    )
