from __future__ import annotations

import asyncio
import math
import struct
from array import array

import pytest
from fastapi.testclient import TestClient

from core import voice
from core.app import app


class FakeSTT:
    async def transcribe(self, pcm: bytes) -> str:
        return "привет ассистент"


class FakeTTS:
    async def synthesize(self, text: str) -> bytes:
        return b"RIFFfake-wav"


def test_energy_vad_distinguishes_silence_and_speech() -> None:
    vad = voice.EnergyVAD(threshold=320)
    silence = array("h", [0] * (voice.FRAME_BYTES // 2)).tobytes()
    speech = array("h", [12000] * (voice.FRAME_BYTES // 2)).tobytes()
    assert vad.is_speech(silence) is False
    assert vad.is_speech(speech) is True


def test_silero_adapter_detects_speech() -> None:
    pytest.importorskip("silero_vad")
    pytest.importorskip("numpy")
    vad = voice.SileroVAD()
    silence = b"\x00\x00" * 3000
    speech = b"".join(
        struct.pack("<h", int(9000 * math.sin(2 * math.pi * 220 * i / voice.SAMPLE_RATE)))
        for i in range(3000)
    )
    assert not any(vad.is_speech(silence[i : i + voice.FRAME_BYTES]) for i in range(0, len(silence), voice.FRAME_BYTES))
    detector = voice.SileroVAD()
    assert any(detector.is_speech(speech[i : i + voice.FRAME_BYTES]) for i in range(0, len(speech), voice.FRAME_BYTES))


def test_pipeline_emits_full_voice_cycle() -> None:
    events: list[voice.VoiceEvent] = []

    async def emit(event: voice.VoiceEvent) -> None:
        events.append(event)

    async def reply(text: str) -> str:
        assert text == "привет ассистент"
        return "Здравствуйте!"

    pipeline = voice.VoicePipeline(voice.EnergyVAD(), FakeSTT(), FakeTTS(), reply, emit)
    asyncio.run(pipeline.process_utterance(b"\x00" * voice.FRAME_BYTES))

    types = [event.type for event in events]
    assert "listening_end" in types
    assert "transcript" in types
    assert "token" in types
    assert "audio" in types
    assert next(event for event in events if event.type == "transcript").data["text"] == "привет ассистент"


def test_text_command_screenshot_without_model(monkeypatch) -> None:
    """Голосовая команда «скриншот» выполняется локально, без вызова модели."""
    events: list[voice.VoiceEvent] = []

    async def emit(event: voice.VoiceEvent) -> None:
        events.append(event)

    async def reply(_text: str) -> str:
        raise AssertionError("модель не должна вызываться для локальной команды")

    monkeypatch.setattr("core.system.screenshot", lambda region=None: b"\x89PNG-local")
    pipeline = voice.VoicePipeline(voice.EnergyVAD(), FakeSTT(), FakeTTS(), reply, emit)
    asyncio.run(pipeline.process_text("сделай скриншот"))

    types = [event.type for event in events]
    assert "screenshot" in types
    assert "token" in types
    shot = next(event for event in events if event.type == "screenshot")
    assert shot.data["mime"] == "image/png"
    assert shot.data["content_base64"]


def test_piper_synthesizes_russian(monkeypatch) -> None:
    """Piper с русской моделью Ирины выдаёт настоящий WAV."""
    import shutil
    from pathlib import Path

    model = Path(__file__).resolve().parents[1] / "data/models/piper/ru_RU-irina-medium.onnx"
    if not model.exists() or shutil.which("piper") is None:
        pytest.skip("Piper или модель не установлены")
    monkeypatch.setenv("AMADEUS_TTS", "piper")
    monkeypatch.setenv("AMADEUS_PIPER_MODEL", str(model))
    audio = asyncio.run(voice.build_tts().synthesize("Привет, это проверка Piper."))
    assert audio.startswith(b"RIFF")
    assert len(audio) > 1000


def test_barge_in_interrupts_speaking() -> None:
    events: list[voice.VoiceEvent] = []

    async def emit(event: voice.VoiceEvent) -> None:
        events.append(event)

    async def reply(_text: str) -> str:
        return "ответ"

    class AlwaysSpeech:
        def is_speech(self, _frame: bytes) -> bool:
            return True

    pipeline = voice.VoicePipeline(AlwaysSpeech(), FakeSTT(), FakeTTS(), reply, emit)
    pipeline._speaking = True
    asyncio.run(pipeline.on_frame(b"\x01" * voice.FRAME_BYTES))
    assert any(event.type == "barge_in" for event in events)
    assert pipeline._speaking is False


@pytest.mark.skipif(
    __import__("os").getenv("AMADEUS_STT_SMOKE") != "1",
    reason="тяжёлый тест: требует скачанную модель Whisper",
)
def test_whisper_stt_roundtrip_with_system_tts() -> None:
    """TTS synthesize → resample → STT: проверяем живой локальный каскад."""
    import io
    import wave

    import numpy as np

    from core.voice import SAMPLE_RATE, SystemTTS, WhisperSTT

    phrase = "Привет, это проверка локального распознавания речи."
    wav_bytes = asyncio.run(SystemTTS().synthesize(phrase))
    with wave.open(io.BytesIO(wav_bytes)) as wav:
        rate = wav.getframerate()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
    if rate != SAMPLE_RATE:
        count = int(len(samples) * SAMPLE_RATE / rate)
        samples = np.interp(
            np.linspace(0, len(samples) - 1, count), np.arange(len(samples)), samples
        ).astype(np.int16)

    text = asyncio.run(WhisperSTT("small", "cpu").transcribe(samples.tobytes()))
    assert "проверка" in text.lower()


def test_websocket_voice_session_accepts_frames() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/voice") as ws:
            silence = array("h", [0] * (voice.FRAME_BYTES // 2)).tobytes()
            for _ in range(3):
                ws.send_bytes(silence)
            ws.send_json({"type": "cancel"})


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("привет", None),
        ("Что такое Python? Расскажи", None),
        ("?????? ????? ??????: ??????", "broken-encoding"),
        ("пр\ufffd\ufffdвет", "broken-encoding"),
        ("Субтитры сделал DimaTorzok", "hallucination"),
        ("Продолжение следует...", "hallucination"),
        ("   ", "empty"),
    ],
)
def test_transcript_problem(text: str, problem: str | None) -> None:
    assert voice.transcript_problem(text) == problem


def test_broken_transcript_does_not_reach_model() -> None:
    class BrokenSTT:
        async def transcribe(self, pcm: bytes) -> str:
            return "?????? ????? ??????: ??????"

    events: list[voice.VoiceEvent] = []
    asked: list[str] = []

    async def emit(event: voice.VoiceEvent) -> None:
        events.append(event)

    async def reply(text: str) -> str:
        asked.append(text)
        return "ответ"

    pipeline = voice.VoicePipeline(voice.EnergyVAD(), BrokenSTT(), FakeTTS(), reply, emit)
    asyncio.run(pipeline.process_utterance(b"\x00" * voice.FRAME_BYTES))
    assert asked == []
    assert [e.type for e in events] == ["listening_end", "error"]
    assert events[-1].data["message"] == "Не расслышал, повторите"
