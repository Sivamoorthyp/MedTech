"""
routes/dashboard.py — GET /v1/dashboard
Returns aggregated mental health dashboard data.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth.api_keys import increment_usage, require_permission
from db.models import APIKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Dashboard"])


class StressTrend(BaseModel):
    date: str
    avg_stress: float
    session_count: int


class DashboardResponse(BaseModel):
    total_students_screened: int
    active_sessions_today: int
    avg_stress_level: str
    high_risk_count: int
    crisis_interventions: int
    top_emotion: str
    weekly_trend: list[StressTrend]
    last_updated: str


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    summary="Dashboard Analytics",
    description=(
        "Get aggregated mental health monitoring data for your institution. "
        "Requires `can_dashboard` permission."
    ),
)
async def get_dashboard(
    key_data: tuple = Depends(require_permission("can_dashboard")),
):
    key_obj: APIKey
    db: AsyncSession
    key_obj, db = key_data

    logger.info(f"Dashboard request | key={key_obj.key_prefix}")

    # TODO: Replace with real DB aggregation queries when student data model is added
    now = datetime.now(timezone.utc)

    mock_trend = [
        StressTrend(date="2026-02-20", avg_stress=3.2, session_count=47),
        StressTrend(date="2026-02-21", avg_stress=3.5, session_count=52),
        StressTrend(date="2026-02-22", avg_stress=4.1, session_count=61),
        StressTrend(date="2026-02-23", avg_stress=3.8, session_count=58),
        StressTrend(date="2026-02-24", avg_stress=4.3, session_count=70),
        StressTrend(date="2026-02-25", avg_stress=3.9, session_count=65),
        StressTrend(date="2026-02-26", avg_stress=3.6, session_count=40),
    ]

    await increment_usage(key_obj, db)

    return DashboardResponse(
        total_students_screened=1248,
        active_sessions_today=40,
        avg_stress_level="Moderate",
        high_risk_count=12,
        crisis_interventions=3,
        top_emotion="Anxious",
        weekly_trend=mock_trend,
        last_updated=now.isoformat(),
    )
