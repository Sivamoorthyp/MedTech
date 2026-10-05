import subprocess
import sys
import os
import time

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON_EXE = os.path.join(ROOT_DIR, "VoiceAssis", ".venv", "Scripts", "python.exe")

if not os.path.exists(PYTHON_EXE):
    PYTHON_EXE = sys.executable

commands = [
    ("MindPulse API (8001)", [PYTHON_EXE, "-m", "uvicorn", "main:app", "--port", "8001", "--reload"], os.path.join(ROOT_DIR, "mindpulse-api")),
    ("Voice Assistant (8000)", [PYTHON_EXE, "-m", "uvicorn", "main:app", "--port", "8000"], os.path.join(ROOT_DIR, "VoiceAssis")),
    ("Frontend Web App (3000)", [PYTHON_EXE, "-m", "http.server", "3000", "--directory", os.path.join(ROOT_DIR, "mentalhealth", "mentalhealth")], ROOT_DIR),
]

processes = []

print("=" * 60)
print("🚀 Starting MindPulse Mental Health Platform Services")
print("=" * 60)
print("\n📍 Frontend:        http://localhost:3000/index.html")
print("📍 MindPulse API:   http://localhost:8001/docs")
print("📍 Voice Assistant: http://localhost:8000\n")

try:
    for name, cmd, cwd in commands:
        p = subprocess.Popen(cmd, cwd=cwd)
        processes.append((name, p))

    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\nShutting down services...")
    for name, p in processes:
        p.terminate()
