"""
routes/face_scan.py — POST /v1/face-scan
Stress/emotion detection via face image upload.
CNN model integration pending — currently returns structured stub response.
"""

import logging
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.api_keys import increment_usage, require_permission
from db.models import APIKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Face Scan"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


class FaceScanResponse(BaseModel):
    status: str
    emotion: str
    stress_level: str
    confidence: float
    message: str
    model: str


@router.post(
    "/face-scan",
    response_model=FaceScanResponse,
    summary="Face Stress & Emotion Detection",
    description=(
        "Upload a face image (JPEG/PNG/WebP, max 5 MB) to detect stress and emotion. "
        "Requires `can_face_scan` permission. "
        "**Note:** CNN model integration is in progress — returns structured demo response."
    ),
)
async def face_scan(
    image: UploadFile = File(..., description="Face image file (JPEG/PNG/WebP)"),
    key_data: tuple = Depends(require_permission("can_face_scan")),
):
    key_obj: APIKey
    db: AsyncSession
    key_obj, db = key_data

    # Validate content type
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {image.content_type}. Use JPEG, PNG, or WebP.",
        )

    # Validate file size
    image_bytes = await image.read()
    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image too large. Maximum size is 5 MB.",
        )

    logger.info(f"Face scan request | key={key_obj.key_prefix} | size={len(image_bytes)} bytes")

    # ── TODO: Replace stub with actual CNN model call ──────────────────────────
    # from face_model import predict_stress
    # result = predict_stress(image_bytes)
    # emotion = result["emotion"]
    # stress_level = result["stress_level"]
    # confidence = result["confidence"]
    # ─────────────────────────────────────────────────────────────────────────

    await increment_usage(key_obj, db)

    return FaceScanResponse(
        status="pending_integration",
        emotion="Neutral",
        stress_level="Low",
        confidence=0.0,
        message=(
            "Face scan model (CNN-based) is trained and available but pending integration "
            "into this API. Full results will be returned here once integrated."
        ),
        model="deepphys-cnn-v1",
    )
