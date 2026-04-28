"""Document and parsed-document models.

Documents reference their original file by absolute path — we never copy
user files into the workspace (PLATFORM.md §4.1, Windows file-locking
considerations).
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from openrag_lab.domain.models.enums import DocumentFormat
from openrag_lab.domain.models.ids import DocumentId, WorkspaceId


_HASH_CHUNK_BYTES = 1 << 20  # 1 MiB streaming reads — never load whole file.


class Document(BaseModel):
    """A user-supplied source file registered in a workspace."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: DocumentId
    workspace_id: WorkspaceId
    source_path: Path
    content_hash: str = Field(min_length=64, max_length=64)  # SHA-256 hex.
    format: DocumentFormat
    size_bytes: int = Field(ge=0)
    added_at: datetime

    @staticmethod
    def hash_file(path: Path) -> str:
        """Stream a file through SHA-256. Stable across runs and OSes.

        Uses 1 MiB chunks so even multi-GB files do not blow up RAM.
        """
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            while chunk := fh.read(_HASH_CHUNK_BYTES):
                digest.update(chunk)
        return digest.hexdigest()


class ParsedPage(BaseModel):
    """One logical page of extracted text + metadata."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    page_number: int = Field(ge=1)
    text: str
    char_count: int = Field(ge=0)


class ParsedDocument(BaseModel):
    """Output of a Parser adapter, cacheable by (content_hash, parser_version)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    document_id: DocumentId
    pages: tuple[ParsedPage, ...]
    parser_version: str

    @classmethod
    def from_pages(
        cls,
        document_id: DocumentId,
        pages: list[ParsedPage],
        parser_version: str,
    ) -> Self:
        return cls(
            document_id=document_id,
            pages=tuple(pages),
            parser_version=parser_version,
        )

    @property
    def total_chars(self) -> int:
        return sum(p.char_count for p in self.pages)
