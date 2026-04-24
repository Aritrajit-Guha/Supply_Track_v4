from flask import Blueprint, jsonify, request
from flask_socketio import emit
import datetime

from app import db, socketio
from app.services.auction_service import (
    build_auction_reasoning,
    close_auction,
    finalize_auction_transfer,
    get_active_auction,
    get_auction_by_id,
    get_bid_history,
    get_recent_auctions,
    record_bid,
    upsert_active_auction,
)

auction_bp = Blueprint('auction', __name__)

active_auction_state = {
    "is_active": False,
    "auction_id": None,
    "truck_id": None,
    "batch_item": None,
    "base_price": 0,
    "current_highest_bid": 0,
    "highest_bidder_id": None,
    "highest_bidder_name": None,
    "started_at": None,
    "bid_history": [],
    "reasoning": "",
    "eligible_shop_ids": [],
    "risk_summary": None,
}


def sync_active_auction_state() -> dict:
    active = get_active_auction()
    if not active:
        active_auction_state.update({
            "is_active": False,
            "auction_id": None,
            "truck_id": None,
            "batch_item": None,
            "base_price": 0,
            "current_highest_bid": 0,
            "highest_bidder_id": None,
            "highest_bidder_name": None,
            "started_at": None,
            "bid_history": [],
            "reasoning": "",
            "eligible_shop_ids": [],
            "risk_summary": None,
        })
        return active_auction_state

    history = get_bid_history(active["auction_id"], limit=20)
    active_auction_state.update({
        "is_active": True,
        "auction_id": active["auction_id"],
        "truck_id": active["truck_id"],
        "batch_item": active["batch_item"],
        "base_price": active.get("base_price", 0),
        "current_highest_bid": active.get("current_highest_bid", active.get("base_price", 0)),
        "highest_bidder_id": active.get("highest_bidder_id"),
        "highest_bidder_name": active.get("highest_bidder_name"),
        "started_at": active.get("started_at"),
        "bid_history": history,
        "reasoning": active.get("reasoning", ""),
        "eligible_shop_ids": active.get("eligible_shop_ids", []),
        "risk_summary": active.get("risk_summary"),
    })
    return active_auction_state


def compute_eligible_shops(truck_lat, truck_lng, radius_km=20):
    if truck_lat is None or truck_lng is None:
        return []
    return [
        shop["shop_id"]
        for shop in db.shops.find(
            {
                "lat": {"$gte": float(truck_lat) - 1, "$lte": float(truck_lat) + 1},
                "lng": {"$gte": float(truck_lng) - 1, "$lte": float(truck_lng) + 1},
            },
            {"_id": 0, "shop_id": 1},
        )
    ]


def start_auction_in_memory(auction_id, truck_id, batch_item, base_price,
                             truck_lat=23.574183559967356, truck_lng=87.32041803582375,
                             reasoning="", risk_summary=None, source_shop_id=None,
                             source_shop_name=None, source_order_id=None, product_id=None):
    eligible_shop_ids = compute_eligible_shops(truck_lat, truck_lng)
    if not reasoning:
        reasoning = build_auction_reasoning(risk_summary, len(eligible_shop_ids), int(base_price))

    auction_doc = upsert_active_auction({
        "auction_id": auction_id,
        "truck_id": truck_id,
        "batch_item": batch_item,
        "base_price": int(base_price),
        "truck_lat": truck_lat,
        "truck_lng": truck_lng,
        "eligible_shop_ids": eligible_shop_ids,
        "reasoning": reasoning,
        "risk_summary": risk_summary,
        "source_shop_id": source_shop_id,
        "source_shop_name": source_shop_name,
        "source_order_id": source_order_id,
        "product_id": product_id,
    })
    sync_active_auction_state()

    emergency_data = {
        "auction_id": auction_doc["auction_id"],
        "truck_id": auction_doc["truck_id"],
        "batch_item": auction_doc["batch_item"],
        "current_price": auction_doc["current_highest_bid"],
        "time_limit": 60,
        "truck_lat": truck_lat,
        "truck_lng": truck_lng,
        "reasoning": reasoning,
        "eligible_shop_ids": eligible_shop_ids,
        "risk_summary": risk_summary,
        "source_shop_id": source_shop_id,
        "source_shop_name": source_shop_name,
        "source_order_id": source_order_id,
        "product_id": product_id,
    }

    socketio.emit('emergency_auction_started', emergency_data)
    print(f"[AUCTION] Started: {auction_id} | Item: {batch_item} | Base: Rs {base_price}")


