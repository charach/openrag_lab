"""PDFParser — happy path, encrypted, empty, missing file."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from openrag_lab.adapters.parsers.pdf_pymupdf import PDFParser
from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id

fitz = pytest.importorskip("fitz")  # PyMuPDF — skip integration tests if missing.


def _make_pdf(path: Path, *, pages: list[str], encrypt: str | None = None) -> Path:
    doc = fitz.open()
    for body in pages:
        page = doc.new_page()
        page.insert_text((72, 72), body)
    if encrypt:
        # PyMuPDF requires both owner+user passwords plus permissions.
        doc.save(
            str(path),
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=encrypt,
            user_pw=encrypt,
            permissions=fitz.PDF_PERM_PRINT,
        )
    else:
        doc.save(str(path))
    doc.close()
    return path


def _doc_for(path: Path) -> Document:
    return Document(
        id=new_document_id(),
        workspace_id=new_workspace_id(),
        source_path=path,
        content_hash="a" * 64,
        format=DocumentFormat.PDF,
        size_bytes=path.stat().st_size,
        added_at=datetime.now(UTC),
    )


async def test_parses_two_page_pdf(tmp_path: Path) -> None:
    path = _make_pdf(tmp_path / "two.pdf", pages=["First page", "Second page"])
    parsed = await PDFParser().parse(_doc_for(path))
    assert len(parsed.pages) == 2
    assert "First" in parsed.pages[0].text
    assert "Second" in parsed.pages[1].text
    assert parsed.parser_version.startswith("pymupdf-")


async def test_records_per_page_char_count(tmp_path: Path) -> None:
    path = _make_pdf(tmp_path / "one.pdf", pages=["Hello world"])
    parsed = await PDFParser().parse(_doc_for(path))
    assert parsed.pages[0].char_count == len(parsed.pages[0].text)


async def test_encrypted_pdf_raises_parse_error(tmp_path: Path) -> None:
    path = _make_pdf(tmp_path / "locked.pdf", pages=["secret"], encrypt="hunter2")
    with pytest.raises(ParseError) as ei:
        await PDFParser().parse(_doc_for(path))
    assert ei.value.code == "PARSE_ENCRYPTED_PDF"


async def test_empty_pdf_raises_parse_error(tmp_path: Path) -> None:
    # A PDF with a page that has no text content.
    path = tmp_path / "empty.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(path))
    doc.close()
    with pytest.raises(ParseError) as ei:
        await PDFParser().parse(_doc_for(path))
    assert ei.value.code == "PARSE_EMPTY_DOCUMENT"


async def test_missing_file_raises_parse_error(tmp_path: Path) -> None:
    missing = tmp_path / "does-not-exist.pdf"
    doc = Document(
        id=new_document_id(),
        workspace_id=new_workspace_id(),
        source_path=missing,
        content_hash="a" * 64,
        format=DocumentFormat.PDF,
        size_bytes=0,
        added_at=datetime.now(UTC),
    )
    with pytest.raises(ParseError) as ei:
        await PDFParser().parse(doc)
    assert ei.value.code == "PARSE_CORRUPTED_FILE"


async def test_rejects_non_pdf_format(tmp_path: Path) -> None:
    path = _make_pdf(tmp_path / "x.pdf", pages=["x"])
    doc = Document(
        id=new_document_id(),
        workspace_id=new_workspace_id(),
        source_path=path,
        content_hash="a" * 64,
        format=DocumentFormat.TXT,
        size_bytes=path.stat().st_size,
        added_at=datetime.now(UTC),
    )
    with pytest.raises(ParseError) as ei:
        await PDFParser().parse(doc)
    assert ei.value.code == "PARSE_UNSUPPORTED_FORMAT"


def test_supports_only_pdf() -> None:
    p = PDFParser()
    assert p.supports(DocumentFormat.PDF)
    assert not p.supports(DocumentFormat.TXT)
    assert not p.supports(DocumentFormat.MD)
