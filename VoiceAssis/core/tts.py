"""
core/tts.py — Text to Speech using edge-tts (Microsoft, free, natural voice)

edge-tts uses Microsoft Edge's online TTS — completely free, no API key.
Falls back to pyttsx3 if edge-tts fails.
"""

import logging
import asyncio
import os
import uuid
import time
import threading
from pathlib import Path
from config import AUDIO_RESP_DIR

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────
# Voice Options (edge-tts)
# ─────────────────────────────────────────
# Natural female voices — pick one:
# "en-IN-NeerjaNeural"      ← Indian English female (recommended for this bot)
# "en-US-JennyNeural"       ← US English female, very natural
# "en-GB-SoniaNeural"       ← British English female
# "en-IN-PrabhatNeural"     ← Indian English male
EDGE_VOICE = "en-IN-NeerjaNeural"


# ─────────────────────────────────────────
# edge-tts Synthesis (async)
# ─────────────────────────────────────────
async def _synthesize_edge(text: str, output_path: str, voice: str) -> bool:
    """Synthesize speech using edge-tts."""
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(output_path)
        logger.info(f"edge-tts saved: {output_path} (Voice: {voice})")
        return True
    except Exception as e:
        logger.warning(f"edge-tts failed: {e}")
        return False


# ─────────────────────────────────────────
# pyttsx3 Fallback
# ─────────────────────────────────────────
def _synthesize_pyttsx3(text: str, output_path: str) -> bool:
    """Fallback TTS using pyttsx3 (local Windows voices)."""
    try:
        import pyttsx3
        engine = pyttsx3.init()
        engine.setProperty("rate", 155)
        engine.setProperty("volume", 0.9)

        # Try to find a better voice
        voices = engine.getProperty("voices")
        for voice in voices:
            if "female" in voice.name.lower() or "zira" in voice.name.lower():
                engine.setProperty("voice", voice.id)
                break

        engine.save_to_file(text, output_path)
        engine.runAndWait()
        logger.info(f"pyttsx3 saved: {output_path}")
        return True
    except Exception as e:
        logger.error(f"pyttsx3 also failed: {e}")
        return False


# ─────────────────────────────────────────
# Text Cleaning
# ─────────────────────────────────────────
def _clean_text(text: str) -> str:
    """Clean text before TTS — remove markdown, emoji, etc."""
    import re
    text = re.sub(r"\*{1,2}(.*?)\*{1,2}", r"\1", text)  # Remove bold/italic
    text = re.sub(r"[^\x00-\x7F]+", " ", text)           # Remove emoji
    text = re.sub(r"\s+", " ", text).strip()              # Collapse spaces
    text = re.sub(r"\.{3,}", ".", text)                   # Fix ellipses
    return text


# ─────────────────────────────────────────
# URL Helper
# ─────────────────────────────────────────
def _path_to_url(path: str) -> str:
    p = Path(path)
    try:
        relative = p.relative_to(Path(__file__).parent.parent)
        return "/" + str(relative).replace("\\", "/")
    except ValueError:
        return "/audio/responses/response.wav"


# ─────────────────────────────────────────
# Cleanup old response files (keep last 5)
# ─────────────────────────────────────────
def _cleanup_old_responses():
    """Delete old response audio files, keeping only the 5 most recent."""
    try:
        files = sorted(
            AUDIO_RESP_DIR.glob("response_*.mp3"),
            key=lambda p: p.stat().st_mtime
        )
        for old in files[:-5]:
            try:
                old.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception:
        pass


# ─────────────────────────────────────────
# Main Synthesize Function
# ─────────────────────────────────────────
def synthesize(text: str, output_path: str = None, language: str = "en") -> dict:
    """
    Convert text to speech audio file.
    Tries edge-tts first (natural voice), falls back to pyttsx3.
    Each call generates a UNIQUE filename to prevent browser caching.
    """
    VOICE_MAP = {
        "ta": "ta-IN-PallaviNeural",
        "hi": "hi-IN-SwaraNeural",
        "te": "te-IN-ShrutiNeural",
        "ml": "ml-IN-SobhanaNeural",
        "mr": "mr-IN-AarohiNeural",
        "bn": "bn-IN-TanishaaNeural",
        "gu": "gu-IN-DhwaniNeural",
        "kn": "kn-IN-SapnaNeural",
        "en": "en-IN-NeerjaNeural",
    }
    voice = VOICE_MAP.get(language[:2].lower(), "en-IN-NeerjaNeural")

    if not output_path:
        # Unique filename per response — prevents browser caching old audio
        unique_id = uuid.uuid4().hex[:8]
        output_path = str(AUDIO_RESP_DIR / f"response_{unique_id}.mp3")

    result = {
        "audio_path": output_path,
        "audio_url":  _path_to_url(output_path),
        "success":    False,
        "engine":     "unknown",
        "error":      None,
    }

    if not text or not text.strip():
        result["error"] = "Empty text"
        return result

    clean = _clean_text(text)

    # Try edge-tts first (natural voice)
    try:
        # FastAPI already runs an event loop, so asyncio.run() will fail.
        # Use a dedicated thread to run edge-tts in its own event loop.
        import concurrent.futures
        def _run_edge():
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(_synthesize_edge(clean, output_path, voice))
            finally:
                loop.close()

        with concurrent.futures.ThreadPoolExecutor() as pool:
            success = pool.submit(_run_edge).result(timeout=15)

        if success and Path(output_path).exists():
            result["success"] = True
            result["engine"]  = "edge-tts"
            # Add cache-busting timestamp to URL
            result["audio_url"] = _path_to_url(output_path) + f"?t={int(time.time())}"
            # Clean up old files in background
            threading.Thread(target=_cleanup_old_responses, daemon=True).start()
            return result
    except Exception as e:
        logger.warning(f"edge-tts error: {e}")

    # Fallback to pyttsx3 (saves as wav since pyttsx3 doesn't do mp3)
    wav_path = output_path.replace(".mp3", ".wav")
    success = _synthesize_pyttsx3(clean, wav_path)
    result["success"] = success
    result["engine"]  = "pyttsx3"
    if success:
        result["audio_path"] = wav_path
        result["audio_url"]  = _path_to_url(wav_path) + f"?t={int(time.time())}"
    else:
        result["error"] = "Both edge-tts and pyttsx3 failed"

    return result


def get_audio_duration_seconds(audio_path: str) -> float:
    try:
        import wave
        with wave.open(audio_path, "r") as wav:
            return wav.getnframes() / float(wav.getframerate())
    except Exception:
        return 0.0