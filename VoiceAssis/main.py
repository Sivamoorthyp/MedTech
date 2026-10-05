"""
main.py — FastAPI Backend Server

Endpoints:
    GET  /              → Serve the frontend UI
    POST /process       → Main pipeline (audio → AI voice response)
    POST /session/end   → End a session gracefully
    POST /session/reset → Clear conversation history
    GET  /health        → Health check
    GET  /session/{id}  → Get session info (for debugging)

Static files:
    /static/            → HTML, CSS, JS frontend
    /audio/             → TTS response audio files
"""

import logging
import os
import uuid
import shutil
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware

import bot
from config import HOST, PORT, RELOAD, AUDIO_TEMP_DIR, LOG_LEVEL, LOG_FILE

# ─────────────────────────────────────────
# Logging Setup
# ─────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ]
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────
# App Initialization
# ─────────────────────────────────────────
app = FastAPI(
    title="Emotional AI Assistant",
    description="WebRTC-based emotional support chatbot with voice",
    version="1.0.0",
)

# CORS — allow browser to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
app.mount("/static",  StaticFiles(directory="static"),         name="static")
app.mount("/audio",   StaticFiles(directory="audio"),          name="audio")


# ─────────────────────────────────────────
# Routes
# ─────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def serve_ui():
    """Serve the main HTML frontend."""
    return FileResponse("static/index.html")

@app.get("/chatbot", include_in_schema=False)
async def serve_chat_ui():
    """Serve the standalone text chatbot frontend."""
    return FileResponse("static/chat.html")


@app.get("/health")
async def health():
    """Health check — returns active session count."""
    return {
        "status":          "ok",
        "active_sessions": bot.manager.active_count,
    }


@app.post("/process")
async def process_audio(
    audio:      UploadFile = File(...),
    session_id: str        = Form(default=None),
):
    """
    Main pipeline endpoint.

    Accepts:
        audio:      Audio file (webm from browser MediaRecorder)
        session_id: Session ID (browser generates and sends this)

    Returns:
        JSON with transcript, emotion, intent, reply, and audio_url
    """
    # Generate session_id if not provided
    if not session_id:
        session_id = str(uuid.uuid4())

    # Save uploaded audio to temp directory
    ext       = Path(audio.filename).suffix or ".webm"
    temp_path = str(AUDIO_TEMP_DIR / f"{session_id}_{uuid.uuid4().hex}{ext}")

    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)

        logger.info(f"Received audio: {audio.filename} ({audio.content_type}) → {temp_path}")

        # Run full pipeline
        result = bot.process_audio(
            audio_path = temp_path,
            session_id = session_id,
        )

        # Always attach session_id to response
        result["session_id"] = session_id

        if not result["success"] and result["error"]:
            # Return partial result with error info (don't crash the browser)
            logger.error(f"Pipeline error for {session_id}: {result['error']}")
            return JSONResponse(content=result, status_code=207)

        return JSONResponse(content=result)

    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        # Always clean up temp audio
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass


@app.post("/chat")
async def process_chat(
    text:       str = Form(...),
    session_id: str = Form(default=None),
):
    """
    Text-only pipeline endpoint.
    """
    if not session_id:
        session_id = str(uuid.uuid4())

    try:
        logger.info(f"Received text chat: '{text}'")
        result = bot.process_text(
            text       = text,
            session_id = session_id,
            skip_tts   = True,
        )
        result["session_id"] = session_id

        if not result["success"] and result["error"]:
            logger.error(f"Text Pipeline error for {session_id}: {result['error']}")
            return JSONResponse(content=result, status_code=207)

        return JSONResponse(content=result)

    except Exception as e:
        logger.error(f"Server error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


from fastapi import Request
from twilio.twiml.messaging_response import MessagingResponse

@app.post("/whatsapp")
async def whatsapp_webhook(request: Request):
    """
    Twilio WhatsApp Webhook.
    Receives incoming WhatsApp messages (text or audio), processes them, and replies.
    """
    form_data = await request.form()
    
    sender_number = form_data.get("From", "")
    body = form_data.get("Body", "").strip()
    media_url = form_data.get("MediaUrl0", "")
    
    # Use sender number as session ID so conversation history is kept per user
    session_id = sender_number.replace("whatsapp:", "") if sender_number else str(uuid.uuid4())
    
    twiml_response = MessagingResponse()
    
    try:
        if media_url:
            # It's an audio message (voice note)
            # Twilio sends OGG/AMR. We'd need to download it and pass it to bot.process_audio
            # For this quick implementation, we will reply telling them we received audio,
            # since downloading requires Twilio Auth (or making media public) and converting.
            import httpx
            
            # Temporary implementation for audio:
            # To do this robustly, we'd use HTTPX to download media_url to AUDIO_TEMP_DIR,
            # then call bot.process_audio.
            msg = twiml_response.message("Voice notes received! Note: full audio processing via WhatsApp requires Twilio auth setup for media downloading. For now, please use text.")
            return Response(content=str(twiml_response), media_type="application/xml")
            
        elif body:
            # It's a text message
            result = bot.process_text(text=body, session_id=session_id, skip_tts=True)
            reply_text = result.get("reply", "I'm sorry, I couldn't process that.")
            
            # Send text reply back to WhatsApp (chunked to avoid 1600 char limit)
            if len(reply_text) > 1500:
                for i in range(0, len(reply_text), 1500):
                    twiml_response.message(reply_text[i:i+1500])
            else:
                twiml_response.message(reply_text)
            
            return Response(content=str(twiml_response), media_type="application/xml")
            
        else:
            twiml_response.message("I didn't receive any text or audio.")
            return Response(content=str(twiml_response), media_type="application/xml")

    except Exception as e:
        logger.error(f"WhatsApp webhook error: {e}", exc_info=True)
        twiml_response.message("Sorry, I encountered an internal error.")
        return Response(content=str(twiml_response), media_type="application/xml")


@app.post("/session/end")
async def end_session(session_id: str = Form(...)):
    """End a session and archive its transcript."""
    bot.end_session(session_id)
    return {"status": "ended", "session_id": session_id}


@app.post("/session/reset")
async def reset_session(session_id: str = Form(...)):
    """Clear conversation history for a session (keep session alive)."""
    bot.reset_session(session_id)
    return {"status": "reset", "session_id": session_id}


@app.get("/session/{session_id}")
async def get_session_info(session_id: str):
    """Return session metadata for debugging."""
    from core.conversation import manager
    session = manager.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.to_dict()


# ─────────────────────────────────────────
# Startup / Shutdown Events
# ─────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("=" * 50)
    logger.info("Emotional AI Assistant starting up...")
    logger.info(f"Open http://localhost:{PORT} in your browser")
    logger.info("=" * 50)

    # Pre-load Whisper model so first request isn't slow
    logger.info("Pre-loading Whisper model...")
    from core.stt import load_model
    load_model()
    logger.info("Ready!")


@app.on_event("shutdown")
async def shutdown():
    logger.info("Server shutting down. Goodbye!")


# ─────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=RELOAD,
    )