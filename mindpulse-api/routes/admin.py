"""
routes/admin.py — Admin endpoints for API key management
Protected by x-admin-secret header.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.api_keys import create_api_key, require_admin, TIERS
from db.database import get_db
from db.models import APIKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin — Key Management"])


# ─────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────

class GenerateKeyRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=128, description="Human-friendly key label")
    tier: str = Field(..., description="Tier: 'basic', 'standard', or 'full'")
    expires_days: Optional[int] = Field(
        None,
        gt=0,
        le=3650,
        description="Optional expiry in days from today. Leave null for no expiry."
    )


class GenerateKeyResponse(BaseModel):
    message: str
    api_key: str                 # Raw key — shown ONCE
    key_prefix: str
    key_id: str
    name: str
    tier: str
    permissions: dict
    requests_limit: int
    expires_at: Optional[str]
    created_at: str


class RevokeResponse(BaseModel):
    status: str
    key_id: str
    key_prefix: str


# ─────────────────────────────────────────────────────────────
# Generate Key
# ─────────────────────────────────────────────────────────────

@router.post(
    "/generate-key",
    response_model=GenerateKeyResponse,
    status_code=201,
    summary="Generate a new API Key",
    description=(
        "Creates a new MindPulse API key with preset tier permissions. "
        "**The raw key is returned ONCE — save it immediately.** "
        "Requires `x-admin-secret` header."
    ),
)
async def generate_key(
    body: GenerateKeyRequest,
    _: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.tier not in TIERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid tier '{body.tier}'. Choose from: {list(TIERS.keys())}",
        )

    api_key_obj, raw_key = await create_api_key(
        db=db,
        name=body.name,
        tier=body.tier,
        expires_days=body.expires_days,
    )

    logger.info(f"New API key created | name={body.name} | tier={body.tier} | prefix={api_key_obj.key_prefix}")

    return GenerateKeyResponse(
        message="API key created successfully. Save the api_key — it will not be shown again.",
        api_key=raw_key,
        key_prefix=api_key_obj.key_prefix,
        key_id=str(api_key_obj.id),
        name=api_key_obj.name,
        tier=api_key_obj.tier,
        permissions={
            "can_chat": api_key_obj.can_chat,
            "can_face_scan": api_key_obj.can_face_scan,
            "can_dashboard": api_key_obj.can_dashboard,
            "can_appointments": api_key_obj.can_appointments,
        },
        requests_limit=api_key_obj.requests_limit,
        expires_at=api_key_obj.expires_at.isoformat() if api_key_obj.expires_at else None,
        created_at=api_key_obj.created_at.isoformat(),
    )


# ─────────────────────────────────────────────────────────────
# List Keys
# ─────────────────────────────────────────────────────────────

@router.get(
    "/keys",
    summary="List all API keys",
    description="Returns all API keys (no raw key — only prefix and metadata). Requires admin secret.",
)
async def list_keys(
    _: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(APIKey).order_by(APIKey.created_at.desc())
    )
    keys = result.scalars().all()
    return {"keys": [k.to_dict() for k in keys], "total": len(keys)}


# ─────────────────────────────────────────────────────────────
# Revoke Key
# ─────────────────────────────────────────────────────────────

@router.patch(
    "/keys/{key_id}/revoke",
    response_model=RevokeResponse,
    summary="Revoke an API key",
    description="Deactivates an API key immediately. All future requests with this key will be rejected.",
)
async def revoke_key(
    key_id: str,
    _: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(APIKey).where(APIKey.id == str(key_id)))
    key_obj: Optional[APIKey] = result.scalar_one_or_none()

    if not key_obj:
        raise HTTPException(status_code=404, detail="API key not found.")

    if not key_obj.is_active:
        raise HTTPException(status_code=409, detail="API key is already revoked.")

    key_obj.is_active = False
    await db.flush()

    logger.info(f"API key revoked | id={key_id} | prefix={key_obj.key_prefix}")

    return RevokeResponse(
        status="revoked",
        key_id=key_id,
        key_prefix=key_obj.key_prefix,
    )


# ─────────────────────────────────────────────────────────────
# Re-activate Key
# ─────────────────────────────────────────────────────────────

@router.patch(
    "/keys/{key_id}/activate",
    summary="Re-activate a revoked API key",
)
async def activate_key(
    key_id: str,
    _: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(APIKey).where(APIKey.id == str(key_id)))
    key_obj = result.scalar_one_or_none()

    if not key_obj:
        raise HTTPException(status_code=404, detail="API key not found.")

    key_obj.is_active = True
    await db.flush()

    return {"status": "activated", "key_id": key_id, "key_prefix": key_obj.key_prefix}
