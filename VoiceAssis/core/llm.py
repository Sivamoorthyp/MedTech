"""
core/llm.py — LLM via Groq API (fast single-call responses)
"""

import logging
import json
import os
import re
import time
import urllib.request
import urllib.error
from config import SYSTEM_PROMPT_TEMPLATE
from core.data_connector import get_user_vitals

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────
# Groq Configuration
# ─────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama-3.1-8b-instant"
MAX_TOKENS   = 1024   # enough for full medical report in one call

# Cache Groq failures
_groq_last_fail = 0.0
_GROQ_COOLDOWN  = 30

# ─────────────────────────────────────────
# Medical / Mental Health Keywords
# ─────────────────────────────────────────
MEDICAL_KEYWORDS = [
    "fever", "temperature", "cold", "cough", "flu", "running nose", "runny nose",
    "headache", "migraine", "pain", "ache", "sore", "throat", "chest", "stomach",
    "vomit", "nausea", "diarrhea", "fatigue", "tired", "weak", "dizzy", "faint",
    "breathe", "breathing", "allergy", "rash", "skin", "swelling", "injury",
    "blood", "infection", "inflammation", "diabetes", "pressure", "bp", "heart",
    "stress", "anxiety", "depression", "sad", "hopeless", "panic", "mental",
    "sleep", "insomnia", "burnout", "trauma", "ocd", "adhd", "schizophrenia",
    "epilepsy", "seizure", "cancer", "tumor", "asthma", "back pain", "joint",
    "muscle", "sprain", "fracture", "wound", "cut", "bleed", "constipation",
    "gas", "acidity", "indigestion", "urine", "kidney", "liver", "thyroid",
    "eyes", "vision", "ear", "hearing", "dental", "tooth", "gum",
]

def _is_medical(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in MEDICAL_KEYWORDS)


# ─────────────────────────────────────────
# Crisis Response
# ─────────────────────────────────────────
CRISIS_RESPONSE = (
    "I can hear that you're going through something really heavy right now, "
    "and I want you to know you're not alone. Please consider reaching out to "
    "iCall at 9152987821 — they're available and trained to support you. "
    "I'm right here with you. Would you like to talk about what's going on?"
)


# ─────────────────────────────────────────
# Medical Report System Prompt (single-call)
# ─────────────────────────────────────────
MEDICAL_SYSTEM = """You are a medical assistant AI. When the user describes a medical symptom or condition, respond ONLY using this exact format, filling in real content for the user's specific condition. Never add text outside this format.

========================================
UNDERSTANDING YOUR MENTAL STATE / HEALTH
========================================
[1-2 sentences about what the user is experiencing]
========================================
ABOUT THE CONDITION
========================================
[2-3 sentences describing the condition, its causes and effects]
========================================
SIGNS & POSSIBLE SYMPTOMS
================================--------
- [symptom 1]
- [symptom 2]
- [symptom 3]
- [symptom 4]
- [symptom 5]
========================================
DATA ANALYSIS (HR / BP / SpO2)
================================--------
[Analyze provided vital signs, or state: Since no vital signs were provided, we cannot analyze correlation. This condition is not typically associated with significant vital sign changes unless severe.]
========================================
CARE & PREVENTION
========================================
- [care tip 1]
- [care tip 2]
- [care tip 3]
- [care tip 4]
- [care tip 5]
========================================
WHEN TO SEE A DOCTOR
================================--------
- [situation 1]
- [situation 2]
- [situation 3]
- [situation 4]
========================================
EMERGENCY WARNING
========================================
[Emergency signs if any, otherwise: None at this time. The condition appears mild.]
Warning: This is not a medical diagnosis. Please consult a qualified healthcare professional."""


# ─────────────────────────────────────────
# Casual Friend System Prompt
# ─────────────────────────────────────────
CASUAL_SYSTEM = (
    "You are Aria, a close friend. Talk like a real person, not a therapist.\n"
    "Use simple everyday words. Keep it short and casual.\n"
    "Reply with exactly 2 short sentences.\n"
    "First sentence: show you get how they feel.\n"
    "Second sentence: ask one easy question.\n"
    "Do NOT give advice. No lists, no URLs."
)


# ─────────────────────────────────────────
# Single Groq API Call
# ─────────────────────────────────────────
def _call_groq(system: str, messages: list, max_tokens: int = 150, temperature: float = 0.5) -> str:
    payload = {
        "model":       GROQ_MODEL,
        "messages":    [{"role": "system", "content": system}] + messages,
        "max_tokens":  max_tokens,
        "temperature": temperature,
        "stream":      False,
    }
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        GROQ_URL, data=data,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "User-Agent":    "Mozilla/5.0",
            "Accept":        "application/json",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            pass
        if e.code in (401, 403):
            raise RuntimeError(f"Groq API key invalid or expired (HTTP {e.code}).")
        raise


# ─────────────────────────────────────────
# Ollama Fallback (casual only)
# ─────────────────────────────────────────
def _call_ollama(messages: list) -> str:
    last_user = [{"role": "user", "content": messages[-1]["content"]}] if messages else []
    payload = {
        "model":      "llama3.2",
        "messages":   [{"role": "system", "content": CASUAL_SYSTEM}] + last_user,
        "stream":     False,
        "keep_alive": "10m",
        "options":    {"num_predict": 60, "temperature": 0.7}
    }
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        "http://localhost:11434/api/chat", data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        return result["message"]["content"].strip()


