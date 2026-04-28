"""ParseCache — content_hash + parser_version key, atomic write, schema guard."""

from __future__ import annotations

from pathlib import Path

from openrag_lab.domain.models.document import ParsedDocument, ParsedPage
from openrag_lab.domain.models.ids import new_document_id
from openrag_lab.infra.cache.parse_cache import ParseCache


def _make_parsed(text: str = "hello", parser_version: str = "txt-1.0") -> ParsedDocument:
    return ParsedDocument.from_pages(
        new_document_id(),
        [ParsedPage(page_number=1, text=text, char_count=len(text))],
        parser_version=parser_version,
    )


def test_miss_returns_none(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    assert cache.get("a" * 64, "txt-1.0") is None
    assert not cache.has("a" * 64, "txt-1.0")


def test_round_trip_preserves_content(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed(text="안녕 — emoji 🚀")
    content_hash = "f" * 64
    cache.put(parsed, content_hash)

    out = cache.get(content_hash, parsed.parser_version)
    assert out is not None
    assert out.parser_version == parsed.parser_version
    assert out.document_id == parsed.document_id
    assert tuple(p.text for p in out.pages) == tuple(p.text for p in parsed.pages)


def test_parser_version_change_invalidates_entry(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed(parser_version="txt-1.0")
    cache.put(parsed, "a" * 64)
    assert cache.get("a" * 64, "txt-2.0") is None
    assert cache.get("a" * 64, "txt-1.0") is not None


def test_content_hash_change_invalidates_entry(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed()
    cache.put(parsed, "a" * 64)
    assert cache.get("b" * 64, parsed.parser_version) is None


def test_corrupted_file_is_treated_as_miss(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed()
    cache.put(parsed, "a" * 64)
    # Corrupt the on-disk JSON.
    key = cache.key_for("a" * 64, parsed.parser_version)
    file = tmp_path / key[:2] / f"{key}.json"
    file.write_text("not valid json", encoding="utf-8")
    assert cache.get("a" * 64, parsed.parser_version) is None


def test_evict_removes_file(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed()
    cache.put(parsed, "a" * 64)
    assert cache.evict("a" * 64, parsed.parser_version) is True
    assert cache.evict("a" * 64, parsed.parser_version) is False  # idempotent


def test_keys_fan_out_into_two_char_subdirs(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed()
    cache.put(parsed, "a" * 64)
    key = cache.key_for("a" * 64, parsed.parser_version)
    assert (tmp_path / key[:2] / f"{key}.json").is_file()


def test_schema_mismatch_is_treated_as_miss(tmp_path: Path) -> None:
    cache = ParseCache(tmp_path)
    parsed = _make_parsed()
    cache.put(parsed, "a" * 64)
    # Rewrite with an unsupported schema.
    key = cache.key_for("a" * 64, parsed.parser_version)
    file = tmp_path / key[:2] / f"{key}.json"
    file.write_text(
        '{"schema": 99, "document_id": "x", "pages": [], "parser_version": "x"}', encoding="utf-8"
    )
    assert cache.get("a" * 64, parsed.parser_version) is None
