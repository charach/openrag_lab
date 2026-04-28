"""Shared text-loading helpers for plain-text parsers.

Encoding fallback chain mirrors PLATFORM.md §4.4.
Newline normalisation: any of CRLF / CR / LF -> LF (PLATFORM.md §4.3).
"""

from __future__ import annotations

import asyncio
from pathlib import Path

# Try strict, common encodings first; only fall back to lossy decoding as a last resort.
# utf-8-sig comes BEFORE utf-8 so a leading BOM is consumed (rather than left as U+FEFF
# in the decoded string, which would leak into chunks).
_ENCODINGS_TO_TRY: tuple[str, ...] = ("utf-8-sig", "utf-8", "utf-16")


def _normalise_newlines(text: str) -> str:
    # Order matters: handle CRLF before stray CR.
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _decode_bytes(raw: bytes) -> str:
    """Best-effort decode following PLATFORM.md §4.4."""
    for enc in _ENCODINGS_TO_TRY:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # Locale fallback (Windows: cp949/cp1252, POSIX: locale).
    import locale

    locale_enc = locale.getpreferredencoding(False)
    try:
        return raw.decode(locale_enc)
    except UnicodeDecodeError:
        # Absolute last resort: replace undecodable bytes so indexing can proceed.
        return raw.decode("utf-8", errors="replace")


def _read_sync(path: Path) -> str:
    raw = path.read_bytes()
    return _normalise_newlines(_decode_bytes(raw))


async def read_text_file(path: Path) -> str:
    """Async wrapper around the blocking file read.

    The actual decode runs on a worker thread per CONTRIBUTING.md §3.4
    (no sync I/O in async functions).
    """
    return await asyncio.to_thread(_read_sync, path)
