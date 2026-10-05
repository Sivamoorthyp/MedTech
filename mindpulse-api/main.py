"""
main.py — MindPulse API Key Management Service
FastAPI backend exposing MindPulse features via secure API keys.

Run: uvicorn main:app --port 8001 --reload
Docs: http://localhost:8001/docs
"""

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()  # Must be before any os.getenv calls

from db.database import create_tables
from routes.chat import router as chat_router
from routes.face_scan import router as face_scan_router
from routes.dashboard import router as dashboard_router
from routes.appointments import router as appointments_router
from routes.admin import router as admin_router

# ─────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    handlers=[
        logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="MindPulse API",
    description=(
        "## MindPulse API Key Management System\n\n"
        "Secure API access to MindPulse mental health features for external developers and institutions.\n\n"
        "### Authentication\n"
        "All `/v1/*` endpoints require an `x-api-key` header with your MindPulse API key.\n"
        "Admin endpoints require `x-admin-secret` header.\n\n"
        "### Tiers\n"
        "| Tier | Chat | Face Scan | Dashboard | Appointments | Limit |\n"
        "|---|---|---|---|---|---|\n"
        "| basic | ✅ | ❌ | ❌ | ❌ | 500/month |\n"
        "| standard | ✅ | ✅ | ✅ | ❌ | 1000/month |\n"
        "| full | ✅ | ✅ | ✅ | ✅ | 5000/month |"
    ),
    version="1.0.0",
    contact={"name": "MindPulse Team"},
    license_info={"name": "Proprietary"},
)

# ─────────────────────────────────────────────────────────────
# CORS — allow MindPulse frontend (local development)
# ─────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",  # VS Code Live Server
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://localhost:8000",  # VoiceAssis server
        "null",                   # file:// origins
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# Routers
# ─────────────────────────────────────────────────────────────
app.include_router(chat_router)
app.include_router(face_scan_router)
app.include_router(dashboard_router)
app.include_router(appointments_router)
app.include_router(admin_router)


# ─────────────────────────────────────────────────────────────
# Root & Health
# ─────────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "MindPulse API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "endpoints": {
            "chat":         "POST /v1/chat",
            "face_scan":    "POST /v1/face-scan",
            "dashboard":    "GET  /v1/dashboard",
            "appointments": "POST /v1/appointments",
            "admin":        "POST /admin/generate-key",
        },
    }


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "mindpulse-api", "version": "1.0.0"}


# ─────────────────────────────────────────────────────────────
# Startup / Shutdown
# ─────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("=" * 55)
    logger.info("MindPulse API starting up...")
    logger.info("Creating DB tables (if they don't exist)...")
    try:
        await create_tables()
        logger.info("DB tables ready.")
    except Exception as e:
        logger.warning(
            f"Could not reach Supabase at startup: {e}\n"
            "Tables will be created on first successful DB connection."
        )
    logger.info("Swagger docs → http://localhost:8001/docs")
    logger.info("=" * 55)


@app.on_event("shutdown")
async def shutdown():
    logger.info("MindPulse API shutting down. Goodbye!")


# ─────────────────────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
