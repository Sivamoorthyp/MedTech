# 🧠 Emotional AI Assistant

A completely free, local, voice-based emotional support chatbot.
Built with WebRTC + Whisper + Claude + Coqui TTS.

---

## Stack

| Layer       | Tool            | Cost |
|-------------|-----------------|------|
| Voice I/O   | WebRTC (browser)| Free |
| STT         | OpenAI Whisper  | Free (local) |
| Emotion     | text2emotion    | Free (local) |
| LLM         | Claude Haiku    | Free tier |
| TTS         | Coqui TTS       | Free (local) |
| Server      | FastAPI         | Free |

---

## Setup

### 1. Install System Dependencies

**ffmpeg** (required by Whisper):

- Windows: Download from https://ffmpeg.org → add to PATH
- Mac:     `brew install ffmpeg`
- Linux:   `sudo apt install ffmpeg`

### 2. Install Python Packages

```bash
pip install -r requirements.txt
```

> First run will download Whisper (~150MB) and Coqui TTS (~200MB) models automatically.

### 3. Set Your Claude API Key

Open `config.py` and replace:
```python
CLAUDE_API_KEY = "YOUR_API_KEY_HERE"
```

Or set an environment variable:
```bash
export CLAUDE_API_KEY="your_key_here"    # Mac/Linux
set CLAUDE_API_KEY=your_key_here         # Windows
```

Get a free key at: https://console.anthropic.com

### 4. Run

```bash
python main.py
```

Then open: **http://localhost:8000**

---

## Usage

1. Click **Start Talking** (or hold **Spacebar**)
2. Speak freely — share how you're feeling
3. Click **Stop** when done
4. Wait ~3–5 seconds for the AI to respond
5. Listen to the voice response and continue the conversation

---

## Project Structure

```
emotional-bot/
├── main.py              # FastAPI server
├── bot.py               # Pipeline orchestrator
├── config.py            # All settings
├── requirements.txt
├── core/
│   ├── stt.py           # Whisper transcription
│   ├── emotion.py       # Emotion + intent detection
│   ├── llm.py           # Claude response generation
│   ├── tts.py           # Coqui TTS voice synthesis
│   └── conversation.py  # Session memory management
├── static/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js       # Main frontend logic
│       ├── recorder.js  # WebRTC mic capture
│       └── player.js    # Audio playback
├── audio/
│   ├── temp/            # Temp uploaded audio
│   └── responses/       # TTS output files
└── logs/
    └── conversation.log
```

---

## Configuration (`config.py`)

| Setting             | Default                    | Options                            |
|---------------------|----------------------------|------------------------------------|
| WHISPER_MODEL       | "base"                     | tiny / base / small / medium       |
| CLAUDE_MODEL        | claude-haiku-4-5-20251001  | any Claude model                   |
| MAX_HISTORY_TURNS   | 10                         | Any integer                        |
| TTS_MODEL           | tacotron2-DDC              | Any Coqui model                    |

---

## Upgrading Later (Paid/Better Options)

| Component | Free (now)    | Paid upgrade      |
|-----------|---------------|-------------------|
| STT       | Whisper local | Deepgram (~$0.004/min) |
| TTS       | Coqui local   | ElevenLabs ($5/mo) |
| LLM       | Claude Haiku  | Claude Sonnet/Opus |
| Phone     | Browser only  | Twilio ($1/mo/number) |

---

## Troubleshooting

**"Microphone access denied"**
→ Click the lock icon in your browser URL bar and allow microphone.

**"TTS model downloading..."**  
→ Wait 2–3 minutes on first run. Models are cached after that.

**Slow responses**
→ Switch WHISPER_MODEL to "tiny" in config.py for faster (less accurate) transcription.

**"Invalid Claude API key"**  
→ Check config.py or your environment variable. Get key at console.anthropic.com