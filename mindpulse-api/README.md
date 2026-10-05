# MindPulse API — Developer Documentation

Secure API access to MindPulse mental health features for external developers and institutions.

## Quick Start

```bash
cd d:/mentalhealth/mindpulse-api
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload
```

Then open **http://localhost:8001/docs** for the interactive Swagger UI.

---

## Authentication

All `/v1/*` endpoints require an `x-api-key` header:

```http
POST /v1/chat HTTP/1.1
x-api-key: mp_your_api_key_here
Content-Type: application/json
```

Admin endpoints require `x-admin-secret`:

```http
POST /admin/generate-key HTTP/1.1
x-admin-secret: mp_admin_secret_123456890
```

---

## Tiers & Permissions

| Tier | `/v1/chat` | `/v1/face-scan` | `/v1/dashboard` | `/v1/appointments` | Limit |
|---|---|---|---|---|---|
| **basic** | ✅ | ❌ | ❌ | ❌ | 500 req/month |
| **standard** | ✅ | ✅ | ✅ | ❌ | 1,000 req/month |
| **full** | ✅ | ✅ | ✅ | ✅ | 5,000 req/month |

---

## Endpoints

### `POST /v1/chat`
Chat with the DeepPhys AI assistant.

**Request:**
```json
{
  "message": "I feel really stressed about my exams",
  "session_id": "optional-session-id",
  "history": []
}
```

**Response:**
```json
{
  "reply": "Exam stress can be really overwhelming...",
  "model": "ollama/aria",
  "session_id": "optional-session-id"
}
```

---

### `POST /v1/face-scan`
Upload a face image for stress/emotion detection.

- **Content-Type:** `multipart/form-data`
- **Field:** `image` (JPEG/PNG/WebP, max 5 MB)
- **Note:** CNN model integration in progress

---

### `GET /v1/dashboard`
Get aggregated mental health analytics for your institution.

---

### `POST /v1/appointments`
Book a counselling appointment.

```json
{
  "student_name": "Saai V",
  "student_email": "saai@example.com",
  "date": "2026-03-01",
  "time_slot": "10:00 AM",
  "reason": "Academic stress and anxiety"
}
```

---

### `POST /admin/generate-key`
Generate a new API key (admin only).

```json
{
  "name": "My Institution",
  "tier": "standard",
  "expires_days": 365
}
```

Returns the raw key **once** — save it immediately.

---

### `GET /admin/keys`
List all API keys (metadata only, no raw keys).

### `PATCH /admin/keys/{id}/revoke`
Revoke an API key immediately.

---

## Error Codes

| Code | Meaning |
|---|---|
| 401 | Invalid, revoked, or expired API key |
| 403 | Key doesn't have permission for this feature |
| 413 | File too large (face-scan) |
| 429 | Rate limit exceeded |
| 500 | Server error |

---

## AI Model Priority

The chat endpoint uses this fallback chain:

1. **Aria** (Ollama fine-tuned model on `localhost:11434`) — primary
2. **Groq** (`llama-3.1-8b-instant`) — fallback if Ollama unavailable
3. **Static response** — last resort if both fail

---

## Project Structure

```
mindpulse-api/
├── main.py                  # FastAPI app entry point
├── .env                     # Secrets (never commit!)
├── .env.example             # Template for .env
├── requirements.txt
├── auth/
│   └── api_keys.py         # Key gen, hashing, validation, dependencies
├── db/
│   ├── database.py         # Async SQLAlchemy engine (Supabase)
│   └── models.py           # APIKey ORM model
└── routes/
    ├── chat.py             # POST /v1/chat
    ├── face_scan.py        # POST /v1/face-scan
    ├── dashboard.py        # GET  /v1/dashboard
    ├── appointments.py     # POST /v1/appointments
    └── admin.py            # Admin key management
```
