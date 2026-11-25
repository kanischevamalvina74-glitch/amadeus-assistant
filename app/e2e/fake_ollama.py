"""Заглушка официального API Ollama для e2e: модель отвечает фиксированным текстом."""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M"
CHUNKS = ["Ответ ", "тестовой ", "модели Ollama."]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # noqa: ANN002
        return

    def _send(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/api/tags"):
            self._send(
                json.dumps({"models": [{"name": MODEL}]}).encode(), "application/json"
            )
        else:
            self._send(b'{"error":"not found"}', "application/json", 404)

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/api/chat"):
            self._send(b'{"error":"not found"}', "application/json", 404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            payload = {}
        # Небольшая задержка, чтобы двойной клик попадал в окно busy-guard.
        time.sleep(0.4)
        if payload.get("stream") is False:
            body = json.dumps(
                {"message": {"content": "".join(CHUNKS)}, "done": True}
            ).encode()
        else:
            lines = [
                json.dumps({"message": {"content": chunk}, "done": False})
                for chunk in CHUNKS
            ]
            lines.append(json.dumps({"message": {"content": ""}, "done": True}))
            body = ("\n".join(lines) + "\n").encode()
        self._send(body, "application/x-ndjson")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 11434), Handler).serve_forever()
