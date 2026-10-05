"""
bot.py — Main Pipeline Orchestrator

This is the brain. It wires together:
    STT → Emotion → LLM → TTS

Called by main.py for every audio message received.
Clean, simple interface — easy to unit test each stage.
"""

import logging
import time
import uuid
from core.stt        import transcribe, is_speech_empty
from core.emotion    import analyze as analyze_emotion
from core.llm        import generate_response
from core.tts        import synthesize
from core.conversation import manager

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────
# Main Pipeline Entry Point
# ─────────────────────────────────────────
def process_audio(audio_path: str, session_id: str) -> dict:
    """
    Full pipeline: audio file → AI voice response.

    Args:
        audio_path:  Path to the uploaded audio file (webm/wav)
        session_id:  Browser session identifier (for conversation memory)

    Returns:
        dict: {
            "session_id":   str,
            "transcript":   str,
            "emotion":      str,
            "emotion_scores": dict,
            "intent":       str,
            "is_crisis":    bool,
            "reply":        str,
            "audio_url":    str,    # URL to play the response audio
            "turn_number":  int,
            "pipeline_ms":  float,  # Total processing time
            "stages": {             # Per-stage timing
                "stt_ms":     float,
                "emotion_ms": float,
                "llm_ms":     float,
                "tts_ms":     float,
            },
            "success":  bool,
            "error":    str | None,
        }
    """
    t_total_start = time.time()

    result = {
        "session_id":    session_id,
        "transcript":    "",
        "emotion":       "Neutral",
        "emotion_scores": {},
        "intent":        "unknown",
        "is_crisis":     False,
        "reply":         "",
        "audio_url":     "",
        "turn_number":   0,
        "pipeline_ms":   0.0,
        "stages":        {"stt_ms": 0, "emotion_ms": 0, "llm_ms": 0, "tts_ms": 0},
        "success":       False,
        "error":         None,
    }

    try:
        # ── Get or create session ──────────────────
        session = manager.get_or_create(session_id)

        # ── Stage 1: Speech to Text ─────────────────
        logger.info(f"[{session_id}] Stage 1: STT")
        t = time.time()
        stt_result = transcribe(audio_path)
        result["stages"]["stt_ms"] = _ms(t)

        if not stt_result["success"]:
            result["error"] = f"STT failed: {stt_result['error']}"
            return result

        transcript = stt_result["text"]
        result["transcript"] = transcript

        # Handle silence / empty speech
        if is_speech_empty(transcript):
            result["reply"]     = "I didn't catch that — could you say it again?"
            result["success"]   = True
            result["audio_url"] = _speak_and_get_url(result["reply"])
            return result

        logger.info(f"[{session_id}] Transcript: '{transcript}'")

        # ── Stage 2: Emotion + Intent Analysis ─────
        logger.info(f"[{session_id}] Stage 2: Emotion Analysis")
        t = time.time()
        analysis = analyze_emotion(transcript)
        result["stages"]["emotion_ms"] = _ms(t)

        result["emotion"]        = analysis["emotion"]
        result["emotion_scores"] = analysis["scores"]
        result["intent"]         = analysis["intent"]
        result["is_crisis"]      = analysis["is_crisis"]

        logger.info(f"[{session_id}] Emotion: {analysis['emotion']} | Intent: {analysis['intent']}")

        # ── Update conversation memory ──────────────
        session.add_user_message(
            text    = transcript,
            emotion = analysis["emotion"],
            intent  = analysis["intent"],
        )

        # ── Stage 3: Generate Response ──────────────
        logger.info(f"[{session_id}] Stage 3: LLM")
        t = time.time()
        
        detected_lang = stt_result.get("language", "en")
        
        llm_result = generate_response(
            user_text     = transcript,
            emotion       = analysis["emotion"],
            intent        = analysis["intent"],
            messages      = session.get_messages_for_claude(),
            emotion_trend = session.get_emotion_trend(),
            is_crisis     = analysis["is_crisis"],
            language      = detected_lang,
        )
        result["stages"]["llm_ms"] = _ms(t)

        reply = llm_result["reply"]
        result["reply"] = reply

        # Save assistant response to memory
        session.add_assistant_message(reply)
        result["turn_number"] = session.turn_count

        logger.info(f"[{session_id}] Reply: '{reply[:80]}'")

        # ── Stage 4: Text to Speech ─────────────────
        logger.info(f"[{session_id}] Stage 4: TTS")
        t = time.time()
        detected_lang = stt_result.get("language", "en")
        tts_result = synthesize(reply, language=detected_lang)
        result["stages"]["tts_ms"] = _ms(t)

        result["audio_url"] = tts_result["audio_url"]
        result["success"]   = True

    except Exception as e:
        result["error"] = f"Pipeline error: {str(e)}"
        logger.error(f"[{session_id}] Pipeline crashed: {e}", exc_info=True)

    finally:
        result["pipeline_ms"] = _ms(t_total_start)
        logger.info(
            f"[{session_id}] Pipeline complete in {result['pipeline_ms']:.0f}ms "
            f"(STT:{result['stages']['stt_ms']:.0f} | "
            f"EMO:{result['stages']['emotion_ms']:.0f} | "
            f"LLM:{result['stages']['llm_ms']:.0f} | "
            f"TTS:{result['stages']['tts_ms']:.0f})"
        )

    return result


