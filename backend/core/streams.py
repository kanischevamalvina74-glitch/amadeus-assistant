"""Официальные LLM-API: Ollama /api/chat и OpenAI-совместимый /v1/chat/completions.

Никаких приватных эндпоинтов и обходных путей: только публичные контракты.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from .config import Settings

SYSTEM_PROMPT = (
    "Ты — Амадеус, локальный голосовой ассистент на компьютере пользователя. "
    "Отвечай по-русски, кратко и по делу. Если пользователь просит действие с "
    "компьютером, предложи его, но не утверждай, что уже выполнил. "
    "Не выдумывай доступ к файлам или системам."
)

CODING_PROMPT = (
    "Ты — Амадеус в режиме программиста. Отвечай по-русски. "
    "Давай короткие, готовые к вставке фрагменты кода с указанием файла и "
    "объяснением в одну-две строки. Не пересказывай весь файл."
)


def system_prompt(preset: str | None = None) -> str:
    return CODING_PROMPT if preset == "coding" else SYSTEM_PROMPT


async def ollama_chat(
    settings: Settings,
    messages: list[dict[str, str]],
    *,
    stream: bool,
    timeout: httpx.Timeout | None = None,
    client: httpx.AsyncClient | None = None,
    model: str | None = None,
    preset: str | None = None,
) -> AsyncIterator[str]:
    """Стримит содержимое ответа; для stream=False возвращает один чанк."""
    payload = {
        "model": model or settings.ollama_model,
        "messages": [{"role": "system", "content": system_prompt(preset)}, *messages],
        "stream": stream,
        "options": {"temperature": 0.55, "num_ctx": 8192},
    }
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout or httpx.Timeout(120.0, connect=5.0))
    try:
        async with http.stream(
            "POST", f"{settings.ollama_base_url}/api/chat", json=payload
        ) as response:
            response.raise_for_status()
            if not stream:
                await response.aread()
                data = response.json()
                content = data.get("message", {}).get("content", "")
                if content:
                    yield content
                return
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                chunk = json.loads(line)
                if chunk.get("error"):
                    raise RuntimeError(str(chunk["error"])[:500])
                content = chunk.get("message", {}).get("content", "")
                if content:
                    yield content
                if chunk.get("done"):
                    return
    finally:
        if owns_client:
            await http.aclose()


async def openai_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    stream: bool,
    timeout: httpx.Timeout | None = None,
    client: httpx.AsyncClient | None = None,
    preset: str | None = None,
) -> AsyncIterator[str]:
    """OpenAI-совместимый чат: /v1/chat/completions, Bearer-ключ пользователя."""
    if not base_url.startswith(("http://", "https://")):
        raise RuntimeError("Некорректный base_url провайдера")
    if not model:
        raise RuntimeError("Не выбрана модель OpenAI-совместимого провайдера")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt(preset)}, *messages],
        "stream": stream,
        "temperature": 0.55,
    }
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout or httpx.Timeout(120.0, connect=8.0))
    try:
        if not stream:
            response = await http.post(
                f"{base_url.rstrip('/')}/v1/chat/completions", json=payload, headers=headers
            )
            response.raise_for_status()
            data = response.json()
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if content:
                yield str(content)
            return
        async with http.stream(
            "POST",
            f"{base_url.rstrip('/')}/v1/chat/completions",
            json=payload,
            headers=headers,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    return
                try:
                    chunk = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                content = delta.get("content")
                if content:
                    yield str(content)
    finally:
        if owns_client:
            await http.aclose()


async def chat(
    settings: Settings,
    messages: list[dict[str, str]],
    *,
    stream: bool,
    provider: dict[str, Any] | None = None,
    api_key: str = "",
    timeout: httpx.Timeout | None = None,
    client: httpx.AsyncClient | None = None,
    preset: str | None = None,
) -> AsyncIterator[str]:
    """Единая точка входа: выбирает адаптер по активной конфигурации провайдера."""
    provider = provider or {}
    provider_id = str(provider.get("provider_id") or "ollama")
    model = str(provider.get("model_id") or "") or None
    if provider_id in {"ollama", "local"} and not provider.get("base_url"):
        async for chunk in ollama_chat(
            settings, messages, stream=stream, timeout=timeout, client=client,
            model=model, preset=preset,
        ):
            yield chunk
        return

    base_url = str(provider.get("base_url") or "")
    if not base_url or provider_id.startswith("local"):
        # Локальные и неизвестные провайдеры без адреса идут во встроенную Ollama.
        # Старые записи provider_configs не должны ломать чат и голос.
        async for chunk in ollama_chat(
            settings, messages, stream=stream, timeout=timeout, client=client,
            model=model, preset=preset,
        ):
            yield chunk
        return
    if provider_id in {"openai", "openai-compatible", "custom", "groq", "deepseek"}:
        async for chunk in openai_chat(
            base_url, api_key, model or "", messages, stream=stream, timeout=timeout,
            client=client, preset=preset,
        ):
            yield chunk
        return
    raise RuntimeError(f"Провайдер {provider_id} не поддерживается")
