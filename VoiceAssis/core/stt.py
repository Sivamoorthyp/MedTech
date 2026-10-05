"""
core/stt.py — Speech to Text using OpenAI Whisper
Fixed for Windows: hardcoded ffmpeg path + converts webm → wav
Added: corrupt file detection + minimum size check
"""

import logging
import subprocess
import shutil
import whisper
import os
from pathlib import Path

# NOTE: Avoid forcing a hard-coded ffmpeg path. Prefer environment variable or system PATH.

from config import WHISPER_MODEL, WHISPER_LANGUAGE, WHISPER_DEVICE

logger = logging.getLogger(__name__)

MIN_AUDIO_BYTES = 1000  # Ignore recordings smaller than 1KB (too short / corrupt)

# ─────────────────────────────────────────
# Model Singleton
# ─────────────────────────────────────────
_model = None

def load_model():
    global _model
    if _model is None:
        logger.info(f"Loading Whisper model: '{WHISPER_MODEL}' on {WHISPER_DEVICE}")
        _model = whisper.load_model(WHISPER_MODEL, device=WHISPER_DEVICE)
        logger.info("Whisper model loaded successfully.")
    return _model


# ─────────────────────────────────────────
# ffmpeg Finder
# ─────────────────────────────────────────
def _find_ffmpeg() -> str:
    # Allow users to explicitly set an ffmpeg binary via environment vars
    env_path = os.getenv("FFMPEG_PATH") or os.getenv("FFMPEG_BIN") or os.getenv("FFMPEG")

    candidates = []
    if env_path:
        candidates.append(env_path)

    # prefer system resolution first
    candidates.extend([
        "ffmpeg",
        r"D:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ])

    for cmd in candidates:
        try:
            # If cmd is not an absolute path, try shutil.which to resolve it on PATH
            resolved = cmd
            if not Path(cmd).is_absolute():
                which = shutil.which(cmd)
                if which:
                    resolved = which

            result = subprocess.run([resolved, "-version"], capture_output=True, timeout=5)
            if result.returncode == 0:
                logger.info(f"Found ffmpeg at: {resolved}")
                return resolved
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue

    return None


# ─────────────────────────────────────────
# Audio Conversion
# ─────────────────────────────────────────
def _convert_to_wav(input_path: str) -> str:
    """Convert audio to 16kHz mono WAV for Whisper."""
    wav_path = str(Path(input_path).with_suffix(".wav"))
    ffmpeg   = _find_ffmpeg()

    if not ffmpeg:
        raise FileNotFoundError(
            "ffmpeg not found. Install ffmpeg or set the FFMPEG_PATH/FFMPEG_BIN environment variable pointing to the ffmpeg binary."
        )

    cmd = [
        ffmpeg, "-y",
        "-i", input_path,
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        wav_path
    ]

    proc = subprocess.run(cmd, capture_output=True, timeout=30)

    if proc.returncode != 0:
        error_msg = proc.stderr.decode("utf-8", errors="ignore")
        # Extract just the last meaningful line for cleaner error
        lines = [l for l in error_msg.splitlines() if "Error" in l or "Invalid" in l or "failed" in l]
        short_error = lines[-1] if lines else "Unknown ffmpeg error"
        raise RuntimeError(f"Audio conversion failed: {short_error}")

    logger.info(f"Converted: {input_path} → {wav_path}")
    return wav_path


# ─────────────────────────────────────────
# Main Transcription Function
# ─────────────────────────────────────────
def transcribe(audio_path: str) -> dict:
    result = {
        "text":     "",
        "language": WHISPER_LANGUAGE or "unknown",
        "segments": [],
        "success":  False,
        "error":    None
    }

    wav_path = None

    try:
        path = Path(audio_path)

        # Check file exists
        if not path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        # Check file is not corrupt / too small
        file_size = path.stat().st_size
        if file_size < MIN_AUDIO_BYTES:
            logger.warning(f"Audio file too small ({file_size} bytes) — likely empty recording")
            result["text"]    = ""
            result["success"] = True  # Not an error, just silence
            return result

        # Convert to WAV if needed
        if not audio_path.lower().endswith(".wav"):
            wav_path        = _convert_to_wav(audio_path)
            transcribe_path = wav_path
        else:
            transcribe_path = audio_path

        # Transcribe
        model   = load_model()
        options = {"task": "transcribe", "verbose": False}
        if WHISPER_LANGUAGE:
            options["language"] = WHISPER_LANGUAGE

        logger.info(f"Transcribing: {transcribe_path}")
        raw = model.transcribe(transcribe_path, **options)

        result["text"]     = raw.get("text", "").strip()
        result["language"] = raw.get("language", "unknown")
        result["segments"] = raw.get("segments", [])
        result["success"]  = True

        logger.info(f"Transcription: '{result['text'][:80]}'")

    except FileNotFoundError as e:
        result["error"] = str(e)
        logger.error(f"STT FileNotFoundError: {e}")

    except RuntimeError as e:
        # Corrupt/invalid audio — treat as empty rather than crashing
        logger.warning(f"Audio processing failed (possibly corrupt file): {e}")
        result["text"]    = ""
        result["success"] = True
        result["error"]   = None

    except Exception as e:
        result["error"] = f"Transcription failed: {str(e)}"
        logger.error(f"STT Error: {e}", exc_info=True)

    finally:
        if wav_path:
            try:
                Path(wav_path).unlink(missing_ok=True)
            except Exception:
                pass

    return result


# ─────────────────────────────────────────
# Utility
# ─────────────────────────────────────────
def is_speech_empty(text: str) -> bool:
    if not text:
        return True
    cleaned = text.strip().lower()
    noise_phrases = ["", ".", "...", "you", "the", "thank you."]
    return cleaned in noise_phrases or len(cleaned) < 3