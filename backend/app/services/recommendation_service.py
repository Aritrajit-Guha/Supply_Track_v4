import json
from datetime import datetime

from app import db
from .gemini_service import GeminiServiceError, gemini_is_configured, generate_json_response


RECOMMENDATION_PROMPT = """You are LiveTrack Restock Copilot.
You receive structured recommendation candidates for a retail shop.
Return strict JSON with this shape:
{
  "summary": "string",
  "highlights": ["string"]
}
Keep it concise, practical, and grounded in the provided data.
"""


def build_shop_recommendations(shop_id: str, use_ai: bool = False) -> dict:
    orders = list(
        db.orders.find(
            {"shop_id": shop_id},
            {"_id": 0, "created_at": 1, "items": 1, "grand_total": 1},
        ).sort("created_at", -1).limit(12)
    )
    products = list(db.products.find({}, {"_id": 0}))
    product_lookup = {product["product_id"]: product for product in products}

    if not orders:
        return {
            "summary": "There is not enough order history yet for personalized restock suggestions.",
            "recommendations": [],
            "highlights": ["Place a few wholesale orders first so the system can learn your demand pattern."],
        }

    grouped = {}
    for order in orders:
        created_at = parse_dt(order.get("created_at"))
        for item in order.get("items", []):
            product_id = item.get("product_id")
            if not product_id:
                continue
            bucket = grouped.setdefault(
                product_id,
                {
                    "product_id": product_id,
                    "name": item.get("name"),
                    "category": item.get("category"),
                    "unit": item.get("unit"),
                    "supplier": item.get("supplier"),
                    "storage_temp": item.get("storage_temp"),
                    "shelf_life_days": item.get("shelf_life_days", 0),
                    "order_count": 0,
                    "total_quantity": 0,
                    "last_order_at": None,
                },
            )
            bucket["order_count"] += 1
            bucket["total_quantity"] += int(item.get("quantity", 0))
            if created_at and (bucket["last_order_at"] is None or created_at > bucket["last_order_at"]):
                bucket["last_order_at"] = created_at

    ranked = []
    for product_id, info in grouped.items():
        product = product_lookup.get(product_id, {})
        avg_quantity = round(info["total_quantity"] / max(info["order_count"], 1), 1)
        days_since_last = days_since(info["last_order_at"])
        reorder_signal = (info["order_count"] * 8) + min(days_since_last * 2, 20)
        if info["shelf_life_days"] <= 5:
            action = "reduce_quantity" if avg_quantity >= 20 else "reorder_soon"
            message = f"{info['name']} moves fast but has short shelf life, so keep replenishing in tighter batches."
        elif avg_quantity >= 20:
            action = "consider_bulk"
            message = f"{info['name']} is ordered in large quantities often enough to justify a bulk restock."
        else:
            action = "reorder_soon"
            message = f"{info['name']} is a recurring item and is due for another restock soon."

        ranked.append(
            {
                "product_id": product_id,
                "name": info["name"],
                "category": info["category"],
                "unit": info["unit"],
                "supplier": info["supplier"],
                "storage_temp": info["storage_temp"],
                "shelf_life_days": info["shelf_life_days"],
                "avg_quantity": avg_quantity,
                "days_since_last_order": days_since_last,
                "current_price": product.get("price_per_unit"),
                "action": action,
                "message": message,
                "score": reorder_signal,
            }
        )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    top = ranked[:4]

    response = {
        "summary": fallback_summary(top),
        "recommendations": top,
        "highlights": [item["message"] for item in top[:3]],
    }

    if use_ai and gemini_is_configured() and top:
        try:
            ai_response = generate_json_response(
                RECOMMENDATION_PROMPT,
                json.dumps({"shop_id": shop_id, "recommendations": top}, ensure_ascii=True, default=str),
            )
            response["summary"] = ai_response.get("summary") or response["summary"]
            response["highlights"] = (ai_response.get("highlights") or response["highlights"])[:3]
        except (GeminiServiceError, Exception):
            pass

    return response


def parse_dt(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def days_since(dt_value) -> int:
    if not dt_value:
        return 999
    return max(0, (datetime.utcnow() - dt_value).days)


def fallback_summary(recommendations: list[dict]) -> str:
    if not recommendations:
        return "No recommendation candidates are available right now."
    names = ", ".join(item["name"] for item in recommendations[:3])
    return f"Based on recent order history, the strongest restock candidates are {names}."
