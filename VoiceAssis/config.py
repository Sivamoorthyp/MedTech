"""
config.py — Central configuration for Emotional AI Assistant
All settings live here. Easy to swap models, keys, or paths later.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# ─────────────────────────────────────────
# BASE PATHS
# ─────────────────────────────────────────
BASE_DIR       = Path(__file__).parent
AUDIO_TEMP_DIR = BASE_DIR / "audio" / "temp"
AUDIO_RESP_DIR = BASE_DIR / "audio" / "responses"
MODELS_DIR     = BASE_DIR / "models"
LOGS_DIR       = BASE_DIR / "logs"
STATIC_DIR     = BASE_DIR / "static"

# Auto-create directories on startup
for _dir in [AUDIO_TEMP_DIR, AUDIO_RESP_DIR, MODELS_DIR, LOGS_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────
# API KEYS
# ─────────────────────────────────────────
# Option 1: Set directly here (for local dev)
# Option 2: Use environment variables (recommended for production)
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "YOUR_CLAUDE_API_KEY_HERE")  # Not used by Groq pipeline

# ─────────────────────────────────────────
# WHISPER (Speech to Text)
# ─────────────────────────────────────────
# Models: tiny (39M) | base (74M) | small (244M) | medium (769M)
# Tip: Start with "base" — good accuracy, fast on CPU
WHISPER_MODEL    = os.getenv("WHISPER_MODEL", "tiny")
WHISPER_LANGUAGE = None   # Set to None for auto-detect
WHISPER_DEVICE   = "cpu"  # "cuda" if you have a GPU

# ─────────────────────────────────────────
# EMOTION DETECTION
# ─────────────────────────────────────────
# Supported emotions by text2emotion:
# Happy, Angry, Surprise, Sad, Fear
EMOTION_LABELS = ["Happy", "Angry", "Surprise", "Sad", "Fear"]
DEFAULT_EMOTION = "Neutral"

# ─────────────────────────────────────────
# CLAUDE (LLM)
# ─────────────────────────────────────────
# claude-haiku-4-5-20251001  → fastest, cheapest (best for real-time)
# claude-sonnet-4-6          → smarter, slower
CLAUDE_MODEL      = "claude-haiku-4-5-20251001"
CLAUDE_MAX_TOKENS = 250   # Keep responses short for conversation
CLAUDE_TEMPERATURE = 0.85  # Higher = more natural/creative responses

# System prompt template — {emotion} and {intent} are injected at runtime
SYSTEM_PROMPT_TEMPLATE = """You are a warm, emotionally intelligent AI companion.
Your role is to provide genuine emotional support and understanding.

Current emotional state detected: {emotion}
Detected intent: {intent}

Guidelines:
- Respond in 2-3 short, conversational sentences maximum
- Acknowledge the user's emotion naturally, don't just label it
- Be warm and human — not clinical or robotic
- Ask one gentle follow-up question to continue the conversation
- Never give unsolicited advice unless asked
- Match your energy to theirs (calm if sad, uplifting if happy)
- Speak like a caring friend, not a therapist or chatbot
"""

# ─────────────────────────────────────────
# CONVERSATION MEMORY
# ─────────────────────────────────────────
MAX_HISTORY_TURNS = 10   # Number of back-and-forth exchanges to remember
# Each "turn" = 1 user message + 1 assistant message

# ─────────────────────────────────────────
# TEXT TO SPEECH (Coqui TTS)
# ─────────────────────────────────────────
# Free models — downloaded automatically on first use:
# "tts_models/en/ljspeech/tacotron2-DDC"     → natural female voice
# "tts_models/en/ljspeech/glow-tts"          → faster, slightly robotic
# "tts_models/en/vctk/vits"                  → multi-speaker (more variety)
TTS_MODEL       = "tts_models/en/ljspeech/tacotron2-DDC"
TTS_OUTPUT_FILE = str(AUDIO_RESP_DIR / "response.wav")
TTS_SAMPLE_RATE = 22050

# ─────────────────────────────────────────
# SERVER
# ─────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 8000
RELOAD = False  # Disabled: hot-reload was restarting every 0.5s due to log file writes inside the watched dir

# ─────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────
LOG_FILE           = str(LOGS_DIR / "conversation.log")
LOG_LEVEL          = "INFO"
LOG_CONVERSATIONS  = True   # Save full transcripts to log

