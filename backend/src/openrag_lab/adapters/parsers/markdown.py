"""Markdown (.md) parser.

P0 strategy: treat the file as plain text after stripping any leading YAML
frontmatter (``---\\n...\\n---``). Section-aware chunking can pick up the
markdown structure later (P1, ``adapters/chunkers/semantic.py``).
"""

from __future__ import annotations

from openrag_lab.adapters.parsers._text_io import read_text_file
from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.document import Document, ParsedDocument, ParsedPage
from openrag_lab.domain.models.enums import DocumentFormat


def _strip_frontmatter(text: str) -> str:
    """Remove a leading ``---`` YAML block if one is present.

    Conservative: only strips when the very first line is ``---`` and a
    closing ``---`` is found within the first 200 lines. Anything else is
    returned untouched.
    """
    lines = text.split("\n", 200)
    if not lines or lines[0].strip() != "---":
        return text
    for i in range(1, min(len(lines), 200)):
        if lines[i].strip() == "---":
            # Reassemble what's after the closing fence.
            after = "\n".join(lines[i + 1 :])
            return after.lstrip("\n")
    return text


class MarkdownParser:
    """``DocumentParser`` for ``DocumentFormat.MD``."""

    PARSER_VERSION = "md-1.0"

    @property
    def parser_version(self) -> str:
        return self.PARSER_VERSION

    def supports(self, fmt: DocumentFormat) -> bool:
        return fmt is DocumentFormat.MD

    async def parse(self, document: Document) -> ParsedDocument:
        if not document.source_path.exists():
            raise ParseError(
                f"Source file not found: {document.source_path}",
                code="PARSE_CORRUPTED_FILE",
                details={"filename": document.source_path.name},
            )

        raw = await read_text_file(document.source_path)
        text = _strip_frontmatter(raw)
        page = ParsedPage(page_number=1, text=text, char_count=len(text))
        return ParsedDocument.from_pages(
            document.id,
            [page],
            self.PARSER_VERSION,
        )