@auction_bp.route('/test-trigger', methods=['GET'])
def test_trigger():
    start_auction_in_memory(
        auction_id="A-DEMO-001",
        truck_id="T-1001",
        batch_item="20kg Frozen Chicken Breasts (Temp Breach: 15C)",
        base_price=800,
        truck_lat=23.574183559967356,
        truck_lng=87.32041803582375
    )
    return jsonify({"status": "Success", "message": "Demo auction started!"}), 200


@auction_bp.route('/trigger', methods=['POST'])
def trigger_auction():
    data = request.json or {}
    start_auction_in_memory(
        auction_id=data.get('auction_id', f"A-{datetime.datetime.utcnow().strftime('%H%M%S')}"),
        truck_id=data.get('truck_id', 'T-1001'),
        batch_item=data.get('batch_item', 'Unknown Batch'),
        base_price=data.get('base_price', 500),
        truck_lat=data.get('truck_lat', 23.5742),
        truck_lng=data.get('truck_lng', 87.3203),
        reasoning=data.get('reasoning', ''),
        risk_summary=data.get('risk_summary'),
        source_shop_id=data.get('source_shop_id'),
        source_shop_name=data.get('source_shop_name'),
        source_order_id=data.get('source_order_id'),
        product_id=data.get('product_id'),
    )
    return jsonify({"status": "Auction triggered"}), 200


@auction_bp.route('/status', methods=['GET'])
def get_auction_status():
    state = dict(sync_active_auction_state())
    return jsonify(state), 200


@auction_bp.route('/history', methods=['GET'])
def get_auction_history():
    return jsonify(get_recent_auctions()), 200


@auction_bp.route('/bids/<auction_id>', methods=['GET'])
def get_bid_history_route(auction_id):
    return jsonify(get_bid_history(auction_id, limit=20)), 200


@socketio.on('submit_bid')
def handle_bid(data):
    sync_active_auction_state()
    new_bid = int(data.get('bid_amount', 0))
    shop_id = data.get('shop_id', 'unknown')
    shop_name = data.get('shop_name', 'Unknown Shop')
    auction_id = data.get('auction_id') or active_auction_state["auction_id"]

    if not active_auction_state["is_active"] or not auction_id:
        emit('bid_rejected', {"reason": "No active auction"})
        return

    if new_bid <= active_auction_state["current_highest_bid"]:
        emit('bid_rejected', {
            "reason": f"Bid must be higher than Rs {active_auction_state['current_highest_bid']}"
        })
        return

    record_bid(auction_id, shop_id, shop_name, new_bid)
    sync_active_auction_state()

    emit('price_update', {
        "new_price": active_auction_state["current_highest_bid"],
        "bidder_id": active_auction_state["highest_bidder_id"],
        "bidder_name": active_auction_state["highest_bidder_name"],
        "bid_history": active_auction_state["bid_history"][-5:],
    }, broadcast=True)


@socketio.on('auction_ended')
def handle_auction_end(data):
    auction_id = (data or {}).get('auction_id') or active_auction_state.get("auction_id")
    if not auction_id:
        return

    auction = close_auction(auction_id)
    sync_active_auction_state()
    if not auction:
        return
    transfer_result = finalize_auction_transfer(auction)

    socketio.emit('auction_result', {
        "winner_id": auction.get("highest_bidder_id"),
        "winner_name": auction.get("highest_bidder_name"),
        "final_price": auction.get("current_highest_bid"),
        "auction_id": auction.get("auction_id"),
        "truck_id": auction.get("truck_id"),
        "source_shop_id": auction.get("source_shop_id"),
        "source_shop_name": auction.get("source_shop_name"),
        "source_order_id": auction.get("source_order_id"),
        "product_id": auction.get("product_id"),
        "order_transferred": transfer_result.get("transferred", False),
    })

    print(f"[AUCTION ENDED] Winner: {auction.get('highest_bidder_name')} | Price: Rs {auction.get('current_highest_bid')}")
