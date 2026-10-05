"""
test_pipeline.py — Test script to verify the entire voice pipeline (STT -> Emotion -> LLM -> TTS)
"""

import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.append(str(project_root))

print("========================================")
print("Testing Voice Assistant Pipeline Components")
print("========================================")

# 1. Test Emotion Detection
print("\n--- 1. Testing Emotion & Intent Analysis ---")
from core.emotion import analyze as analyze_emotion
sample_text = "I feel so stressed about my final exams tomorrow and I'm really scared of failing."
print(f"Sample Input: '{sample_text}'")
emotion_result = analyze_emotion(sample_text)
print("Result:")
for k, v in emotion_result.items():
    if k != 'scores':
        print(f"  {k}: {v}")

# 2. Test LLM Response Generation
print("\n--- 2. Testing LLM Response (Groq/Ollama/Fallback) ---")
from core.llm import generate_response
llm_result = generate_response(
    user_text=sample_text,
    emotion=emotion_result["emotion"],
    intent=emotion_result["intent"],
    messages=[],
    is_crisis=emotion_result["is_crisis"]
)
print("Result:")
for k, v in llm_result.items():
    print(f"  {k}: {v}")

# 3. Test Text-to-Speech (TTS)
print("\n--- 3. Testing Text-to-Speech (TTS) ---")
from core.tts import synthesize
test_reply = llm_result["reply"]
print(f"Synthesizing: '{test_reply}'")
tts_result = synthesize(test_reply, output_path=str(project_root / "audio" / "responses" / "test_synthesized.wav"))
print("Result:")
for k, v in tts_result.items():
    print(f"  {k}: {v}")

# 4. Test Speech-to-Text (STT)
print("\n--- 4. Testing Speech-to-Text (STT) ---")
from core.stt import transcribe
audio_path = tts_result["audio_path"]
if tts_result["success"] and os.path.exists(audio_path):
    print(f"Transcribing audio file: '{audio_path}'")
    stt_result = transcribe(audio_path)
    print("Result:")
    for k, v in stt_result.items():
        if k != 'segments':
            print(f"  {k}: {v}")
else:
    print("Skipping STT test: TTS synthesis did not output a valid file.")

print("\n========================================")
print("Pipeline Test Completed!")
print("========================================")
