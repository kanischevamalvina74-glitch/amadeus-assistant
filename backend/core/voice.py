"""Голосовой каскад: SILERO VAD → STT → LLM → TTS, с barge-in.

Провайдеры независимы и выбираются env. Модели загружаются лениво: при их
отсутствии ядро работает с запасными адаптерами и честно сообщает об этом.
Аудио: PCM 16 кГц, 16 бит, моно, кадры 20 мс.
"""

from __future__ import annotations

import asyncio
import math
import os
import tempfile
from array import array
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable, Protocol

SAMPLE_RATE = 16_000
FRAME_MS = 20
FRAME_BYTES = SAMPLE_RATE * FRAME_MS // 1000 * 2


@dataclass
class VoiceEvent:
    type: str
    data: dict = field(default_factory=dict)

    def as_json(self) -> str:
        import json

        return json.dumps({"event": self.type, **self.data}, ensure_ascii=False)


class VAD(Protocol):
    def is_speech(self, frame: bytes) -> bool: ...


class STT(Protocol):
    async def transcribe(self, pcm: bytes) -> str: ...


class TTS(Protocol):
    async def synthesize(self, text: str) -> bytes: ...


class EnergyVAD:
    """Запасной VAD без моделей: порог по RMS. Работает офлайн из коробки."""

    def __init__(self, threshold: int = 320) -> None:
        self.threshold = threshold

    def is_speech(self, frame: bytes) -> bool:
        if len(frame) < 2:
            return False
        samples = array("h")
        samples.frombytes(frame[: len(frame) // 2 * 2])
        if not samples:
            return False
        rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
        return rms > self.threshold


class SileroVAD:
    """Silero VAD через официальный пакет; модель грузится при первом кадре."""

    def __init__(self, threshold: float = 0.5) -> None:
        self.threshold = threshold
        self._model = None
        self._buffer = bytearray()

    def _load(self):
        if self._model is None:
            import torch
            from silero_vad import load_silero_vad

            self._model = load_silero_vad()
            self._torch = torch
        return self._model

    def is_speech(self, frame: bytes) -> bool:
        try:
            import numpy as np

            # Silero ожидает 512 отсчётов (32 мс при 16 кГц), поэтому копируем
            # 20-миллисекундные кадры во внутренний буфер.
            self._buffer.extend(frame)
            needed = 512 * 2
            if len(self._buffer) < needed:
                return False
            chunk = bytes(self._buffer[:needed])
            del self._buffer[:needed]

            model = self._load()
            samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
            tensor = self._torch.from_numpy(samples)
            return float(model(tensor, SAMPLE_RATE).item()) > self.threshold
        except Exception:
            return False


class WhisperSTT:
    """faster-whisper с локальной моделью; без модели возвращает понятную ошибку."""

    def __init__(self, model_id: str, device: str = "cpu") -> None:
        self.model_id = model_id
        self.device = device
        self._model = None

    def _transcribe(self, pcm: bytes) -> str:
        import numpy as np
        from faster_whisper import WhisperModel

        if self._model is None:
            self._model = WhisperModel(self.model_id, device=self.device, compute_type="int8")
        # numpy-массив вместо пути: не дёргаем PyAV, который несовместим с Python 3.14.
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = self._model.transcribe(audio, language="ru", vad_filter=True)
        return " ".join(segment.text.strip() for segment in segments).strip()

    async def transcribe(self, pcm: bytes) -> str:
        try:
            return await asyncio.to_thread(self._transcribe, pcm)
        except ImportError as exc:
            raise RuntimeError("faster-whisper не установлен: pip install faster-whisper") from exc


class SystemTTS:
    """Офлайн-синтез через системный движок (SAPI5 на Windows)."""

    def __init__(self, voice_id: str | None = None) -> None:
        self.voice_id = voice_id

    def _synthesize(self, text: str, path: str) -> None:
        import pyttsx3

        engine = pyttsx3.init()
        if self.voice_id:
            engine.setProperty("voice", self.voice_id)
        engine.save_to_file(text, path)
        engine.runAndWait()

    async def synthesize(self, text: str) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            await asyncio.to_thread(self._synthesize, text, path)
            return Path(path).read_bytes()
        except ImportError as exc:
            raise RuntimeError("pyttsx3 не установлен") from exc
        finally:
            Path(path).unlink(missing_ok=True)


def list_system_voices() -> list[dict[str, str]]:
    """Голоса системного движка с идентификаторами для настройки."""
    try:
        import pyttsx3

        engine = pyttsx3.init()
        voices = engine.getProperty("voices") or []
        return [
            {
                "id": str(voice.id),
                "name": str(voice.name),
                "locale": str((getattr(voice, "languages", None) or ["ru"])[0]),
            }
            for voice in voices
        ]
    except Exception:
        return []


class PiperTTS:
    """Офлайн-синтез Piper через официальный CLI и локальную модель голоса."""

    def __init__(self, binary: str, model_path: str) -> None:
        self.binary = binary
        self.model_path = model_path

    def _synthesize(self, text: str, path: str) -> None:
        import subprocess

        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as source:
            source.write(text)
            source_path = source.name
        try:
            result = subprocess.run(
                [self.binary, "-m", self.model_path, "-i", source_path, "-f", path],
                capture_output=True,
                timeout=60,
                check=False,
            )
        finally:
            Path(source_path).unlink(missing_ok=True)
        if result.returncode != 0 or not Path(path).exists():
            raise RuntimeError(result.stderr.decode("utf-8", errors="replace")[:300] or "Piper не ответил")

    async def synthesize(self, text: str) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            await asyncio.to_thread(self._synthesize, text, path)
            return Path(path).read_bytes()
        finally:
            Path(path).unlink(missing_ok=True)


WAKE_WORDS = ("амадеус", "амадей", "amadeus", "амадиус")

_STT_CACHE: dict[tuple[str, str], WhisperSTT] = {}


def shared_stt() -> WhisperSTT:
    """Одна модель Whisper на процесс: голосовая сессия и wake-word не дублируют память."""
    key = (os.getenv("AMADEUS_STT_MODEL", "small"), os.getenv("AMADEUS_STT_DEVICE", "cpu"))
    if key not in _STT_CACHE:
        _STT_CACHE[key] = WhisperSTT(key[0], key[1])
    return _STT_CACHE[key]


def has_wake_word(text: str) -> bool:
    normalized = text.strip().lower()
    return any(word in normalized for word in WAKE_WORDS)


class VoicePipeline:
    def __init__(
        self,
        vad: VAD,
        stt: STT,
        tts: TTS,
        reply: Callable[[str], Awaitable[str]],
        emit: Callable[[VoiceEvent], Awaitable[None]],
    ) -> None:
        self.vad = vad
        self.stt = stt
        self.tts = tts
        self.reply = reply
        self.emit = emit
        self._speaking = False
        self._tts_task: asyncio.Task | None = None

    async def on_frame(self, frame: bytes) -> None:
        if self._speaking and self.vad.is_speech(frame):
            await self.emit(VoiceEvent("barge_in"))
            if self._tts_task:
                self._tts_task.cancel()
            self._speaking = False
            return
        # Буфер рамки здесь ведёт вызывающая сторона; кадр используется для VAD.
        if self.vad.is_speech(frame):
            await self.emit(VoiceEvent("speech_detected"))

    async def process_text(self, text: str) -> None:
        """Текстовый вход в той же сессии (клавиша W без микрофона)."""
        text = text.strip()
        if not text:
            return
        await self.emit(VoiceEvent("transcript", {"text": text}))
        if await self._local_command(text):
            return
        await self._answer(text)

    async def process_utterance(self, pcm: bytes) -> None:
        await self.emit(VoiceEvent("listening_end"))
        text = await self.stt.transcribe(pcm)
        if not text:
            await self.emit(VoiceEvent("error", {"message": "Речь не распознана"}))
            return
        await self.emit(VoiceEvent("transcript", {"text": text}))
        if await self._local_command(text):
            return
        await self._answer(text)

    async def _local_command(self, text: str) -> bool:
        """Команды, которые выполняются локально без обращения к модели."""
        normalized = text.lower()
        if "скриншот" not in normalized and "снимок экрана" not in normalized:
            return False
        try:
            import base64

            from . import system as system_module

            png = system_module.screenshot()
            await self.emit(
                VoiceEvent(
                    "screenshot",
                    {
                        "content_base64": base64.b64encode(png).decode("ascii"),
                        "mime": "image/png",
                    },
                )
            )
            answer = "Снимок экрана готов."
        except Exception as exc:
            answer = f"Не удалось снять экран: {exc}"
        await self.emit(VoiceEvent("token", {"text": answer}))
        return True

    async def _answer(self, text: str) -> None:
        answer = await self.reply(text)
        await self.emit(VoiceEvent("token", {"text": answer}))

        self._speaking = True
        try:
            audio = await self.tts.synthesize(answer)

            async def send_audio() -> None:
                import base64

                await self.emit(VoiceEvent("audio", {"wav_base64": base64.b64encode(audio).decode("ascii")}))

            self._tts_task = asyncio.create_task(send_audio())
            await self._tts_task
        except asyncio.CancelledError:
            await self.emit(VoiceEvent("canceled"))
        finally:
            self._speaking = False
            self._tts_task = None


def build_tts(voice_id: str | None = None) -> TTS:
    mode = os.getenv("AMADEUS_TTS", "system")
    if mode == "piper":
        binary = os.getenv("AMADEUS_PIPER_BIN", "piper")
        model = os.getenv("AMADEUS_PIPER_MODEL", "")
        if model and Path(model).exists():
            return PiperTTS(binary, model)
    return SystemTTS(voice_id or os.getenv("AMADEUS_TTS_VOICE") or None)


def build_pipeline(
    settings,
    reply: Callable[[str], Awaitable[str]],
    emit: Callable[[VoiceEvent], Awaitable[None]],
    voice_id: str | None = None,
) -> VoicePipeline:
    vad_mode = os.getenv("AMADEUS_VAD", "energy")
    vad: VAD = SileroVAD() if vad_mode == "silero" else EnergyVAD()
    return VoicePipeline(vad, shared_stt(), build_tts(voice_id), reply, emit)
