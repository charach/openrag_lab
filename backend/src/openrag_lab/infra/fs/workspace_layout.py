"""OS-aware resolution of ``OPENRAG_HOME`` and the standard layout under it.

PLATFORM.md §2 is the source of truth. ``OPENRAG_HOME`` overrides the
OS-standard location; otherwise we follow the per-OS table:

| OS      | Standard                                            |
|---------|-----------------------------------------------------|
| macOS   | ``~/Library/Application Support/OpenRAG-Lab/``      |
| Windows | ``%APPDATA%/OpenRAG-Lab/``                          |
| Linux   | ``$XDG_DATA_HOME/openrag-lab/`` or                  |
|         | ``~/.local/share/openrag-lab/``                     |

OS branching only happens here and in ``infra/hardware/probe.py``.
Domain code never sees ``sys.platform``.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

_APP_DIR_POSIX = "openrag-lab"
_APP_DIR_NATIVE = "OpenRAG-Lab"


def _macos_default(home: Path) -> Path:
    return home / "Library" / "Application Support" / _APP_DIR_NATIVE


def _windows_default(home: Path, env: dict[str, str]) -> Path:
    appdata = env.get("APPDATA")
    if appdata:
        return Path(appdata) / _APP_DIR_NATIVE
    # Fall back to the documented default (PLATFORM.md §2.1).
    return home / "AppData" / "Roaming" / _APP_DIR_NATIVE


def _linux_default(home: Path, env: dict[str, str]) -> Path:
    xdg = env.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / _APP_DIR_POSIX
    return home / ".local" / "share" / _APP_DIR_POSIX


def resolve_openrag_home(
    *,
    env: dict[str, str] | None = None,
    platform: str | None = None,
    home: Path | None = None,
) -> Path:
    """Resolve ``OPENRAG_HOME`` per PLATFORM.md §2.1.

    Parameters are injected for testability — production callers use the
    no-argument form, tests pass a fake environment.
    """
    env = env if env is not None else dict(os.environ)
    platform = platform if platform is not None else sys.platform
    home = home if home is not None else Path.home()

    override = env.get("OPENRAG_HOME")
    if override:
        return Path(override)

    if platform == "darwin":
        return _macos_default(home)
    if platform.startswith("win"):
        return _windows_default(home, env)
    # All non-Darwin POSIX (linux, freebsd, etc.) follow the XDG rule.
    return _linux_default(home, env)


@dataclass(frozen=True)
class WorkspaceLayout:
    """Standard layout under ``OPENRAG_HOME`` (PLATFORM.md §2.2).

    All paths are absolute. ``ensure()`` creates missing directories.
    """

    root: Path

    @property
    def workspaces_dir(self) -> Path:
        return self.root / "workspaces"

    @property
    def models_dir(self) -> Path:
        return self.root / "models"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def settings_yaml(self) -> Path:
        return self.root / "settings.yaml"

    @property
    def api_keys_yaml(self) -> Path:
        """File-backed keystore for external LLM provider API keys."""
        return self.root / "api_keys.yaml"

    @property
    def runtime_lock(self) -> Path:
        return self.root / "runtime.lock"

    def workspace_dir(self, workspace_id: str) -> Path:
        return self.workspaces_dir / workspace_id

    def ensure(self) -> None:
        """Create root + standard subdirectories. Idempotent."""
        for d in (self.root, self.workspaces_dir, self.models_dir, self.logs_dir):
            d.mkdir(parents=True, exist_ok=True)


def default_layout() -> WorkspaceLayout:
    """``WorkspaceLayout`` rooted at the resolved ``OPENRAG_HOME``."""
    return WorkspaceLayout(root=resolve_openrag_home())


@dataclass(frozen=True)
class WorkspacePaths:
    """Per-workspace path layout (ARCHITECTURE_v3.md §11.2)."""

    root: Path

    @property
    def db(self) -> Path:
        return self.root / "data.sqlite"

    @property
    def cache_dir(self) -> Path:
        return self.root / "cache"

    @property
    def parse_cache_dir(self) -> Path:
        return self.cache_dir / "parse"

    @property
    def embedding_cache_dir(self) -> Path:
        return self.cache_dir / "embeddings"

    @property
    def vectors_dir(self) -> Path:
        return self.root / "vectors"

    @property
    def documents_dir(self) -> Path:
        return self.root / "documents"

    @property
    def config_yaml(self) -> Path:
        return self.root / "config.yaml"

    def ensure(self) -> None:
        """Create the workspace directory tree. Idempotent."""
        for d in (
            self.root,
            self.cache_dir,
            self.parse_cache_dir,
            self.embedding_cache_dir,
            self.vectors_dir,
            self.documents_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


def is_inside(parent: Path, child: Path) -> bool:
    """``True`` iff ``child`` (after ``resolve()``) is contained in ``parent``.

    Used to enforce the path-traversal guard mandated by PLATFORM.md §2.4.
    Both paths are resolved against the real filesystem; the parent must
    exist for ``resolve()`` to canonicalise correctly on case-insensitive
    filesystems.
    """
    try:
        resolved_parent = parent.resolve()
        resolved_child = child.resolve()
    except OSError:
        return False
    try:
        resolved_child.relative_to(resolved_parent)
    except ValueError:
        return False
    return True
