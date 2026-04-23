import json
import os
from typing import Any

import requests


DEFAULT_MODEL = "gemini-2.5-flash"
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiServiceError(Exception):
    pass


def gemini_is_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def get_gemini_model() -> str:
    return os.getenv("GEMINI_MODEL", DEFAULT_MODEL)


def generate_json_response(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise GeminiServiceError("Gemini API key is not configured")

    model = get_gemini_model()
    url = GEMINI_API_URL.format(model=model)

    payload = {
        "system_instruction": {
            "parts": [{"text": system_prompt}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
        },
    }

    response = requests.post(
        url,
        params={"key": api_key},
        json=payload,
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()

    candidate = ((data.get("candidates") or [{}])[0]).get("content", {})
    parts = candidate.get("parts") or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise GeminiServiceError("Gemini returned an empty response")

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise GeminiServiceError("Gemini returned invalid JSON") from exc
