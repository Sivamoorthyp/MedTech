"""
routes/chat.py — POST /v1/chat
DeepPhys Assistant powered by Aria (Ollama) with Groq fallback
"""

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.api_keys import increment_usage, require_permission
from db.models import APIKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Chat"])

# ─────────────────────────────────────────────────────────────
# Config (from .env)
# ─────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "aria")
MAX_TOKENS   = 120

# Groq cooldown cache
_groq_last_fail = 0.0
_GROQ_COOLDOWN  = 300  # 5 minutes

# ─────────────────────────────────────────────────────────────
# System Prompt
# ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are DeepPhys Assistant – an empathetic AI mental health companion designed for students.
Respond warmly and concisely (2-3 sentences max).
First sentence: acknowledge how the user feels.
Second sentence: offer one practical coping tip or ask a gentle follow-up question.
Do NOT pretend to be a licensed therapist. Do NOT give medical diagnoses.
If the user expresses crisis/suicidal thoughts, always direct them to iCall: 9152987821."""


# ─────────────────────────────────────────────────────────────
# Request / Response Schemas
# ─────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="User message")
    session_id: Optional[str] = Field(None, description="Optional session ID for context")
    history: Optional[list[dict]] = Field(
        default=None,
        description="Optional prior messages [{role: user|assistant, content: str}]"
    )


class ChatResponse(BaseModel):
    reply: str
    model: str
    session_id: Optional[str]


# ─────────────────────────────────────────────────────────────
# LLM Helpers
# ─────────────────────────────────────────────────────────────
def _call_groq(messages: list[dict]) -> str:
    payload = {
        "model":       GROQ_MODEL,
        "messages":    messages,
        "max_tokens":  MAX_TOKENS,
        "temperature": 0.75,
        "stream":      False,
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
    with urllib.request.urlopen(req, timeout=8) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        return result["choices"][0]["message"]["content"].strip()


def _call_ollama(messages: list[dict]) -> str:
    payload = {
        "model":      OLLAMA_MODEL,
        "messages":   messages,
        "stream":     False,
        "keep_alive": "10m",
        "options":    {"num_predict": MAX_TOKENS, "temperature": 0.75},
    }
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        OLLAMA_URL, data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        return result["message"]["content"].strip()


def _get_reply(user_message: str, history: list[dict]) -> tuple[str, str]:
    """Try Aria (Ollama) first, fall back to Groq. Returns (reply, model_name)."""
    global _groq_last_fail

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history[-10:])  # last 10 messages for context
    messages.append({"role": "user", "content": user_message})

    # Try Ollama (Aria fine-tuned model)
    try:
        reply = _call_ollama(messages)
        return reply, f"ollama/{OLLAMA_MODEL}"
    except Exception as e:
        logger.warning(f"Ollama failed: {e}. Falling back to Groq.")

    # Try Groq
    groq_cooled = (time.time() - _groq_last_fail) > _GROQ_COOLDOWN
    if not groq_cooled:
        logger.warning("Groq on cooldown. Using static fallback.")
    elif GROQ_API_KEY:
        try:
            reply = _call_groq(messages)
            _groq_last_fail = 0.0
            return reply, f"groq/{GROQ_MODEL}"
        except Exception as e:
            _groq_last_fail = time.time()
            logger.error(f"Groq also failed: {e}")

    # Static fallback
    return (
        "I hear you and I'm here for you. Can you tell me more about what's going on?",
        "fallback"
    )


# ─────────────────────────────────────────────────────────────
# Route
# ─────────────────────────────────────────────────────────────
@router.post(
    "/chat",
    response_model=ChatResponse,
    summary="DeepPhys Chat Assistant",
    description="Send a message to the DeepPhys AI mental health assistant. Requires `can_chat` permission.",
)
async def chat(
    body: ChatRequest,
    key_data: tuple = Depends(require_permission("can_chat")),
):
    key_obj: APIKey
    db: AsyncSession
    key_obj, db = key_data

    try:
        reply, model = _get_reply(body.message, body.history or [])
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="AI service temporarily unavailable.")

    # Increment usage counter
    await increment_usage(key_obj, db)

    return ChatResponse(reply=reply, model=model, session_id=body.session_id)
