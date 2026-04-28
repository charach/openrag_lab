"""DocumentParser port — converts a registered Document into ParsedDocument.

Reference: docs/ARCHITECTURE_v3.md §7.1.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from openrag_lab.domain.models.document import Document, ParsedDocument
from openrag_lab.domain.models.enums import DocumentFormat


@runtime_checkable
class DocumentParser(Protocol):
    """Convert a source file into text + page metadata.

    Implementations belong in ``adapters/parsers/`` and may raise
    ``ParseError`` (with one of the ``PARSE_*`` codes) for unrecoverable
    input. Parsers must NOT swallow library exceptions silently — wrap
    them as ``ParseError`` with details.
    """

    @property
    def parser_version(self) -> str:
        """A version string that bumps whenever output would change.

        Used as part of the parse-cache key (ARCHITECTURE_v3.md §8.3) so
        a parser logic change invalidates its cached output.
        """
        ...

    def supports(self, fmt: DocumentFormat) -> bool: ...

    async def parse(self, document: Document) -> ParsedDocument: ...
