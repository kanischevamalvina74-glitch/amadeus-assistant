"""Веб-поиск через официальные API и чтение страниц без сторонних библиотек.

Провайдеры:
- Brave Search API (официальный, ключ пользователя);
- SearXNG (собственный или доверенный инстанс, JSON-API).

Поиск не работает «из коробки» без провайдера: это осознанно, чтобы не
отправлять запросы пользователя в неизвестный сервис. Чтение страниц запрещено
для локальных и приватных адресов — защита от SSRF.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from html import unescape
from typing import Any
from urllib.parse import urlparse

import httpx

MAX_PAGE_BYTES = 400_000
MAX_SNIPPET = 600
TAG_RE = re.compile(r"<[^>]+>")
SCRIPT_RE = re.compile(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>")
SPACE_RE = re.compile(r"[ \t\r\f\v]+")


class SearchError(RuntimeError):
    """Понятная пользователю ошибка поиска."""


def _check_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise SearchError("Разрешены только http(s)-адреса")
    host = parsed.hostname or ""
    if not host:
        raise SearchError("В адресе нет хоста")
    lowered = host.lower()
    if lowered in {"localhost", "localhost.localdomain"} or lowered.endswith(".local"):
        raise SearchError("Локальные адреса запрещены")
    try:
        address = ipaddress.ip_address(lowered)
    except ValueError:
        try:
            address = ipaddress.ip_address(socket.gethostbyname(lowered))
        except (OSError, ValueError) as exc:
            raise SearchError("Не удалось разрешить имя хоста") from exc
    if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
        raise SearchError("Приватные и служебные адреса запрещены")


async def brave_search(query: str, api_key: str, count: int = 5, client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
    if not api_key:
        raise SearchError("Не сохранён ключ Brave Search")
    owns = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    try:
        response = await http.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": max(1, min(count, 10)), "text_decorations": "false"},
            headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
        )
        if response.status_code == 401:
            raise SearchError("Brave Search отклонил ключ (401)")
        if response.status_code == 429:
            raise SearchError("Лимит Brave Search исчерпан (429)")
        response.raise_for_status()
        payload = response.json()
        return [
            {
                "title": _clean(item.get("title", "")),
                "url": item.get("url", ""),
                "description": _clean(item.get("description", ""))[:MAX_SNIPPET],
                "provider": "brave",
            }
            for item in payload.get("web", {}).get("results", [])[:count]
            if item.get("url")
        ]
    except httpx.HTTPError as exc:
        raise SearchError(f"Поиск недоступен: {exc.__class__.__name__}") from exc
    finally:
        if owns:
            await http.aclose()


async def searx_search(query: str, base_url: str, count: int = 5, client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
    if not base_url.startswith(("http://", "https://")):
        raise SearchError("Некорректный адрес SearXNG")
    owns = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    try:
        response = await http.get(
            f"{base_url.rstrip('/')}/search",
            params={"q": query, "format": "json", "language": "ru"},
        )
        response.raise_for_status()
        payload = response.json()
        return [
            {
                "title": _clean(item.get("title", "")),
                "url": item.get("url", ""),
                "description": _clean(item.get("content", ""))[:MAX_SNIPPET],
                "provider": "searxng",
            }
            for item in payload.get("results", [])[:count]
            if item.get("url")
        ]
    except (httpx.HTTPError, ValueError) as exc:
        raise SearchError(f"SearXNG недоступен: {exc.__class__.__name__}") from exc
    finally:
        if owns:
            await http.aclose()


async def search(
    query: str,
    *,
    provider: str,
    api_key: str = "",
    base_url: str = "",
    count: int = 5,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    query = query.strip()
    if len(query) < 2:
        raise SearchError("Слишком короткий запрос")
    if len(query) > 400:
        raise SearchError("Слишком длинный запрос")
    if provider == "brave":
        results = await brave_search(query, api_key, count, client)
    elif provider == "searxng":
        results = await searx_search(query, base_url, count, client)
    else:
        raise SearchError(
            "Поиск в интернете выключен. Включите его в настройках, если хотите узнавать свежие события."
        )
    return {"query": query, "provider": provider, "results": results}


async def fetch_page(url: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    _check_host(url)
    owns = client is None
    http = client or httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=6.0),
        follow_redirects=True,
        headers={"User-Agent": "AmadeusAssistant/0.1 (local assistant)"},
    )
    try:
        response = await http.get(url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "html" not in content_type and "text" not in content_type and "json" not in content_type:
            raise SearchError("Страница не является текстом")
        raw = response.content[:MAX_PAGE_BYTES]
        charset = response.encoding or "utf-8"
        try:
            html = raw.decode(charset, errors="replace")
        except LookupError:
            html = raw.decode("utf-8", errors="replace")
        text = _html_to_text(html)
        return {
            "url": str(response.url),
            "title": _extract_title(html),
            "text": text[:30_000],
        }
    except httpx.HTTPError as exc:
        raise SearchError(f"Страница недоступна: {exc.__class__.__name__}") from exc
    finally:
        if owns:
            await http.aclose()


def _clean(text: str) -> str:
    return SPACE_RE.sub(" ", unescape(TAG_RE.sub(" ", text or ""))).strip()


def _html_to_text(html: str) -> str:
    without_scripts = SCRIPT_RE.sub(" ", html)
    text = TAG_RE.sub("\n", without_scripts)
    text = unescape(text)
    lines = [SPACE_RE.sub(" ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _extract_title(html: str) -> str:
    match = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    return _clean(match.group(1)) if match else ""
