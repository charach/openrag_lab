"""Document model — content_hash determinism + streaming behavior."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from openrag_lab.domain.models.document import Document, ParsedDocument, ParsedPage
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id


def test_hash_file_is_deterministic_across_calls(tmp_path: Path) -> None:
    p = tmp_path / "sample.txt"
    p.write_bytes(b"hello world")
    assert Document.hash_file(p) == Document.hash_file(p)


def test_hash_file_returns_64_hex_chars(tmp_path: Path) -> None:
    p = tmp_path / "sample.txt"
    p.write_bytes(b"hello world")
    digest = Document.hash_file(p)
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)


def test_hash_file_differs_for_different_content(tmp_path: Path) -> None:
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    a.write_bytes(b"alpha")
    b.write_bytes(b"beta")
    assert Document.hash_file(a) != Document.hash_file(b)


def test_hash_file_handles_files_larger_than_chunk_buffer(tmp_path: Path) -> None:
    # Write 3 MiB so we exercise the streaming loop multiple times.
    p = tmp_path / "big.bin"
    p.write_bytes(os.urandom(3 * 1024 * 1024))
    digest = Document.hash_file(p)
    assert len(digest) == 64


def test_document_rejects_short_hash() -> None:
    with pytest.raises(ValidationError):
        Document(
            id=new_document_id(),
            workspace_id=new_workspace_id(),
            source_path=Path("/tmp/x.pdf"),
            content_hash="deadbeef",
            format=DocumentFormat.PDF,
            size_bytes=10,
            added_at=datetime.now(UTC),
        )


def test_document_is_frozen() -> None:
    doc = Document(
        id=new_document_id(),
        workspace_id=new_workspace_id(),
        source_path=Path("/tmp/x.pdf"),
        content_hash="0" * 64,
        format=DocumentFormat.PDF,
        size_bytes=10,
        added_at=datetime.now(UTC),
    )
    with pytest.raises(ValidationError):
        doc.size_bytes = 20  # type: ignore[misc]


def test_parsed_document_total_chars_sums_pages() -> None:
    doc_id = new_document_id()
    parsed = ParsedDocument.from_pages(
        doc_id,
        [
            ParsedPage(page_number=1, text="abc", char_count=3),
            ParsedPage(page_number=2, text="hello", char_count=5),
        ],
        parser_version="pymupdf-1.0",
    )
    assert parsed.total_chars == 8
    assert parsed.pages[0].page_number == 1
