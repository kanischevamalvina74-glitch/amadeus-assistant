from __future__ import annotations

import asyncio
import json
import time

import httpx

from core import streams
from core.config import Settings


def test_first_token_latency_under_1_5s() -> None:
    """Замер локального каскада с официальным Ollama API и задержкой заглушки 0,4 с."""
    first = json.dumps({"message": {"content": "Ответ "}, "done": False}) + "\n"
    final = json.dumps({"message": {"content": "готов"}, "done": True}) + "\n"

    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.4)
        return httpx.Response(200, text=first + final)

    async def measure() -> tuple[float, str]:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        started = time.perf_counter()
        answer = ""
        async for chunk in streams.chat(
            Settings.from_env(),
            [{"role": "user", "content": "привет"}],
            stream=True,
            client=client,
        ):
            if not answer:
                elapsed = time.perf_counter() - started
            answer += chunk
        await client.aclose()
        return elapsed, answer

    elapsed, answer = asyncio.run(measure())
    assert answer == "Ответ готов"
    assert elapsed < 1.5, f"первый токен за {elapsed:.2f} с"
