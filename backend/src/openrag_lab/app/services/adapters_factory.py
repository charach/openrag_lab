"""Adapter assembly — pick the right parser/chunker for a given input.

Centralized so individual handlers don't each re-derive the dispatch logic.
P0 covers TXT/MD/PDF parsers and FIXED/RECURSIVE chunkers.
"""

from __future__ import annotations

from openrag_lab.adapters.chunkers.fixed import FixedChunker
from openrag_lab.adapters.chunkers.recursive import RecursiveChunker
from openrag_lab.adapters.parsers.markdown import MarkdownParser
from openrag_lab.adapters.parsers.txt import TxtParser
from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.enums import ChunkingStrategy, DocumentFormat
from openrag_lab.domain.ports.chunker import Chunker
from openrag_lab.domain.ports.parser import DocumentParser

_EXTENSION_TO_FORMAT: dict[str, DocumentFormat] = {
    ".txt": DocumentFormat.TXT,
    ".md": DocumentFormat.MD,
    ".markdown": DocumentFormat.MD,
    ".pdf": DocumentFormat.PDF,
}


def detect_format(filename: str) -> DocumentFormat:
    """Map a filename to a ``DocumentFormat`` or raise ``ParseError``."""
    lower = filename.lower()
    for ext, fmt in _EXTENSION_TO_FORMAT.items():
        if lower.endswith(ext):
            return fmt
    raise ParseError(
        f"지원하지 않는 파일 형식입니다: {filename}",
        code="PARSE_UNSUPPORTED_FORMAT",
        recoverable=False,
        details={"filename": filename},
    )


def parser_for(fmt: DocumentFormat) -> DocumentParser:
    """Return a parser instance for the given format."""
    if fmt is DocumentFormat.TXT:
        return TxtParser()
    if fmt is DocumentFormat.MD:
        return MarkdownParser()
    if fmt is DocumentFormat.PDF:
        # Imported lazily so test envs without PyMuPDF can still import this module.
        from openrag_lab.adapters.parsers.pdf_pymupdf import PDFParser

        return PDFParser()
    raise ParseError(
        f"지원하지 않는 파일 형식입니다: {fmt.value}",
        code="PARSE_UNSUPPORTED_FORMAT",
        recoverable=False,
        details={"format": fmt.value},
    )


def chunker_for(strategy: ChunkingStrategy) -> Chunker:
    if strategy is ChunkingStrategy.FIXED:
        return FixedChunker()
    if strategy is ChunkingStrategy.RECURSIVE:
        return RecursiveChunker()
    raise ParseError(
        f"P0에서 지원하지 않는 청킹 전략입니다: {strategy.value}",
        code="CONFIG_VALIDATION_FAILED",
        recoverable=False,
        details={"strategy": strategy.value},
    )
