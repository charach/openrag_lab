"""Plain-text (.txt) parser.

Treats the entire file as page 1. Future P1 work could split very large
text files into pseudo-pages, but the MVP keeps it simple — chunkers
operate on page content anyway.
"""

from __future__ import annotations

from openrag_lab.adapters.parsers._text_io import read_text_file
from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.document import Document, ParsedDocument, ParsedPage
from openrag_lab.domain.models.enums import DocumentFormat


class TxtParser:
    """``DocumentParser`` for ``DocumentFormat.TXT``."""

    PARSER_VERSION = "txt-1.0"

    @property
    def parser_version(self) -> str:
        return self.PARSER_VERSION

    def supports(self, fmt: DocumentFormat) -> bool:
        return fmt is DocumentFormat.TXT

    async def parse(self, document: Document) -> ParsedDocument:
        if not document.source_path.exists():
            raise ParseError(
                f"Source file not found: {document.source_path}",
                code="PARSE_CORRUPTED_FILE",
                details={"filename": document.source_path.name},
            )

        text = await read_text_file(document.source_path)
        page = ParsedPage(page_number=1, text=text, char_count=len(text))
        return ParsedDocument.from_pages(
            document.id,
            [page],
            self.PARSER_VERSION,
        )
