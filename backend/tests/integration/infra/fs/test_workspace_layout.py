"""WorkspaceLayout — OS-resolved root, ensure(), traversal guard."""

from __future__ import annotations

from pathlib import Path

import pytest

from openrag_lab.infra.fs.workspace_layout import (
    WorkspaceLayout,
    WorkspacePaths,
    is_inside,
    resolve_openrag_home,
)

# --- resolve_openrag_home ----------------------------------------------------


def test_openrag_home_env_override_wins(tmp_path: Path) -> None:
    custom = tmp_path / "custom 한글 📁"
    out = resolve_openrag_home(
        env={"OPENRAG_HOME": str(custom)},
        platform="darwin",
        home=tmp_path,
    )
    assert out == custom


def test_openrag_home_macos_default_uses_application_support(tmp_path: Path) -> None:
    out = resolve_openrag_home(env={}, platform="darwin", home=tmp_path)
    assert out == tmp_path / "Library" / "Application Support" / "OpenRAG-Lab"


def test_openrag_home_windows_default_uses_appdata(tmp_path: Path) -> None:
    appdata = tmp_path / "Roaming"
    out = resolve_openrag_home(
        env={"APPDATA": str(appdata)},
        platform="win32",
        home=tmp_path,
    )
    assert out == appdata / "OpenRAG-Lab"


def test_openrag_home_windows_without_appdata_falls_back_under_home(
    tmp_path: Path,
) -> None:
    out = resolve_openrag_home(env={}, platform="win32", home=tmp_path)
    assert out == tmp_path / "AppData" / "Roaming" / "OpenRAG-Lab"


def test_openrag_home_linux_xdg_wins_over_default(tmp_path: Path) -> None:
    xdg = tmp_path / "xdg"
    out = resolve_openrag_home(
        env={"XDG_DATA_HOME": str(xdg)},
        platform="linux",
        home=tmp_path,
    )
    assert out == xdg / "openrag-lab"


def test_openrag_home_linux_default_uses_local_share(tmp_path: Path) -> None:
    out = resolve_openrag_home(env={}, platform="linux", home=tmp_path)
    assert out == tmp_path / ".local" / "share" / "openrag-lab"


def test_openrag_home_freebsd_follows_linux_rule(tmp_path: Path) -> None:
    out = resolve_openrag_home(env={}, platform="freebsd", home=tmp_path)
    assert out == tmp_path / ".local" / "share" / "openrag-lab"


# --- WorkspaceLayout.ensure() ------------------------------------------------


def test_layout_ensure_creates_standard_subdirs(tmp_path: Path) -> None:
    layout = WorkspaceLayout(root=tmp_path / "OpenRAG-Lab")
    layout.ensure()
    assert layout.workspaces_dir.is_dir()
    assert layout.models_dir.is_dir()
    assert layout.logs_dir.is_dir()


def test_layout_ensure_is_idempotent(tmp_path: Path) -> None:
    layout = WorkspaceLayout(root=tmp_path / "root")
    layout.ensure()
    layout.ensure()  # no error


def test_layout_workspace_dir_is_under_workspaces(tmp_path: Path) -> None:
    layout = WorkspaceLayout(root=tmp_path)
    out = layout.workspace_dir("ws_abc123def456")
    assert out.parent == layout.workspaces_dir
    assert out.name == "ws_abc123def456"


def test_layout_handles_unicode_root(tmp_path: Path) -> None:
    root = tmp_path / "한국어 폴더 📁"
    layout = WorkspaceLayout(root=root)
    layout.ensure()
    assert layout.workspaces_dir.is_dir()


# --- WorkspacePaths ----------------------------------------------------------


def test_workspace_paths_lays_out_expected_subtree(tmp_path: Path) -> None:
    paths = WorkspacePaths(root=tmp_path / "ws01")
    paths.ensure()
    assert paths.cache_dir.is_dir()
    assert paths.parse_cache_dir.is_dir()
    assert paths.embedding_cache_dir.is_dir()
    assert paths.vectors_dir.is_dir()
    assert paths.documents_dir.is_dir()
    # db and config files are *not* created — that's the caller's job.
    assert not paths.db.exists()
    assert not paths.config_yaml.exists()


# --- is_inside ---------------------------------------------------------------


def test_is_inside_true_for_descendants(tmp_path: Path) -> None:
    parent = tmp_path / "parent"
    child = parent / "a" / "b"
    parent.mkdir()
    child.parent.mkdir(parents=True)
    child.mkdir()
    assert is_inside(parent, child)


def test_is_inside_false_for_siblings(tmp_path: Path) -> None:
    parent = tmp_path / "parent"
    parent.mkdir()
    sibling = tmp_path / "sibling"
    sibling.mkdir()
    assert not is_inside(parent, sibling)


def test_is_inside_blocks_traversal_with_dotdot(tmp_path: Path) -> None:
    parent = tmp_path / "parent"
    parent.mkdir()
    outside = parent / ".." / "elsewhere"
    (tmp_path / "elsewhere").mkdir()
    assert not is_inside(parent, outside)


def test_is_inside_handles_nonexistent_child_via_parent(tmp_path: Path) -> None:
    # On case-insensitive macOS, an unresolved child whose parent exists
    # should resolve cleanly.
    parent = tmp_path / "parent"
    parent.mkdir()
    pytest.importorskip("os")  # sanity — Path resolution is os-dependent
    assert is_inside(parent, parent / "not-yet-created-file.txt")
