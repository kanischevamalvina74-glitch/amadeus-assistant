"""Проект пользователя: папка, дерево файлов, редактор и терминал.

Все пути проверяются через resolve() и общий корень проекта. Наружу из корня
выйти нельзя: ни «../», ни абсолютным путём, ни символической ссылкой.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .proc import hidden_console

IGNORED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "target", "dist", "build", ".next", ".cache", ".pytest_cache", ".idea",
    ".vscode", "site-packages",
}
TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".rst", ".json", ".jsonl", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".csv", ".tsv", ".sql", ".py", ".pyi", ".js",
    ".jsx", ".ts", ".tsx", ".css", ".scss", ".html", ".htm", ".xml", ".svg",
    ".rs", ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".sh",
    ".ps1", ".bat", ".cmd", ".env", ".example", ".gitignore", ".dockerfile",
}
MAX_READ_BYTES = 1_000_000
MAX_TREE_ENTRIES = 2_000
MAX_TERMINAL_OUTPUT = 60_000
DEFAULT_TERMINAL_TIMEOUT = 30.0


class WorkspaceError(RuntimeError):
    """Ошибка проекта, которую можно показать пользователю."""


@dataclass(frozen=True)
class Workspace:
    root: Path

    @property
    def name(self) -> str:
        return self.root.name or str(self.root)


def _inside(root: Path, target: Path) -> bool:
    try:
        return os.path.commonpath([str(root), str(target)]) == str(root)
    except ValueError:  # разные диски на Windows
        return False


def resolve_root(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise WorkspaceError("Нужен абсолютный путь к папке проекта")
    if not path.exists():
        raise WorkspaceError("Папка проекта не найдена")
    if not path.is_dir():
        raise WorkspaceError("Выбранный путь — не папка")
    return path.resolve()


def _safe_relative(workspace: Workspace, relative: str) -> Path:
    if not relative or relative.strip() in {".", ".."}:
        raise WorkspaceError("Пустой путь")
    candidate = (workspace.root / relative).expanduser()
    try:
        resolved = candidate.resolve(strict=False)
    except OSError as exc:
        raise WorkspaceError("Путь не разрешается") from exc
    if not _inside(workspace.root, resolved):
        raise WorkspaceError("Путь выходит за пределы проекта")
    return resolved


def tree(workspace: Workspace, limit: int = MAX_TREE_ENTRIES) -> list[dict[str, Any]]:
    """Плоский список файлов и папок проекта, без мусорных каталогов."""
    entries: list[dict[str, Any]] = []
    for current, dirs, files in os.walk(workspace.root):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED_DIRS and not d.startswith("."))
        relative_dir = Path(current).relative_to(workspace.root)
        for name in sorted(files):
            if name.startswith(".") and name not in {".env.example", ".gitignore"}:
                continue
            path = Path(current) / name
            try:
                stat = path.stat()
            except OSError:
                continue
            entries.append(
                {
                    "path": str(relative_dir / name).replace("\\", "/"),
                    "kind": "file",
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "text": path.suffix.lower() in TEXT_SUFFIXES,
                }
            )
            if len(entries) >= limit:
                return entries
        for name in dirs:
            path = Path(current) / name
            entries.append(
                {
                    "path": str(relative_dir / name).replace("\\", "/"),
                    "kind": "dir",
                    "size": 0,
                    "mtime": 0,
                    "text": False,
                }
            )
            if len(entries) >= limit:
                return entries
    return entries


def read_file(workspace: Workspace, relative: str) -> dict[str, Any]:
    path = _safe_relative(workspace, relative)
    if not path.is_file():
        raise WorkspaceError("Файл не найден")
    size = path.stat().st_size
    if size > MAX_READ_BYTES:
        raise WorkspaceError("Файл больше 1 МБ — откройте его во внешнем редакторе")
    raw = path.read_bytes()
    if b"\x00" in raw[:4096]:
        raise WorkspaceError("Это двоичный файл, редактор его не откроет")
    for encoding in ("utf-8", "utf-8-sig", "cp1251"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise WorkspaceError("Не удалось определить кодировку файла")
    return {
        "path": str(path.relative_to(workspace.root)).replace("\\", "/"),
        "text": text,
        "size": size,
        "encoding": encoding,
        "mtime": int(path.stat().st_mtime),
    }


def write_file(workspace: Workspace, relative: str, text: str) -> dict[str, Any]:
    if len(text.encode("utf-8")) > MAX_READ_BYTES:
        raise WorkspaceError("Файл больше 1 МБ — сохраните его другим способом")
    path = _safe_relative(workspace, relative)
    if path.exists() and path.is_dir():
        raise WorkspaceError("По этому пути находится папка")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".amadeus-tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temporary, path)
    return {"path": str(path.relative_to(workspace.root)).replace("\\", "/"), "size": path.stat().st_size}


def create_file(workspace: Workspace, relative: str, text: str = "") -> dict[str, Any]:
    path = _safe_relative(workspace, relative)
    if path.exists():
        raise WorkspaceError("Файл уже существует")
    return write_file(workspace, relative, text)


def move_path(workspace: Workspace, source: str, target: str) -> dict[str, Any]:
    src = _safe_relative(workspace, source)
    dst = _safe_relative(workspace, target)
    if not src.exists():
        raise WorkspaceError("Источник не найден")
    if dst.exists():
        raise WorkspaceError("Цель уже существует")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    return {
        "from": str(src.relative_to(workspace.root)).replace("\\", "/"),
        "to": str(dst.relative_to(workspace.root)).replace("\\", "/"),
    }


def open_path(workspace: Workspace, relative: str) -> dict[str, Any]:
    path = _safe_relative(workspace, relative)
    if not path.exists():
        raise WorkspaceError("Путь не найден")
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif shutil.which("open"):
        subprocess.Popen(["open", str(path)])  # noqa: S603
    else:
        subprocess.Popen(["xdg-open", str(path)])  # noqa: S603
    return {"ok": True, "message": f"Открыто: {relative}"}


def _decode_output(raw: bytes) -> str:
    for encoding in ("utf-8", "cp866", "cp1251"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def run_command(
    workspace: Workspace,
    command: str,
    timeout: float = DEFAULT_TERMINAL_TIMEOUT,
) -> dict[str, Any]:
    """Выполняет команду оболочки в папке проекта с ограничением по времени."""
    command = command.strip()
    if not command:
        raise WorkspaceError("Пустая команда")
    if len(command) > 2_000:
        raise WorkspaceError("Команда слишком длинная")
    timeout = max(1.0, min(float(timeout), 300.0))
    started = time.monotonic()
    try:
        completed = subprocess.run(  # noqa: S602 — терминал по определению выполняет команды
            command,
            cwd=str(workspace.root),
            shell=True,
            capture_output=True,
            timeout=timeout,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            **hidden_console(),  # type: ignore[arg-type]
        )
        output = _decode_output(completed.stdout)
        errors = _decode_output(completed.stderr)
        timed_out = False
        code = completed.returncode
    except subprocess.TimeoutExpired as exc:
        output = _decode_output(exc.stdout or b"")
        errors = f"Превышено время выполнения: {timeout:g} с"
        timed_out = True
        code = -1
    return {
        "command": command,
        "exit_code": code,
        "output": output[-MAX_TERMINAL_OUTPUT:],
        "errors": errors[-MAX_TERMINAL_OUTPUT:],
        "timed_out": timed_out,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "cwd": str(workspace.root),
    }


def search_files(workspace: Workspace, query: str, limit: int = 100) -> list[dict[str, Any]]:
    """Поиск по именам и тексту небольших файлов проекта."""
    needle = query.strip().lower()
    if not needle:
        return []
    found: list[dict[str, Any]] = []
    for entry in tree(workspace):
        if entry["kind"] != "file":
            continue
        if needle in entry["path"].lower():
            found.append({"path": entry["path"], "line": 0, "preview": entry["path"]})
        elif entry["text"] and entry["size"] <= MAX_READ_BYTES:
            try:
                text = read_file(workspace, entry["path"])["text"]
            except WorkspaceError:
                continue
            for number, line in enumerate(text.splitlines(), start=1):
                if needle in line.lower():
                    found.append(
                        {"path": entry["path"], "line": number, "preview": line.strip()[:200]}
                    )
                    break
        if len(found) >= limit:
            break
    return found


def iter_relative_files(workspace: Workspace) -> Iterable[str]:
    for entry in tree(workspace):
        if entry["kind"] == "file":
            yield entry["path"]
