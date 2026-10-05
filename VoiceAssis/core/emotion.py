"""
core/emotion.py — Emotion + Intent Analysis via Groq (fast) with rule-based fallback
"""

import logging
import re
import json
import os
import urllib.request

logger = logging.getLogger(__name__)

EMOTION_LABELS  = ["Happy", "Angry", "Surprise", "Sad", "Fear"]
DEFAULT_EMOTION = "Neutral"

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama-3.1-8b-instant"


# ─────────────────────────────────────────
# Groq Emotion Detection
# ─────────────────────────────────────────
def _detect_emotion_groq(text: str) -> dict:
    prompt = f"""Detect the primary emotion in this text. Be sensitive to frustration, stress, and sadness even when not stated directly.

Text: "{text}"

Respond with ONLY valid JSON, no other text:
{{"dominant": "<emotion>", "Happy": 0.0, "Sad": 0.0, "Angry": 0.0, "Fear": 0.0, "Surprise": 0.0}}

Rules:
- dominant must be one of: Happy, Sad, Angry, Fear, Surprise, Neutral
- Set the matching score to 0.7-1.0 and others lower
- Frustration, annoyance, exhaustion from work = Angry
- Loneliness, feeling invisible, heartbreak = Sad
- Worry, anxiety, overwhelm, dread = Fear"""

    payload = {
        "model":       GROQ_MODEL,
        "messages":    [{"role": "user", "content": prompt}],
        "max_tokens":  100,
        "temperature": 0.1,
    }

    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        GROQ_URL, data=data,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {GROQ_API_KEY}",
        },
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=10) as resp:
        result  = json.loads(resp.read().decode("utf-8"))
        content = result["choices"][0]["message"]["content"].strip()

    json_match = re.search(r'\{.*\}', content, re.DOTALL)
    if not json_match:
        raise ValueError(f"No JSON in response: {content}")

    parsed   = json.loads(json_match.group())
    dominant = parsed.get("dominant", DEFAULT_EMOTION)
    scores   = {e: float(parsed.get(e, 0.0)) for e in EMOTION_LABELS}

    return {
        "dominant":   dominant,
        "scores":     scores,
        "confidence": scores.get(dominant, 0.0),
        "is_neutral": dominant == "Neutral",
        "success":    True,
        "error":      None,
    }


# ─────────────────────────────────────────
# Rule-based Fallback
# ─────────────────────────────────────────
EMOTION_KEYWORDS = {
    "Happy":    ["happy", "great", "wonderful", "joy", "excited", "love", "amazing",
                 "fantastic", "good", "glad", "smile", "laugh", "awesome", "enjoyed",
                 "proud", "grateful", "blessed", "thrilled", "delighted"],
    "Sad":      ["sad", "depressed", "crying", "unhappy", "lonely", "hopeless",
                 "heartbroken", "miserable", "low", "down", "grief", "lost", "miss",
                 "alone", "empty", "numb", "worthless", "broken", "tears", "hurting"],
    "Angry":    ["angry", "furious", "hate", "rage", "frustrated", "annoyed",
                 "mad", "upset", "irritated", "fed up", "unfair",
                 "frustrating", "crashed", "lot of work", "exhausting", "invisible",
                 "no one acknowledges", "overwhelmed", "stressful", "terrible",
                 "worst", "ruined", "awful", "pissed", "sick of", "done with",
                 "don't know what to do", "can't deal", "ridiculous"],
    "Fear":     ["scared", "afraid", "fear", "worried", "anxious", "nervous",
                 "panic", "terrified", "stress", "terrifying",
                 "dread", "helpless", "uncertain", "restless", "uneasy", "tense"],
    "Surprise": ["surprised", "shocked", "unbelievable", "wow", "unexpected",
                 "amazed", "astonished", "suddenly"],
}

def _detect_emotion_rules(text: str) -> dict:
    text_lower = text.lower()
    scores     = {e: 0.0 for e in EMOTION_LABELS}

    for emotion, keywords in EMOTION_KEYWORDS.items():
        matches        = sum(1 for kw in keywords if kw in text_lower)
        scores[emotion] = min(matches * 0.3, 1.0)

    dominant   = max(scores, key=scores.get)
    confidence = scores[dominant]

    if confidence < 0.1:
        dominant   = DEFAULT_EMOTION
        is_neutral = True
    else:
        is_neutral = False

    return {
        "dominant":   dominant,
        "scores":     scores,
        "confidence": confidence,
        "is_neutral": is_neutral,
        "success":    True,
        "error":      None,
    }


