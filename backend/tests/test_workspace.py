from __future__ import annotations

from pathlib import Path

import pytest

from core import workspace as ws


@pytest.fixture
def project(tmp_path: Path) -> ws.Workspace:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('привет')\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Проект\n", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "junk.js").write_text("junk", encoding="utf-8")
    return ws.Workspace(tmp_path.resolve())


def test_tree_skips_noise(project: ws.Workspace) -> None:
    paths = {entry["path"] for entry in ws.tree(project)}
    assert "src/main.py" in paths
    assert "README.md" in paths
    assert not any("node_modules" in path for path in paths)


def test_read_and_write_roundtrip(project: ws.Workspace) -> None:
    data = ws.read_file(project, "src/main.py")
    assert "привет" in data["text"]
    ws.write_file(project, "src/main.py", "print('пока')\n")
    assert "пока" in ws.read_file(project, "src/main.py")["text"]


def test_path_traversal_is_blocked(project: ws.Workspace) -> None:
    with pytest.raises(ws.WorkspaceError):
        ws.read_file(project, "../secret.txt")
    with pytest.raises(ws.WorkspaceError):
        ws.write_file(project, "../../outside.txt", "x")
    with pytest.raises(ws.WorkspaceError):
        ws.read_file(project, str(project.root.parent / "outside.txt"))


def test_create_and_move(project: ws.Workspace) -> None:
    ws.create_file(project, "docs/note.txt", "текст")
    moved = ws.move_path(project, "docs/note.txt", "docs/note2.txt")
    assert moved["to"] == "docs/note2.txt"
    assert (project.root / "docs" / "note2.txt").exists()
    with pytest.raises(ws.WorkspaceError):
        ws.create_file(project, "docs/note2.txt", "дубль")


def test_terminal_runs_inside_project(project: ws.Workspace) -> None:
    result = ws.run_command(project, "python -c \"print(2+2)\"", timeout=20)
    assert result["exit_code"] == 0
    assert "4" in result["output"]
    assert result["cwd"] == str(project.root)


def test_search_files(project: ws.Workspace) -> None:
    found = ws.search_files(project, "привет")
    assert found
    assert found[0]["path"] == "src/main.py"
    assert found[0]["line"] == 1


def test_binary_file_rejected(project: ws.Workspace) -> None:
    (project.root / "image.bin").write_bytes(b"\x00\x01\x02")
    with pytest.raises(ws.WorkspaceError):
        ws.read_file(project, "image.bin")
