import json
from datetime import datetime

from app import db
from app.controllers.auction_controller import active_auction_state
from app.services.fleet_automation_service import get_trucks_for_ids, seed_trucks_if_needed, sync_and_advance_fleet
from app.services.gemini_service import GeminiServiceError, gemini_is_configured, generate_json_response
from app.services.spoilage_risk_service import summarize_truck_risk


SHIPMENT_INSIGHTS_PROMPT = """You are LiveTrack Shipment Insights.
You receive structured fleet, risk, and auction context for a supply-chain dashboard.
Return strict JSON with this shape:
{
  "summary": "string",
  "highlights": ["string"]
}
Keep it concise, operational, and grounded in the data.
Do not invent actions that have already been performed.
"""


def build_shipment_insights(shop_id: str, use_ai: bool = True) -> dict:
    seed_trucks_if_needed()
    sync_and_advance_fleet()

    active_orders = list(
        db.orders.find(
            {"shop_id": shop_id, "assigned_truck": {"$exists": True}, "status": {"$ne": "Delivered"}},
            {"_id": 0, "assigned_truck": 1, "order_id": 1, "status": 1, "items": 1},
        )
    )
    if not active_orders:
        return {
            "summary": "There are no active shipments for this shop right now.",
            "highlights": ["Place a wholesale order to start live fleet tracking and shipment insights."],
            "source": "fallback",
            "generated_at": datetime.utcnow().isoformat(),
        }

    truck_ids = sorted({order.get("assigned_truck") for order in active_orders if order.get("assigned_truck")})
    items_by_truck = {}
    for order in active_orders:
        truck_id = order.get("assigned_truck")
        if not truck_id:
            continue
        items_by_truck.setdefault(truck_id, []).extend(order.get("items", []))

    enriched_trucks = []
    for truck in get_trucks_for_ids(truck_ids):
        risk = summarize_truck_risk(truck, items_by_truck.get(truck["truck_id"], []), use_ai=False)
        enriched_trucks.append({**truck, "risk_summary": risk})

    enriched_trucks.sort(
        key=lambda truck: (
            risk_priority((truck.get("risk_summary") or {}).get("level")),
            (truck.get("risk_summary") or {}).get("score", 0),
            -(truck.get("eta_hours", 0) or 0),
        ),
        reverse=True,
    )

    payload = {
        "active_order_count": len(active_orders),
        "tracked_truck_count": len(enriched_trucks),
        "fleet": [
            {
                "truck_id": truck["truck_id"],
                "status": truck.get("status"),
                "origin": truck.get("origin"),
                "destination": truck.get("destination"),
                "eta_hours": truck.get("eta_hours"),
                "distance_left_km": truck.get("distance_left_km"),
                "current_temperature": truck.get("current_temperature"),
                "alert_level": truck.get("alert_level"),
                "risk_summary": truck.get("risk_summary"),
            }
            for truck in enriched_trucks
        ],
        "active_auction": serialize_active_auction(),
    }

    fallback = fallback_shipment_insights(payload)
    response = {
        **fallback,
        "source": "fallback",
        "generated_at": datetime.utcnow().isoformat(),
    }

    if use_ai and gemini_is_configured():
        try:
            ai_response = generate_json_response(
                SHIPMENT_INSIGHTS_PROMPT,
                json.dumps(payload, ensure_ascii=True, default=str),
            )
            response["summary"] = ai_response.get("summary") or response["summary"]
            response["highlights"] = (ai_response.get("highlights") or response["highlights"])[:4]
            response["source"] = "gemini"
        except (GeminiServiceError, Exception):
            pass

    return response


def fallback_shipment_insights(payload: dict) -> dict:
    fleet = payload["fleet"]
    top_truck = fleet[0]
    warning_count = sum(1 for truck in fleet if (truck.get("risk_summary") or {}).get("level") in {"warning", "critical"})
    in_transit_count = sum(1 for truck in fleet if truck.get("status") == "In Transit")
    auction = payload.get("active_auction")

    summary = (
        f"{payload['tracked_truck_count']} tracked shipment"
        f"{'s' if payload['tracked_truck_count'] != 1 else ''}, "
        f"{in_transit_count} in transit, and {warning_count} at elevated spoilage risk. "
        f"Top priority is {top_truck['truck_id']} with {top_truck['risk_summary']['level']} risk "
        f"at {top_truck['risk_summary']['score']}/100 and ETA {top_truck.get('eta_hours', 0)}h."
    )

    highlights = [
        f"{top_truck['truck_id']} is heading {top_truck.get('origin')} -> {top_truck.get('destination')} with cabin temperature {top_truck.get('current_temperature')}C.",
        top_truck["risk_summary"].get("recommended_action", "Review the highest-risk truck in the diagnostics view."),
    ]

    if auction:
        highlights.append(
            f"Auction {auction['auction_id']} is active for {auction['truck_id']} at Rs {auction['current_highest_bid']}."
        )
    else:
        highlights.append("No live flash auction is active right now.")

    if warning_count == 0:
        highlights.append("No trucks are currently in warning or critical risk state.")

    return {
        "summary": summary,
        "highlights": highlights[:4],
    }


def serialize_active_auction():
    if not active_auction_state.get("is_active"):
        return None
    return {
        "auction_id": active_auction_state.get("auction_id"),
        "truck_id": active_auction_state.get("truck_id"),
        "current_highest_bid": active_auction_state.get("current_highest_bid"),
        "batch_item": active_auction_state.get("batch_item"),
        "reasoning": active_auction_state.get("reasoning"),
    }


def risk_priority(level: str | None) -> int:
    return {
        "safe": 0,
        "watch": 1,
        "warning": 2,
        "critical": 3,
    }.get(level or "safe", 0)
