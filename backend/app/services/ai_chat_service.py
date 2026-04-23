import json
from datetime import datetime

from app import db
from app.controllers.auction_controller import active_auction_state
from app.controllers.truck_controller import FLEET
from .gemini_service import GeminiServiceError, gemini_is_configured, generate_json_response


SYSTEM_PROMPT = """You are LiveTrack Copilot, an AI assistant for a supply-chain dashboard.
Answer only using the provided application context.
Be concise, practical, and operations-focused.
Do not claim to perform actions automatically.
Return strict JSON with this shape:
{
  "answer": "string",
  "suggested_actions": ["string"],
  "referenced_entities": {
    "order_ids": ["string"],
    "truck_ids": ["string"],
    "auction_ids": ["string"]
  }
}
If the answer is uncertain, say what data is missing.
"""


def build_chat_response(shop_id: str, question: str, page: str | None = None) -> dict:
    context = build_chat_context(shop_id, question, page)
    fallback = build_fallback_response(context, question)

    response_payload = {
        **fallback,
        "source": "fallback",
        "context_snapshot": context["snapshot"],
        "timestamp": datetime.utcnow().isoformat(),
    }

    if gemini_is_configured():
        try:
            ai_response = generate_json_response(
                SYSTEM_PROMPT,
                build_user_prompt(context, question),
            )
            response_payload.update(normalize_ai_response(ai_response, fallback))
            response_payload["source"] = "gemini"
        except (GeminiServiceError, Exception):
            response_payload["answer"] = (
                f"{fallback['answer']} Gemini is unavailable right now, so this reply "
                "uses the dashboard fallback logic."
            )

    log_interaction(shop_id, question, response_payload, page)
    return response_payload


def build_chat_context(shop_id: str, question: str, page: str | None = None) -> dict:
    shop = db.shops.find_one(
        {"shop_id": shop_id},
        {"_id": 0, "password": 0},
    ) or {}
    recent_orders = list(
        db.orders.find(
            {"shop_id": shop_id},
            {
                "_id": 0,
                "order_id": 1,
                "invoice_number": 1,
                "status": 1,
                "grand_total": 1,
                "assigned_truck": 1,
                "created_at": 1,
                "items.name": 1,
                "items.quantity": 1,
                "items.category": 1,
                "items.shelf_life_days": 1,
            },
        ).sort("created_at", -1).limit(5)
    )

    assigned_truck_ids = sorted(
        {
            order.get("assigned_truck")
            for order in recent_orders
            if order.get("assigned_truck")
        }
    )
    assigned_trucks = [
        FLEET[truck_id]
        for truck_id in assigned_truck_ids
        if truck_id in FLEET
    ]

    active_auction = None
    if active_auction_state.get("is_active"):
        active_auction = {
            "auction_id": active_auction_state.get("auction_id"),
            "truck_id": active_auction_state.get("truck_id"),
            "batch_item": active_auction_state.get("batch_item"),
            "current_highest_bid": active_auction_state.get("current_highest_bid"),
            "highest_bidder_name": active_auction_state.get("highest_bidder_name"),
        }

    snapshot = {
        "shop_name": shop.get("shop_name", "Unknown shop"),
        "green_credits": shop.get("green_credits", 0),
        "total_orders": shop.get("total_orders", 0),
        "recent_order_count": len(recent_orders),
        "assigned_truck_count": len(assigned_trucks),
        "page": page or "unknown",
        "has_active_auction": bool(active_auction),
    }

    return {
        "question": question,
        "page": page or "unknown",
        "shop": shop,
        "recent_orders": recent_orders,
        "assigned_trucks": assigned_trucks,
        "active_auction": active_auction,
        "snapshot": snapshot,
    }


def build_user_prompt(context: dict, question: str) -> str:
    serialized_context = json.dumps(
        {
            "page": context["page"],
            "shop": context["shop"],
            "recent_orders": context["recent_orders"],
            "assigned_trucks": context["assigned_trucks"],
            "active_auction": context["active_auction"],
        },
        ensure_ascii=True,
        default=str,
    )
    return f"Question: {question}\n\nContext JSON:\n{serialized_context}"


