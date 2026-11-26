import os
import uuid
from pathlib import Path

import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "generated"
OUTPUT_DIR.mkdir(exist_ok=True)

# Arabic neural voices. Voice IDs are supplied by Microsoft Edge's online TTS service.
VOICES = {
    "ar-DZ-AminaNeural": {"name": "أمينة", "gender": "أنثى", "accent": "جزائرية"},
    "ar-DZ-IsmaelNeural": {"name": "إسماعيل", "gender": "ذكر", "accent": "جزائرية"},
    "ar-SA-ZariyahNeural": {"name": "زارية", "gender": "أنثى", "accent": "سعودية"},
    "ar-SA-HamedNeural": {"name": "حامد", "gender": "ذكر", "accent": "سعودية"},
    "ar-EG-SalmaNeural": {"name": "سلمى", "gender": "أنثى", "accent": "مصرية"},
    "ar-EG-ShakirNeural": {"name": "شاكر", "gender": "ذكر", "accent": "مصري"},
    "ar-AE-FatimaNeural": {"name": "فاطمة", "gender": "أنثى", "accent": "إماراتية"},
    "ar-AE-HamdanNeural": {"name": "حمدان", "gender": "ذكر", "accent": "إماراتي"},
}

app = FastAPI(title="NABRA AI - Arabic Text to Speech")

# Allow requests from the Capacitor Android WebView and the production website.
# Android WebView origin is https://localhost (androidScheme: https, hostname: localhost)
# but we also support fallback schemes and localhost with any port for dev/testing.
# No wildcard origin with credentials — allow_credentials stays False.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://localhost",
        "http://localhost",
        "capacitor://localhost",
        "ionic://localhost",
        "https://sawti-ai.onrender.com",
        "http://sawti-ai.onrender.com",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|capacitor://.*|ionic://.*|https?://.*\.onrender\.com",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str
    rate: int = Field(default=0, ge=-30, le=30)
    pitch: int = Field(default=0, ge=-20, le=20)

@app.get("/api/voices")
async def get_voices():
    return [{"id": key, **value} for key, value in VOICES.items()]

@app.post("/api/tts")
async def text_to_speech(payload: SpeechRequest):
    clean_text = payload.text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="يرجى كتابة نص أولاً.")
    if payload.voice not in VOICES:
        raise HTTPException(status_code=400, detail="الصوت المختار غير مدعوم.")

    filename = f"{uuid.uuid4().hex}.mp3"
    output_path = OUTPUT_DIR / filename
    rate = f"{payload.rate:+d}%"
    pitch = f"{payload.pitch:+d}Hz"

    try:
        communicate = edge_tts.Communicate(
            text=clean_text,
            voice=payload.voice,
            rate=rate,
            pitch=pitch
        )
        await communicate.save(str(output_path))
    except Exception:
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=502,
            detail="تعذر إنشاء الصوت حالياً. تحقق من اتصال الإنترنت وحاول مجدداً."
        )

    return FileResponse(
        path=output_path,
        media_type="audio/mpeg",
        filename="nabra-ai.mp3",
        background=BackgroundTask(output_path.unlink, missing_ok=True)
    )

app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