# ─────────────────────────────────────────
# Emotion Detection (Groq → rules fallback)
# ─────────────────────────────────────────
def detect_emotion(text: str) -> dict:
    if not text or len(text.strip()) < 3:
        return {
            "dominant":   DEFAULT_EMOTION,
            "scores":     {e: 0.0 for e in EMOTION_LABELS},
            "confidence": 0.0,
            "is_neutral": True,
            "success":    True,
            "error":      None,
        }

    # Use rules-only detection (fast, no API call needed)
    result = _detect_emotion_rules(text)
    logger.info(f"Emotion (rules): {result['dominant']}")
    return result


# ─────────────────────────────────────────
# Intent Detection
# ─────────────────────────────────────────
INTENT_PATTERNS = [
    ("venting", [
    r"\bfrustrating\b", r"\bfrustrated\b",
    r"\binvisible\b", r"\bnever get credit\b",
    r"\bno one acknowledges\b", r"\bmanager\b",
    r"\bi hate\b", r"\bso angry\b", r"\bfed up\b",
    r"\bstressed\b", r"\bcan't take\b"]),
    ("crisis",       [r"\bsuicid\b", r"\bkill myself\b", r"\bwant to die\b",
                      r"\bhopeless\b", r"\bend it all\b"]),
    ("seeking_help", [r"\bwhat should i\b", r"\bhelp me\b", r"\badvice\b",
                      r"\bwhat do i do\b", r"\bhow do i\b"]),
    ("venting",      [r"\bi hate\b", r"\bso frustrated\b", r"\bso angry\b",
                      r"\bso tired\b", r"\bcan't take\b", r"\bfed up\b", r"\bstressed\b"]),
    ("gratitude",    [r"\bthank you\b", r"\bthanks\b", r"\bappreciate\b", r"\bgrateful\b"]),
    ("sharing",      [r"\bi feel\b", r"\bi am feeling\b", r"\bi'm feeling\b",
                      r"\bi felt\b", r"\btoday was\b", r"\bvery low\b", r"\bdepressed\b",
                      r"\bi had\b", r"\bi was\b"]),
    ("casual",       [r"\bhello\b", r"\bhi\b", r"\bhey\b", r"\bwhat's up\b",
                      r"\bhow are you\b", r"\bready\b"]),
]

INTENT_DESCRIPTIONS = {
    "crisis":       "User may be in emotional crisis",
    "seeking_help": "User is asking for advice or guidance",
    "venting":      "User wants to express frustration and feel heard",
    "gratitude":    "User is expressing appreciation",
    "sharing":      "User is sharing how they feel",
    "casual":       "Casual conversation or greeting",
    "unknown":      "Intent unclear",
}

def detect_intent(text: str) -> dict:
    result = {
        "intent":      "unknown",
        "description": INTENT_DESCRIPTIONS["unknown"],
        "is_crisis":   False,
        "success":     True,
    }
    if not text:
        return result

    text_lower = text.lower()
    for intent_name, patterns in INTENT_PATTERNS:
        for pattern in patterns:
            if re.search(pattern, text_lower):
                result["intent"]      = intent_name
                result["description"] = INTENT_DESCRIPTIONS.get(intent_name, "")
                result["is_crisis"]   = (intent_name == "crisis")
                logger.info(f"Intent: {intent_name}")
                return result
    return result


# ─────────────────────────────────────────
# Combined Analysis
# ─────────────────────────────────────────
def analyze(text: str) -> dict:
    emotion = detect_emotion(text)
    intent  = detect_intent(text)
    return {
        "emotion":     emotion["dominant"],
        "scores":      emotion["scores"],
        "confidence":  emotion["confidence"],
        "is_neutral":  emotion["is_neutral"],
        "intent":      intent["intent"],
        "is_crisis":   intent["is_crisis"],
        "intent_desc": intent["description"],
    }