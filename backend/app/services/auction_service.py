from datetime import datetime

from app import db


def build_auction_reasoning(risk_summary: dict | None, eligible_count: int, base_price: int) -> str:
    if risk_summary:
        return (
            f"Triggered from spoilage risk {risk_summary.get('level', 'watch')} "
            f"({risk_summary.get('score', 0)}/100). Base price set to Rs {base_price} "
            f"and broadcast prepared for {eligible_count} nearby shops."
        )
    return f"Base price set to Rs {base_price} and broadcast prepared for {eligible_count} nearby shops."


def upsert_active_auction(payload: dict) -> dict:
    now = datetime.utcnow().isoformat()
    db.auctions.update_many(
        {"status": "active", "auction_id": {"$ne": payload["auction_id"]}},
        {"$set": {"status": "superseded", "ended_at": now}},
    )
    auction_doc = {
        "auction_id": payload["auction_id"],
        "truck_id": payload["truck_id"],
        "batch_item": payload["batch_item"],
        "base_price": int(payload["base_price"]),
        "current_highest_bid": int(payload["base_price"]),
        "highest_bidder_id": None,
        "highest_bidder_name": None,
        "truck_lat": payload.get("truck_lat"),
        "truck_lng": payload.get("truck_lng"),
        "eligible_shop_ids": payload.get("eligible_shop_ids", []),
        "reasoning": payload.get("reasoning", ""),
        "risk_summary": payload.get("risk_summary"),
        "source_shop_id": payload.get("source_shop_id"),
        "source_shop_name": payload.get("source_shop_name"),
        "source_order_id": payload.get("source_order_id"),
        "product_id": payload.get("product_id"),
        "status": "active",
        "started_at": now,
        "ended_at": None,
    }
    db.auctions.update_one({"auction_id": auction_doc["auction_id"]}, {"$set": auction_doc}, upsert=True)
    return auction_doc


def get_active_auction() -> dict | None:
    return db.auctions.find_one({"status": "active"}, {"_id": 0})


def get_recent_auctions(limit: int = 10) -> list[dict]:
    return list(
        db.auctions.find({}, {"_id": 0}).sort("started_at", -1).limit(limit)
    )


def record_bid(auction_id: str, shop_id: str, shop_name: str, amount: int) -> dict:
    bid_doc = {
        "auction_id": auction_id,
        "shop_id": shop_id,
        "shop_name": shop_name,
        "amount": int(amount),
        "time": datetime.utcnow().strftime("%H:%M:%S"),
        "created_at": datetime.utcnow().isoformat(),
    }
    db.auction_bids.insert_one(bid_doc)
    db.auctions.update_one(
        {"auction_id": auction_id},
        {
            "$set": {
                "current_highest_bid": int(amount),
                "highest_bidder_id": shop_id,
                "highest_bidder_name": shop_name,
            }
        },
    )
    return bid_doc


def get_bid_history(auction_id: str, limit: int = 10) -> list[dict]:
    return list(
        db.auction_bids.find({"auction_id": auction_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    )[::-1]


def close_auction(auction_id: str) -> dict | None:
    auction = get_auction_by_id(auction_id)
    if not auction:
        return None
    ended_at = datetime.utcnow().isoformat()
    db.auctions.update_one(
        {"auction_id": auction_id},
        {"$set": {"status": "ended", "ended_at": ended_at}},
    )
    auction["status"] = "ended"
    auction["ended_at"] = ended_at
    return auction


def get_auction_by_id(auction_id: str) -> dict | None:
    return db.auctions.find_one({"auction_id": auction_id}, {"_id": 0})


def finalize_auction_transfer(auction: dict | None) -> dict:
    if not auction:
        return {"transferred": False}

    source_shop_id = auction.get("source_shop_id")
    source_order_id = auction.get("source_order_id")
    winner_id = auction.get("highest_bidder_id")

    if not source_shop_id or not source_order_id or not winner_id or winner_id == source_shop_id:
        return {
            "transferred": False,
            "source_shop_id": source_shop_id,
            "source_order_id": source_order_id,
        }

    order = db.orders.find_one(
        {"order_id": source_order_id, "shop_id": source_shop_id},
        {"_id": 0},
    )
    if not order:
        return {
            "transferred": False,
            "source_shop_id": source_shop_id,
            "source_order_id": source_order_id,
        }

    db.orders.update_one(
        {"order_id": source_order_id, "shop_id": source_shop_id},
        {
            "$set": {
                "status": "Auctioned Away",
                "assigned_truck": None,
                "estimated_delivery": "Diverted via flash auction",
                "last_progress_at": datetime.utcnow().isoformat(),
                "auction_resolution": {
                    "auction_id": auction.get("auction_id"),
                    "winner_id": winner_id,
                    "winner_name": auction.get("highest_bidder_name"),
                    "final_price": auction.get("current_highest_bid"),
                    "truck_id": auction.get("truck_id"),
                    "resolved_at": datetime.utcnow().isoformat(),
                },
                "delivery_stages": [
                    {"stage": "Order Confirmed", "done": True, "time": _safe_stage_time(order, 0)},
                    {"stage": "Truck Assigned", "done": True, "time": _safe_stage_time(order, 0)},
                    {"stage": "Loading Cargo", "done": True, "time": _safe_stage_time(order, 1)},
                    {"stage": "In Transit", "done": True, "time": _safe_stage_time(order, 2)},
                    {"stage": "Auction Diverted", "done": True, "time": datetime.utcnow().strftime("%H:%M")},
                ],
            }
        },
    )

    return {
        "transferred": True,
        "source_shop_id": source_shop_id,
        "source_shop_name": order.get("shop_name"),
        "source_order_id": source_order_id,
    }


def _safe_stage_time(order: dict, index_offset: int) -> str:
    stages = order.get("delivery_stages") or []
    if index_offset < len(stages) and stages[index_offset].get("time"):
        return stages[index_offset]["time"]
    created_at = order.get("created_at")
    if not created_at:
        return ""
    try:
        return datetime.fromisoformat(created_at).strftime("%H:%M")
    except ValueError:
        return ""
