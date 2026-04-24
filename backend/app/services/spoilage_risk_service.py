import json

from .gemini_service import GeminiServiceError, gemini_is_configured, generate_json_response


RISK_SYSTEM_PROMPT = """You are LiveTrack Risk Analyst.
You explain spoilage risk for a supply-chain dashboard.
Return strict JSON with this shape:
{
  "summary": "string",
  "recommended_action": "string"
}
Keep the tone operational, concise, and grounded in the provided risk data.
Do not invent new facts.
"""


def evaluate_batch_risk(truck: dict, item: dict, use_ai: bool = False) -> dict:
    temp = truck.get("current_temperature", 0)
    humidity = truck.get("humidity", 0)
    eta_hours = truck.get("eta_hours", 0)
    status = truck.get("status", "Idle")
    storage_temp = item.get("storage_temp", "N/A")
    shelf_life_days = int(item.get("shelf_life_days", 0) or 0)

    min_temp, max_temp = parse_storage_range(storage_temp)
    score = 0
    reasons = []
    next_steps = []

    if min_temp is not None or max_temp is not None:
        if min_temp is not None and temp < min_temp:
            deviation = min_temp - temp
            score += min(40, deviation * 7)
            reasons.append(f"Cabin temperature is {deviation}C colder than the safe range.")
        if max_temp is not None and temp > max_temp:
            deviation = temp - max_temp
            score += min(45, deviation * 9)
            reasons.append(f"Cabin temperature is {deviation}C above the safe range.")
    else:
        reasons.append("No structured storage temperature range was available.")

    if shelf_life_days <= 2:
        score += 28
        reasons.append("Shelf life is very short.")
    elif shelf_life_days <= 5:
        score += 18
        reasons.append("Shelf life is short.")
    elif shelf_life_days <= 10:
        score += 10
        reasons.append("Shelf life is moderate for an in-transit item.")

    if humidity >= 85:
        score += 16
        reasons.append("Humidity is high enough to accelerate spoilage.")
    elif humidity >= 75:
        score += 8
        reasons.append("Humidity is trending high.")

    if eta_hours >= 4:
        score += 15
        reasons.append("Delivery ETA is long for the current product condition.")
    elif eta_hours >= 2:
        score += 8
        reasons.append("Delivery ETA adds moderate holding risk.")

    if status == "In Transit":
        score += 6
    elif status == "Loading":
        score += 3

    score = max(0, min(100, int(round(score))))
    level = classify_risk(score)

    if level == "critical":
        next_steps = [
            "Prepare a flash auction or reroute decision.",
            "Prioritize cold-chain intervention for this batch.",
        ]
    elif level == "warning":
        next_steps = [
            "Monitor the batch closely over the next update cycle.",
            "Review whether faster delivery or rerouting is needed.",
        ]
    elif level == "watch":
        next_steps = [
            "Keep monitoring temperature and ETA for this batch.",
        ]
    else:
        next_steps = [
            "Continue standard monitoring.",
        ]

    explanation = build_risk_explanation(level, score, reasons, next_steps, truck, item, use_ai=use_ai)

    return {
        "score": score,
        "level": level,
        "reasons": reasons[:3],
        "recommended_actions": next_steps[:2],
        "summary": explanation["summary"],
        "recommended_action": explanation["recommended_action"],
        "is_spoiling": level in {"warning", "critical"} and score >= 55,
    }


def summarize_truck_risk(truck: dict, items: list[dict], use_ai: bool = False) -> dict:
    if not items:
        return {
            "score": 0,
            "level": "safe",
            "summary": "No active cargo risk was detected for this truck.",
            "recommended_action": "Continue standard monitoring.",
            "affected_batches": 0,
        }

    evaluated = [evaluate_batch_risk(truck, item, use_ai=use_ai) for item in items]
    highest = max(evaluated, key=lambda risk: risk["score"])
    affected_batches = sum(1 for risk in evaluated if risk["level"] in {"warning", "critical"})

    return {
        "score": highest["score"],
        "level": highest["level"],
        "summary": highest["summary"],
        "recommended_action": highest["recommended_action"],
        "affected_batches": affected_batches,
    }


def parse_storage_range(storage_temp: str) -> tuple[int | None, int | None]:
    if not storage_temp:
        return (None, None)

    normalized = storage_temp.replace("C", "").replace("c", "").replace(" ", "")
    if normalized.startswith("Roomtemp"):
        return (18, 28)
    if normalized.startswith("-18"):
        return (-22, -18)
    if "-" in normalized:
        start, end = normalized.split("-", 1)
        try:
            return (int(start), int(end))
        except ValueError:
            return (None, None)

    try:
        exact = int(normalized)
        return (exact, exact)
    except ValueError:
        return (None, None)


def classify_risk(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "warning"
    if score >= 30:
        return "watch"
    return "safe"


def build_risk_explanation(level: str, score: int, reasons: list[str], actions: list[str], truck: dict, item: dict, use_ai: bool = False) -> dict:
    fallback = {
        "summary": fallback_summary(level, score, reasons, truck, item),
        "recommended_action": actions[0] if actions else "Continue standard monitoring.",
    }

    if not use_ai or level not in {"warning", "critical"} or not gemini_is_configured():
        return fallback

    prompt = json.dumps(
        {
            "truck_id": truck.get("truck_id"),
            "truck_status": truck.get("status"),
            "cargo_type": truck.get("cargo_type"),
            "product_name": item.get("name"),
            "storage_temp": item.get("storage_temp"),
            "current_temperature": truck.get("current_temperature"),
            "humidity": truck.get("humidity"),
            "eta_hours": truck.get("eta_hours"),
            "risk_score": score,
            "risk_level": level,
            "reasons": reasons,
            "recommended_actions": actions,
        },
        ensure_ascii=True,
        default=str,
    )

    try:
        response = generate_json_response(RISK_SYSTEM_PROMPT, prompt)
        return {
            "summary": response.get("summary") or fallback["summary"],
            "recommended_action": response.get("recommended_action") or fallback["recommended_action"],
        }
    except (GeminiServiceError, Exception):
        return fallback


def fallback_summary(level: str, score: int, reasons: list[str], truck: dict, item: dict) -> str:
    lead = f"{item.get('name', 'This batch')} is at {level} risk with a score of {score}/100."
    if reasons:
        return f"{lead} Main driver: {reasons[0]}"
    return f"{lead} Continue monitoring this cargo on {truck.get('truck_id', 'the truck')}."
