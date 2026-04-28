"""On-disk cache for parsed documents.

Cache key is ``content_hash + parser_version`` (ARCHITECTURE_v3.md §8.3).
Two parses of the same bytes by the same parser version share an entry;
either an upgraded parser or a modified document invalidates it.

Storage layout::

    <cache_root>/
      <key[:2]>/<key>.json     # parsed document, JSON-serialised

The first two hex characters fan out into a sub-directory so a single
folder never grows past ~256 entries on Windows (PLATFORM.md §4 — the
Explorer chokes long before NTFS does).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from openrag_lab.domain.models.document import ParsedDocument, ParsedPage
from openrag_lab.domain.models.ids import DocumentId


def _key(content_hash: str, parser_version: str) -> str:
    """16-char hex digest from ``content_hash`` and ``parser_version``."""
    raw = f"{content_hash}|{parser_version}".encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def _path_for(root: Path, key: str) -> Path:
    return root / key[:2] / f"{key}.json"


class ParseCache:
    """Filesystem cache for ``ParsedDocument`` objects."""

    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    def key_for(self, content_hash: str, parser_version: str) -> str:
        return _key(content_hash, parser_version)

    def get(self, content_hash: str, parser_version: str) -> ParsedDocument | None:
        """Return the cached parse, or ``None`` on miss / corruption."""
        key = _key(content_hash, parser_version)
        path = _path_for(self._root, key)
        if not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        try:
            return _decode(payload)
        except (KeyError, ValueError, TypeError):
            return None

    def put(self, parsed: ParsedDocument, content_hash: str) -> None:
        """Write ``parsed`` keyed by ``content_hash`` and its parser version.

        Atomic on POSIX/Windows: write to a sibling ``.tmp`` then rename.
        """
        key = _key(content_hash, parsed.parser_version)
        path = _path_for(self._root, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(_encode(parsed)), encoding="utf-8")
        tmp.replace(path)

    def has(self, content_hash: str, parser_version: str) -> bool:
        return _path_for(self._root, _key(content_hash, parser_version)).is_file()

    def evict(self, content_hash: str, parser_version: str) -> bool:
        """Remove a cache entry. Returns ``True`` if anything was deleted."""
        path = _path_for(self._root, _key(content_hash, parser_version))
        if path.is_file():
            path.unlink()
            return True
        return False


def _encode(parsed: ParsedDocument) -> dict[str, object]:
    return {
        "schema": 1,
        "document_id": str(parsed.document_id),
        "parser_version": parsed.parser_version,
        "pages": [
            {
                "page_number": p.page_number,
                "text": p.text,
                "char_count": p.char_count,
            }
            for p in parsed.pages
        ],
    }


def _decode(payload: dict[str, object]) -> ParsedDocument:
    if payload.get("schema") != 1:
        raise ValueError(f"unsupported parse-cache schema: {payload.get('schema')!r}")
    raw_pages = payload["pages"]
    if not isinstance(raw_pages, list):
        raise ValueError("pages must be a list")
    pages = [
        ParsedPage(
            page_number=int(p["page_number"]),
            text=str(p["text"]),
            char_count=int(p["char_count"]),
        )
        for p in raw_pages
    ]
    return ParsedDocument(
        document_id=DocumentId(str(payload["document_id"])),
        pages=tuple(pages),
        parser_version=str(payload["parser_version"]),
    )
