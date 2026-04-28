"""TxtParser — encoding fallback, newline normalisation, errors."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from openrag_lab.adapters.parsers.txt import TxtParser
from openrag_lab.domain.errors import ParseError
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id


def _doc(path: Path) -> Document:
    return Document(
        id=new_document_id(),
        workspace_id=new_workspace_id(),
        source_path=path,
        content_hash=Document.hash_file(path) if path.exists() else "0" * 64,
        format=DocumentFormat.TXT,
        size_bytes=path.stat().st_size if path.exists() else 0,
        added_at=datetime.now(UTC),
    )


async def test_txt_parser_supports_only_txt() -> None:
    parser = TxtParser()
    assert parser.supports(DocumentFormat.TXT)
    assert not parser.supports(DocumentFormat.PDF)
    assert not parser.supports(DocumentFormat.MD)


async def test_txt_parser_reads_utf8_korean(tmp_path: Path) -> None:
    p = tmp_path / "korean.txt"
    p.write_text("한글 본문 입니다.", encoding="utf-8")

    parsed = await TxtParser().parse(_doc(p))
    assert len(parsed.pages) == 1
    assert parsed.pages[0].text == "한글 본문 입니다."
    assert parsed.parser_version == TxtParser.PARSER_VERSION


async def test_txt_parser_handles_utf8_bom(tmp_path: Path) -> None:
    p = tmp_path / "bom.txt"
    p.write_bytes("﻿hello".encode())

    parsed = await TxtParser().parse(_doc(p))
    # BOM is consumed by utf-8-sig fallback.
    assert parsed.pages[0].text == "hello"


async def test_txt_parser_handles_utf16(tmp_path: Path) -> None:
    p = tmp_path / "utf16.txt"
    p.write_bytes("¡hola!".encode("utf-16"))

    parsed = await TxtParser().parse(_doc(p))
    assert parsed.pages[0].text == "¡hola!"


async def test_txt_parser_normalises_crlf_to_lf(tmp_path: Path) -> None:
    p = tmp_path / "win.txt"
    p.write_bytes(b"line one\r\nline two\r\nline three")

    parsed = await TxtParser().parse(_doc(p))
    assert "\r" not in parsed.pages[0].text
    assert parsed.pages[0].text == "line one\nline two\nline three"


async def test_txt_parser_normalises_lone_cr_to_lf(tmp_path: Path) -> None:
    p = tmp_path / "old_mac.txt"
    p.write_bytes(b"a\rb\rc")

    parsed = await TxtParser().parse(_doc(p))
    assert parsed.pages[0].text == "a\nb\nc"


async def test_txt_parser_handles_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "empty.txt"
    p.write_bytes(b"")

    parsed = await TxtParser().parse(_doc(p))
    assert parsed.pages[0].text == ""
    assert parsed.pages[0].char_count == 0


async def test_txt_parser_raises_parse_error_for_missing_file(tmp_path: Path) -> None:
    missing = tmp_path / "ghost.txt"
    parser = TxtParser()

    with pytest.raises(ParseError) as exc:
        await parser.parse(_doc(missing))
    assert exc.value.code == "PARSE_CORRUPTED_FILE"
    assert exc.value.details["filename"] == "ghost.txt"


async def test_txt_parser_falls_back_to_replace_on_undecodable_bytes(tmp_path: Path) -> None:
    # 0xFF/0xFE are invalid leading bytes for UTF-8 / UTF-16 / common locales.
    p = tmp_path / "junk.bin.txt"
    p.write_bytes(b"\xff\xfe\xff\xfe garbled")

    parsed = await TxtParser().parse(_doc(p))
    # Should not raise; we get *something* back so the user can still index.
    assert "garbled" in parsed.pages[0].text or parsed.pages[0].text != ""
