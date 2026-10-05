"""
auth/api_keys.py — API key generation, hashing, validation, and FastAPI dependencies
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import APIKey

# ─────────────────────────────────────────────────────────────
# Tier Definitions
# ─────────────────────────────────────────────────────────────

TIERS = {
    "basic": {
        "can_chat": True,
        "can_face_scan": False,
        "can_dashboard": False,
        "can_appointments": False,
        "requests_limit": 500,
    },
    "standard": {
        "can_chat": True,
        "can_face_scan": True,
        "can_dashboard": True,
        "can_appointments": False,
        "requests_limit": 1000,
    },
    "full": {
        "can_chat": True,
        "can_face_scan": True,
        "can_dashboard": True,
        "can_appointments": True,
        "requests_limit": 5000,
    },
}


# ─────────────────────────────────────────────────────────────
# Key Generation & Hashing
# ─────────────────────────────────────────────────────────────

def hash_key(raw_key: str) -> str:
    """SHA-256 hash of a raw key string."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """
    Generate a new secure API key.
    Returns: (raw_key, key_hash, key_prefix)
    - raw_key   — shown once to user, e.g. mp_a3f8c2d1b4e5f6a7b8c9d0e1f2a3b4c5
    - key_hash  — stored in DB
    - key_prefix — displayed in UI, e.g. mp_a3f8c2d1
    """
    raw = "mp_" + secrets.token_hex(24)  # 48 hex chars → total 51 chars
    prefix = raw[:12]  # mp_ + first 9 hex chars
    digest = hash_key(raw)
    return raw, digest, prefix


# ─────────────────────────────────────────────────────────────
# Key Creation (used by admin route)
# ─────────────────────────────────────────────────────────────

async def create_api_key(
    db: AsyncSession,
    name: str,
    tier: str,
    expires_days: Optional[int] = None,
) -> tuple[APIKey, str]:
    """
    Create and persist a new API key.
    Returns (APIKey ORM object, raw_key).
    raw_key is returned only here and must be shown to the user immediately.
    """
    if tier not in TIERS:
        raise ValueError(f"Unknown tier: {tier}. Must be one of {list(TIERS)}")

    raw_key, key_hash, key_prefix = generate_api_key()
    perms = TIERS[tier]

    expires_at = None
    if expires_days and expires_days > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(days=expires_days)

    api_key = APIKey(
        name=name,
        key_hash=key_hash,
        key_prefix=key_prefix,
        tier=tier,
        can_chat=perms["can_chat"],
        can_face_scan=perms["can_face_scan"],
        can_dashboard=perms["can_dashboard"],
        can_appointments=perms["can_appointments"],
        requests_limit=perms["requests_limit"],
        expires_at=expires_at,
    )

    db.add(api_key)
    await db.flush()   # get the ID set without committing

    return api_key, raw_key


# ─────────────────────────────────────────────────────────────
# Key Validation (used by all protected routes)
# ─────────────────────────────────────────────────────────────

async def validate_api_key(
    raw_key: str,
    db: AsyncSession,
) -> APIKey:
    """
    Lookup an API key by its hash. Raises HTTP 401/429 on failure.
    Does NOT check per-feature permissions — that's done separately.
    """
    digest = hash_key(raw_key)

    result = await db.execute(
        select(APIKey).where(APIKey.key_hash == digest)
    )
    key_obj: Optional[APIKey] = result.scalar_one_or_none()

    if key_obj is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    if not key_obj.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key has been revoked.",
        )

    if key_obj.is_expired():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key has expired.",
        )

    if key_obj.is_rate_limited():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({key_obj.requests_limit} requests/month). Upgrade your tier.",
        )

    return key_obj


async def increment_usage(key_obj: APIKey, db: AsyncSession):
    """Increment the requests_used counter for an API key."""
    await db.execute(
        update(APIKey)
        .where(APIKey.id == key_obj.id)
        .values(requests_used=APIKey.requests_used + 1)
    )


# ─────────────────────────────────────────────────────────────
# FastAPI Dependencies — per-feature permission guards
# ─────────────────────────────────────────────────────────────

async def _get_validated_key(
    x_api_key: str = Header(..., alias="x-api-key", description="Your MindPulse API key"),
    db: AsyncSession = Depends(get_db),
) -> tuple[APIKey, AsyncSession]:
    """Base dependency: validate header, return (key_obj, db)."""
    key_obj = await validate_api_key(x_api_key, db)
    return key_obj, db


def require_permission(permission: str):
    """
    Factory that returns a FastAPI dependency checking a specific permission.
    Usage: key_data = Depends(require_permission("can_chat"))
    """
    async def _check(
        data: tuple = Depends(_get_validated_key),
    ) -> tuple[APIKey, AsyncSession]:
        key_obj, db = data
        if not getattr(key_obj, permission, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your API key tier ('{key_obj.tier}') does not have '{permission}' access. Upgrade to a higher tier.",
            )
        return key_obj, db

    return _check


# ─────────────────────────────────────────────────────────────
# Admin Secret Validation
# ─────────────────────────────────────────────────────────────

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")


async def require_admin(
    x_admin_secret: str = Header(..., alias="x-admin-secret", description="Admin secret token"),
):
    """Dependency that validates the admin secret header."""
    if not ADMIN_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin secret is not configured on this server.",
        )
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin secret.",
        )