# ─────────────────────────────────────────
# Response Sanitization (casual only)
# ─────────────────────────────────────────
def _sanitize_casual(reply: str) -> str:
    if not reply or len(reply.strip()) < 5:
        return "I hear what you're going through. What's been the hardest part for you?"
    reply = re.sub(r'^(Aria|Assistant|AI):\s*', '', reply, flags=re.IGNORECASE).strip()
    sentences = re.split(r'(?<=[.!?])\s+', reply)
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:
        return "I hear what you're going through. What's been the hardest part for you?"
    return ' '.join(sentences[:2])


# ─────────────────────────────────────────
# Main Generate Function
# ─────────────────────────────────────────
def generate_response(
    user_text:     str,
    emotion:       str,
    intent:        str,
    messages:      list,
    emotion_trend: str  = "",
    is_crisis:     bool = False,
    language:      str  = "en",
) -> dict:
    result = {
        "reply":      "",
        "model":      GROQ_MODEL,
        "success":    False,
        "error":      None,
        "was_crisis": False,
    }

    try:
        # ── Crisis override ───────────────────────────────────
        if is_crisis:
            result["reply"]      = CRISIS_RESPONSE
            result["success"]    = True
            result["was_crisis"] = True
            return result

        global _groq_last_fail
        groq_ok = (time.time() - _groq_last_fail) > _GROQ_COOLDOWN

        # ── Medical / Mental Health path ──────────────────────
        if _is_medical(user_text):
            logger.info(f"Medical topic detected: '{user_text[:60]}' — single-call report")

            # Get vitals context
            vitals = get_user_vitals()
            vitals_str = (
                f"User vitals: HR={vitals.get('heartrate','N/A')} bpm, "
                f"BP={vitals.get('bp','N/A')}, "
                f"Stress={vitals.get('stress','N/A')}, "
                f"HRV={vitals.get('hrv','N/A')}"
            )

            medical_system = MEDICAL_SYSTEM + f"\n\n{vitals_str}"
            user_msg = [{"role": "user", "content": user_text}]

            try:
                if not groq_ok:
                    raise RuntimeError("Groq cooldown active")
                reply = _call_groq(medical_system, user_msg, max_tokens=MAX_TOKENS, temperature=0.3)
                _groq_last_fail = 0.0
                logger.info(f"Medical report generated ({len(reply)} chars)")
            except Exception as e:
                if "cooldown" not in str(e):
                    _groq_last_fail = time.time()
                    logger.warning(f"Groq medical report failed: {e}")
                # Fallback: static but informative message
                reply = (
                    "========================================\n"
                    "UNDERSTANDING YOUR MENTAL STATE / HEALTH\n"
                    "========================================\n"
                    f"You mentioned: {user_text}. I'm here to help with this.\n"
                    "========================================\n"
                    "NOTE\n"
                    "========================================\n"
                    "The AI service is temporarily unavailable. Please try again in a moment.\n"
                    "If this is urgent, please consult a healthcare professional immediately.\n"
                    "Warning: This is not a medical diagnosis. Please consult a qualified healthcare professional."
                )

            result["reply"]   = reply
            result["model"]   = GROQ_MODEL
            result["success"] = True
            return result

        # ── Casual response path ──────────────────────────────
        if not messages or messages[-1]["role"] != "user":
            messages = messages + [{"role": "user", "content": user_text}]

        system = CASUAL_SYSTEM
        if intent and intent != "unknown":
            system += f"\nUser intent: {intent}."
        if emotion_trend:
            system += f"\nEmotion trend: {emotion_trend}."
        if language != "en":
            system += f"\nCRITICAL: Reply in language code '{language}', NOT in English."

        try:
            if not groq_ok:
                raise RuntimeError("Groq cooldown active")
            logger.info(f"Calling Groq (casual) | emotion={emotion} | intent={intent}")
            reply = _call_groq(system, messages, max_tokens=100, temperature=0.85)
            _groq_last_fail = 0.0
            logger.info(f"Groq casual response: '{reply[:80]}'")
        except Exception as groq_err:
            if "cooldown" not in str(groq_err):
                _groq_last_fail = time.time()
                logger.warning(f"Groq failed ({groq_err}), falling back to Ollama...")
            try:
                reply = _call_ollama(messages)
                result["model"] = "ollama-aria"
            except Exception as ollama_err:
                logger.error(f"Ollama also failed: {ollama_err}")
                import random
                reply = random.choice([
                    "That sounds really tough to deal with. What's been weighing on you the most?",
                    "I hear you — that's a lot to carry. What happened?",
                    "Ugh, that sounds genuinely hard. Want to tell me more?",
                    "I can imagine how draining that must feel. What's been going on?",
                    "I'm sorry you're going through this. What do you think triggered it?",
                ])

        result["reply"]   = _sanitize_casual(reply)
        result["success"] = True

    except Exception as e:
        result["error"]   = str(e)
        result["reply"]   = "I hear you and I'm here. Can you tell me more about how you're feeling?"
        result["success"] = True
        logger.error(f"LLM Error: {e}", exc_info=True)

    return result