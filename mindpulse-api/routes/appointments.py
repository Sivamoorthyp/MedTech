"""
routes/appointments.py — POST /v1/appointments & GET /v1/appointments
Counselling appointment booking via API key.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.api_keys import increment_usage, require_permission
from db.models import APIKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Appointments"])


class AppointmentRequest(BaseModel):
    student_name: str = Field(..., min_length=2, max_length=128)
    student_email: str = Field(..., description="Contact email")
    date: str = Field(..., description="Appointment date in YYYY-MM-DD format")
    time_slot: str = Field(..., description="Time slot e.g. '10:00 AM'")
    reason: str = Field(..., max_length=500, description="Brief reason for appointment")
    counsellor_preference: str = Field(default="any", description="Preferred counsellor or 'any'")


class AppointmentResponse(BaseModel):
    status: str
    appointment_id: str
    student_name: str
    date: str
    time_slot: str
    confirmation_message: str
    created_at: str


class AvailabilitySlot(BaseModel):
    date: str
    slots: list[str]


@router.post(
    "/appointments",
    response_model=AppointmentResponse,
    summary="Book Counselling Appointment",
    description="Book a counselling appointment for a student. Requires `can_appointments` permission.",
)
async def book_appointment(
    body: AppointmentRequest,
    key_data: tuple = Depends(require_permission("can_appointments")),
):
    key_obj: APIKey
    db: AsyncSession
    key_obj, db = key_data

    appointment_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    logger.info(
        f"Appointment booked | key={key_obj.key_prefix} | "
        f"student={body.student_name} | date={body.date} | slot={body.time_slot}"
    )

    # TODO: Persist appointment to DB and send confirmation email

    await increment_usage(key_obj, db)

    return AppointmentResponse(
        status="confirmed",
        appointment_id=appointment_id,
        student_name=body.student_name,
        date=body.date,
        time_slot=body.time_slot,
        confirmation_message=(
            f"Your counselling appointment on {body.date} at {body.time_slot} has been confirmed. "
            f"Please check your email ({body.student_email}) for further details."
        ),
        created_at=now.isoformat(),
    )


@router.get(
    "/appointments/availability",
    summary="Get Available Appointment Slots",
    description="Returns available counselling time slots for the next 7 days.",
)
async def get_availability(
    key_data: tuple = Depends(require_permission("can_appointments")),
):
    # TODO: Fetch from real scheduling DB
    return {
        "available_slots": [
            {"date": "2026-02-27", "slots": ["10:00 AM", "11:00 AM", "2:00 PM"]},
            {"date": "2026-02-28", "slots": ["9:00 AM", "3:00 PM", "4:00 PM"]},
            {"date": "2026-03-01", "slots": ["10:00 AM", "1:00 PM"]},
        ]
    }