def build_fallback_response(context: dict, question: str) -> dict:
    question_lower = question.lower()
    orders = context["recent_orders"]
    trucks = context["assigned_trucks"]
    auction = context["active_auction"]

    if any(term in question_lower for term in ["pending order", "orders", "invoice"]):
        if not orders:
            answer = "You do not have any recent orders yet. Place a wholesale order to start tracking deliveries and invoices."
            actions = ["Browse the catalogue and place your first wholesale order."]
            return build_response(answer, actions, [], [], [])

        open_orders = [order for order in orders if order.get("status") != "Delivered"]
        answer = (
            f"You have {len(open_orders)} active orders out of {len(orders)} recent orders. "
            f"The latest order is {orders[0]['order_id']} with status {orders[0]['status']}."
        )
        actions = ["Open Orders to review statuses and invoice details."]
        return build_response(
            answer,
            actions,
            [order["order_id"] for order in orders[:3]],
            [order["assigned_truck"] for order in orders[:3] if order.get("assigned_truck")],
            [],
        )

    if any(term in question_lower for term in ["warning", "risk", "truck", "fleet"]):
        if not trucks:
            answer = "There are no active delivery trucks assigned to this shop right now."
            actions = ["Place an order to activate fleet tracking for your shop."]
            return build_response(answer, actions, [], [], [])

        risky = [truck for truck in trucks if truck.get("alert_level") in {"warning", "critical"}]
        primary = risky[0] if risky else trucks[0]
        answer = (
            f"{primary['truck_id']} is the highest-priority truck in your fleet view. "
            f"It is {primary['status']} with alert level {primary['alert_level']}, "
            f"temperature {primary['current_temperature']}C, and ETA {primary['eta_hours']}h."
        )
        actions = [
            f"Open {primary['truck_id']} diagnostics for cargo details.",
            "Review current fleet summary on the Fleet dashboard.",
        ]
        return build_response(answer, actions, [], [primary["truck_id"]], [])

    if any(term in question_lower for term in ["bid", "auction"]):
        if not auction:
            answer = "There is no active flash auction right now."
            actions = ["Monitor the fleet dashboard for spoilage alerts and auction notices."]
            return build_response(answer, actions, [], [], [])

        answer = (
            f"Auction {auction['auction_id']} is active for truck {auction['truck_id']}. "
            f"The current highest bid is Rs {auction['current_highest_bid']} for {auction['batch_item']}."
        )
        actions = [
            "Review the auction item and compare it with your current demand.",
            "Only bid if the discounted batch matches your product mix and storage capacity.",
        ]
        return build_response(answer, actions, [], [auction["truck_id"]], [auction["auction_id"]])

    if any(term in question_lower for term in ["restock", "reorder", "stock"]):
        recommendations = suggest_restock_products(orders)
        if recommendations:
            answer = (
                "Based on your recent orders, the strongest restock candidates are "
                + ", ".join(recommendations[:3])
                + "."
            )
            actions = [
                "Review those products in the wholesale catalogue.",
                "Balance short-shelf-life items with smaller quantities if demand is uncertain.",
            ]
        else:
            answer = "There is not enough order history yet for a confident restock suggestion."
            actions = ["Place a few orders first so the assistant can spot reorder patterns."]
        return build_response(answer, actions, [], [], [])

    answer = (
        f"{context['shop'].get('shop_name', 'Your shop')} currently has "
        f"{context['snapshot']['recent_order_count']} recent orders, "
        f"{context['snapshot']['assigned_truck_count']} tracked trucks, and "
        f"{context['snapshot']['green_credits']} green credits."
    )
    actions = [
        "Ask me to summarize orders, explain a truck warning, or suggest a restock.",
    ]
    return build_response(
        answer,
        actions,
        [order["order_id"] for order in orders[:2]],
        [truck["truck_id"] for truck in trucks[:2]],
        [auction["auction_id"]] if auction else [],
    )


def build_response(answer: str, actions: list[str], order_ids: list[str], truck_ids: list[str], auction_ids: list[str]) -> dict:
    return {
        "answer": answer,
        "suggested_actions": actions[:3],
        "referenced_entities": {
            "order_ids": order_ids,
            "truck_ids": truck_ids,
            "auction_ids": auction_ids,
        },
    }


def normalize_ai_response(ai_response: dict, fallback: dict) -> dict:
    entities = ai_response.get("referenced_entities") or {}
    return {
        "answer": ai_response.get("answer") or fallback["answer"],
        "suggested_actions": (ai_response.get("suggested_actions") or fallback["suggested_actions"])[:3],
        "referenced_entities": {
            "order_ids": entities.get("order_ids") or fallback["referenced_entities"]["order_ids"],
            "truck_ids": entities.get("truck_ids") or fallback["referenced_entities"]["truck_ids"],
            "auction_ids": entities.get("auction_ids") or fallback["referenced_entities"]["auction_ids"],
        },
    }


def suggest_restock_products(orders: list[dict]) -> list[str]:
    counts: dict[str, int] = {}
    for order in orders:
        for item in order.get("items", []):
            name = item.get("name")
            if not name:
                continue
            counts[name] = counts.get(name, 0) + int(item.get("quantity", 0))
    return [name for name, _ in sorted(counts.items(), key=lambda item: item[1], reverse=True)]


def log_interaction(shop_id: str, question: str, response_payload: dict, page: str | None) -> None:
    try:
        db.ai_interactions.insert_one(
            {
                "shop_id": shop_id,
                "page": page or "unknown",
                "question": question,
                "source": response_payload.get("source", "fallback"),
                "answer": response_payload.get("answer", ""),
                "suggested_actions": response_payload.get("suggested_actions", []),
                "referenced_entities": response_payload.get("referenced_entities", {}),
                "created_at": datetime.utcnow().isoformat(),
            }
        )
    except Exception:
        return