# ─────────────────────────────────────────
# Text Pipeline (for Chatbot / WhatsApp)
# ─────────────────────────────────────────
def process_text(text: str, session_id: str, language: str = "en", skip_tts: bool = False) -> dict:
    """
    Text-only pipeline: text → Emotion → LLM → TTS (optional).
    Skips the STT phase.
    """
    t_total_start = time.time()

    result = {
        "session_id":    session_id,
        "transcript":    text,
        "emotion":       "Neutral",
        "emotion_scores": {},
        "intent":        "unknown",
        "is_crisis":     False,
        "reply":         "",
        "audio_url":     "",
        "turn_number":   0,
        "pipeline_ms":   0.0,
        "stages":        {"stt_ms": 0, "emotion_ms": 0, "llm_ms": 0, "tts_ms": 0},
        "success":       False,
        "error":         None,
    }

    try:
        session = manager.get_or_create(session_id)

        if is_speech_empty(text):
            result["reply"]     = "I didn't catch that — could you say it again?"
            result["success"]   = True
            result["audio_url"] = _speak_and_get_url(result["reply"])
            return result

        logger.info(f"[{session_id}] Text Input: '{text}'")

        # ── Stage 2: Emotion + Intent Analysis ─────
        logger.info(f"[{session_id}] Stage 2: Emotion Analysis")
        t = time.time()
        analysis = analyze_emotion(text)
        result["stages"]["emotion_ms"] = _ms(t)

        result["emotion"]        = analysis["emotion"]
        result["emotion_scores"] = analysis["scores"]
        result["intent"]         = analysis["intent"]
        result["is_crisis"]      = analysis["is_crisis"]

        # ── Update conversation memory ──────────────
        session.add_user_message(text=text, emotion=analysis["emotion"], intent=analysis["intent"])

        # ── Stage 3: Generate Response ──────────────
        logger.info(f"[{session_id}] Stage 3: LLM")
        t = time.time()
        llm_result = generate_response(
            user_text     = text,
            emotion       = analysis["emotion"],
            intent        = analysis["intent"],
            messages      = session.get_messages_for_claude(),
            emotion_trend = session.get_emotion_trend(),
            is_crisis     = analysis["is_crisis"],
            language      = language,
        )
        result["stages"]["llm_ms"] = _ms(t)

        reply = llm_result["reply"]
        result["reply"] = reply

        session.add_assistant_message(reply)
        result["turn_number"] = session.turn_count

        # ── Stage 4: Text to Speech ─────────────────
        if not skip_tts:
            logger.info(f"[{session_id}] Stage 4: TTS")
            t = time.time()
            tts_result = synthesize(reply, language=language)
            result["stages"]["tts_ms"] = _ms(t)
            result["audio_url"] = tts_result.get("audio_url", "")
        else:
            result["audio_url"] = ""
            
        result["success"]   = True

    except Exception as e:
        result["error"] = f"Text Pipeline error: {str(e)}"
        logger.error(f"[{session_id}] Text Pipeline crashed: {e}", exc_info=True)

    finally:
        result["pipeline_ms"] = _ms(t_total_start)

    return result

# ─────────────────────────────────────────
# Session Management Helpers
# ─────────────────────────────────────────
def end_session(session_id: str):
    """End and archive a session."""
    manager.end_session(session_id)
    logger.info(f"Session ended: {session_id}")


def reset_session(session_id: str):
    """Clear conversation history but keep session alive."""
    session = manager.get(session_id)
    if session:
        session.clear()


def generate_session_id() -> str:
    """Generate a unique session ID."""
    return str(uuid.uuid4())


# ─────────────────────────────────────────
# Internal Utilities
# ─────────────────────────────────────────
def _ms(start: float) -> float:
    """Return milliseconds elapsed since start."""
    return (time.time() - start) * 1000


def _speak_and_get_url(text: str) -> str:
    """Quick TTS for system messages (silence, errors, etc.)."""
    tts_result = synthesize(text)
    return tts_result.get("audio_url", "")