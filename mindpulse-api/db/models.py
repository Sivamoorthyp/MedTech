"""
db/models.py — SQLAlchemy ORM model for MindPulse API keys (SQLite compatible)
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from db.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class APIKey(Base):
    __tablename__ = "api_keys"

    # Use String for UUID — SQLite doesn't have a native UUID type
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(128), nullable=False)
    key_hash = Column(String(64), unique=True, nullable=False, index=True)
    key_prefix = Column(String(16), nullable=False)   # e.g. mp_a3f8c2d1

    # Tier: "basic" | "standard" | "full"
    tier = Column(String(16), nullable=False, default="basic")

    # Per-feature permissions
    can_chat         = Column(Boolean, nullable=False, default=False)
    can_face_scan    = Column(Boolean, nullable=False, default=False)
    can_dashboard    = Column(Boolean, nullable=False, default=False)
    can_appointments = Column(Boolean, nullable=False, default=False)

    # Rate limiting
    requests_limit = Column(Integer, nullable=False, default=1000)
    requests_used  = Column(Integer, nullable=False, default=0)

    # Status & lifecycle
    is_active  = Column(Boolean, nullable=False, default=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return datetime.now(timezone.utc) > self.expires_at.replace(tzinfo=timezone.utc) \
            if self.expires_at.tzinfo is None else datetime.now(timezone.utc) > self.expires_at

    def is_rate_limited(self) -> bool:
        return self.requests_used >= self.requests_limit

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "key_prefix": self.key_prefix,
            "tier": self.tier,
            "permissions": {
                "can_chat":         self.can_chat,
                "can_face_scan":    self.can_face_scan,
                "can_dashboard":    self.can_dashboard,
                "can_appointments": self.can_appointments,
            },
            "requests_used":  self.requests_used,
            "requests_limit": self.requests_limit,
            "is_active":  self.is_active,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
