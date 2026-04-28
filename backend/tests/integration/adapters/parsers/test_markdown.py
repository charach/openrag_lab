"""MarkdownParser — frontmatter stripping + plain-text fallback."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from openrag_lab.adapters.parsers.markdown import MarkdownParser
from openrag_lab.domain.models.document import Document
from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import new_document_id, new_workspace_id


def _doc(path: Path) -> Document:
    return Document(
        id=new_document_id(),
        workspace_id=new_workspace_id(),
        source_path=path,
        content_hash=Document.hash_file(path),
        format=DocumentFormat.MD,
        size_bytes=path.stat().st_size,
        added_at=datetime.now(UTC),
    )


async def test_markdown_parser_supports_only_md() -> None:
    parser = MarkdownParser()
    assert parser.supports(DocumentFormat.MD)
    assert not parser.supports(DocumentFormat.TXT)


async def test_markdown_parser_returns_body_unchanged_when_no_frontmatter(
    tmp_path: Path,
) -> None:
    p = tmp_path / "plain.md"
    p.write_text("# 제목\n\n본문 첫 줄\n", encoding="utf-8")

    parsed = await MarkdownParser().parse(_doc(p))
    assert parsed.pages[0].text == "# 제목\n\n본문 첫 줄\n"


async def test_markdown_parser_strips_yaml_frontmatter(tmp_path: Path) -> None:
    p = tmp_path / "with_fm.md"
    p.write_text(
        "---\ntitle: 제목\nauthor: Jane\n---\n\n# 본문 시작\n\n첫 줄.",
        encoding="utf-8",
    )

    parsed = await MarkdownParser().parse(_doc(p))
    assert parsed.pages[0].text.startswith("# 본문 시작")
    assert "title:" not in parsed.pages[0].text


async def test_markdown_parser_keeps_triple_dash_inside_body(tmp_path: Path) -> None:
    # ``---`` mid-document is a horizontal rule, not frontmatter.
    p = tmp_path / "rule.md"
    body = "Before rule.\n\n---\n\nAfter rule."
    p.write_text(body, encoding="utf-8")

    parsed = await MarkdownParser().parse(_doc(p))
    assert parsed.pages[0].text == body


async def test_markdown_parser_does_not_strip_unclosed_frontmatter(
    tmp_path: Path,
) -> None:
    # Opening ``---`` without a matching close is left alone.
    p = tmp_path / "broken.md"
    p.write_text("---\ntitle: oops\n\n# body", encoding="utf-8")

    parsed = await MarkdownParser().parse(_doc(p))
    assert parsed.pages[0].text.startswith("---")
