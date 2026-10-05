"""
core/conversation.py — Conversation Memory & History

Responsibilities:
- Store per-session message history
- Format history for Claude API (list of {role, content} dicts)
- Trim history to stay within token limits
- Track session metadata (emotion trend, turn count)
- Easily extensible: swap in a DB later by just replacing the store
"""

import logging
import json
import time
from collections import deque
from typing import Optional
from config import MAX_HISTORY_TURNS, LOG_FILE, LOG_CONVERSATIONS

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────
# Session Object
# ─────────────────────────────────────────
class ConversationSession:
    """
    Holds the full state of a single conversation session.
    One session = one browser tab / one call.
    """

    def __init__(self, session_id: str):
        self.session_id   = session_id
        self.created_at   = time.time()
        self.turn_count   = 0
        self.emotion_history = []   # Track emotion changes over conversation

        # deque auto-drops oldest messages when maxlen is exceeded
        # MAX_HISTORY_TURNS * 2 because each turn = user + assistant message
        self._messages = deque(maxlen=MAX_HISTORY_TURNS * 2)

    def add_user_message(self, text: str, emotion: str = "Neutral", intent: str = "unknown"):
        """Add a user turn to the conversation."""
        self._messages.append({
            "role":      "user",
            "content":   text,
            "emotion":   emotion,
            "intent":    intent,
            "timestamp": time.time(),
        })
        self.emotion_history.append(emotion)
        self.turn_count += 1

    def add_assistant_message(self, text: str):
        """Add an assistant (Claude) turn to the conversation."""
        self._messages.append({
            "role":      "assistant",
            "content":   text,
            "timestamp": time.time(),
        })

    def get_messages_for_claude(self) -> list:
        """
        Return messages formatted for the Claude API.
        Claude only needs role + content (not our extra metadata).
        """
        return [
            {"role": msg["role"], "content": msg["content"]}
            for msg in self._messages
        ]

    def get_emotion_trend(self) -> str:
        """
        Summarize how the user's emotion has changed.
        Useful to inject into Claude's system prompt for context.
        """
        if len(self.emotion_history) < 2:
            return ""
        recent = self.emotion_history[-3:]   # Last 3 emotions
        if len(set(recent)) == 1:
            return f"User has consistently felt {recent[0]} throughout the conversation."
        return f"Emotion trend: {' → '.join(recent)}"

    def get_dominant_emotion(self) -> str:
        """Return the most frequent emotion in this session."""
        if not self.emotion_history:
            return "Neutral"
        return max(set(self.emotion_history), key=self.emotion_history.count)

    def to_dict(self) -> dict:
        """Serialize session to dict (for logging/storage)."""
        return {
            "session_id":      self.session_id,
            "created_at":      self.created_at,
            "turn_count":      self.turn_count,
            "emotion_history": self.emotion_history,
            "messages":        list(self._messages),
        }

    def clear(self):
        """Reset the conversation (keep session_id)."""
        self._messages.clear()
        self.emotion_history.clear()
        self.turn_count = 0
        logger.info(f"Session {self.session_id} cleared.")


# ─────────────────────────────────────────
# Session Manager (in-memory store)
# ─────────────────────────────────────────
class ConversationManager:
    """
    Manages all active sessions.
    Future: Replace _sessions dict with Redis or SQLite for persistence.
    """

    def __init__(self):
        self._sessions: dict[str, ConversationSession] = {}

    def get_or_create(self, session_id: str) -> ConversationSession:
        """Get existing session or create a new one."""
        if session_id not in self._sessions:
            self._sessions[session_id] = ConversationSession(session_id)
            logger.info(f"New session created: {session_id}")
        return self._sessions[session_id]

    def get(self, session_id: str) -> Optional[ConversationSession]:
        """Get a session if it exists."""
        return self._sessions.get(session_id)

    def end_session(self, session_id: str):
        """End and optionally log a session."""
        session = self._sessions.pop(session_id, None)
        if session and LOG_CONVERSATIONS:
            _log_session(session)
        logger.info(f"Session ended: {session_id}")

    def clear_all(self):
        """Clear all sessions (useful for testing)."""
        self._sessions.clear()

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# ─────────────────────────────────────────
# Logging Utility
# ─────────────────────────────────────────
def _log_session(session: ConversationSession):
    """Append session transcript to log file."""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("\n" + "="*60 + "\n")
            f.write(json.dumps(session.to_dict(), indent=2, ensure_ascii=False))
            f.write("\n")
    except Exception as e:
        logger.error(f"Failed to log session: {e}")


# ─────────────────────────────────────────
# Global Manager Instance
# ─────────────────────────────────────────
# Import this wherever you need session access:
#   from core.conversation import manager
#   session = manager.get_or_create(session_id)
manager = ConversationManager()