from flask import Blueprint, jsonify, request
from app import db, socketio
from .auction_controller import start_auction_in_memory
from app.services.fleet_automation_service import (
    TRUCK_BLUEPRINTS,
    get_truck_doc,
    get_trucks_for_ids,
    seed_trucks_if_needed,
    sync_and_advance_fleet,
)
import jwt
import os

truck_bp = Blueprint('truck', __name__)


# Product image map â€” matches catalogue product_ids to Unsplash images
PRODUCT_IMAGES = {
    "PRD-001": "https://images.unsplash.com/photo-1601493700631-2b16ec4b4716?w=200&q=80",
    "PRD-002": "https://images.unsplash.com/photo-1603833665858-e61d17a86224?w=200&q=80",
    "PRD-003": "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=200&q=80",
    "PRD-004": "https://images.unsplash.com/photo-1587735243615-c03f25aaff15?w=200&q=80",
    "PRD-005": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=200&q=80",
    "PRD-006": "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&q=80",
    "PRD-007": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=200&q=80",
    "PRD-008": "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=200&q=80",
    "PRD-009": "https://images.unsplash.com/photo-1598974542316-24e03bc29c0f?w=200&q=80",
    "PRD-010": "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&q=80",
    "PRD-011": "https://images.unsplash.com/photo-1599940824399-b87987ceb72a?w=200&q=80",
    "PRD-012": "https://images.unsplash.com/photo-1506976785307-8732e854ad02?w=200&q=80",
    "PRD-013": "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=200&q=80",
    "PRD-014": "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=200&q=80",
    "PRD-015": "https://images.unsplash.com/photo-1559181567-c3190ca9be46?w=200&q=80",
}


def get_shop_from_token():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth.split(' ')[1]
    try:
        secret = os.getenv('JWT_SECRET', 'fallback_secret')
        return jwt.decode(token, secret, algorithms=['HS256'])
    except Exception:
        return None


@truck_bp.route('/fleet', methods=['GET'])
def get_fleet():
    """
    Returns only the trucks that have active orders from this shop.
    If no orders yet, returns an empty array.
    """
    shop = get_shop_from_token()
    if not shop:
        return jsonify([]), 200

    seed_trucks_if_needed()
    sync_and_advance_fleet()

    shop_orders = list(db.orders.find(
        {"shop_id": shop['shop_id'], "assigned_truck": {"$exists": True}, "status": {"$ne": "Delivered"}},
        {"assigned_truck": 1}
    ))
    assigned_truck_ids = list(set(o['assigned_truck'] for o in shop_orders if o.get('assigned_truck')))

    if not assigned_truck_ids:
        return jsonify([]), 200

    return jsonify(get_trucks_for_ids(assigned_truck_ids)), 200


@truck_bp.route('/status', methods=['GET'])
def get_truck_status():
    seed_trucks_if_needed()
    truck = get_truck_doc("T-1001")
    return jsonify(truck or {}), 200


@truck_bp.route('/status/<truck_id>', methods=['GET'])
def get_single_truck(truck_id):
    seed_trucks_if_needed()
    truck = get_truck_doc(truck_id)
    if not truck:
        return jsonify({"error": "Truck not found"}), 404
    return jsonify(truck), 200


@truck_bp.route('/cargo/<truck_id>', methods=['GET'])
def get_truck_cargo(truck_id):
    """
    Returns the real cargo batches for a truck â€” built from
    the authenticated shop's actual order items for that truck.
    """
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401

    seed_trucks_if_needed()
    sync_and_advance_fleet()
    truck = get_truck_doc(truck_id)
    if not truck:
        return jsonify({"error": "Truck not found"}), 404

    orders = list(db.orders.find(
        {"shop_id": shop['shop_id'], "assigned_truck": truck_id},
        {"_id": 0, "order_id": 1, "items": 1, "status": 1}
    ))

    cargo_batches = []
    for order in orders:
        for item in order.get('items', []):
            temp = truck['current_temperature']
            storage = item.get('storage_temp', '')
            is_spoiling = False
            if '-18' in storage and temp > -10:
                is_spoiling = True
            elif '2-4' in storage and temp > 8:
                is_spoiling = True
            elif '4-8' in storage and temp > 12:
                is_spoiling = True
            elif '12' in storage and temp > 20:
                is_spoiling = True

            shelf = item.get('shelf_life_days', 30)
            if shelf <= 3:
                health = 'Critical'
            elif shelf <= 7:
                health = 'Warning'
            elif shelf <= 14:
                health = 'Good'
            else:
                health = 'Excellent'

            cargo_batches.append({
                "id":         f"{item['product_id']}-{order['order_id'][-4:]}",
                "product_id": item['product_id'],
                "name":       item['name'],
                "quantity":   item['quantity'],
                "unit":       item['unit'],
                "temp":       temp,
                "health":     health,
                "expiry":     f"{shelf} days",
                "storage_temp": item.get('storage_temp', 'N/A'),
                "supplier":   item.get('supplier', ''),
                "order_id":   order['order_id'],
                "image":      PRODUCT_IMAGES.get(
                    item['product_id'],
                    "https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&q=80",
                ),
                "isSpoiling": is_spoiling,
                "spanRow":    1,
                "spanCol":    1,
            })

    return jsonify({
        "truck":   truck,
        "cargo":   cargo_batches,
        "shop_id": shop['shop_id'],
    }), 200


@truck_bp.route('/sensor-update', methods=['POST'])
def receive_sensor_data():
    data = request.json
    truck_id = data.get("truck_id")
    batch_id = data.get("batch_id")
    batch_name = data.get("batch_name")
    current_temp = data.get("temp")
    truck_lat = data.get("truck_lat", 23.5742)
    truck_lng = data.get("truck_lng", 87.3203)

    print(f"[SERVER] IoT Ping from {truck_id} | Batch: {batch_id} | Temp: {current_temp}C")

    if truck_id in TRUCK_BLUEPRINTS:
        alert_level = "normal"
        if current_temp > 0 and TRUCK_BLUEPRINTS[truck_id].get("cargo_type") == "Frozen Goods":
            alert_level = "critical"
        elif current_temp > 8:
            alert_level = "warning"

        db.trucks.update_one(
            {"truck_id": truck_id},
            {
                "$set": {
                    "current_temperature": current_temp,
                    "alert_level": alert_level,
                    "last_sensor_update": {
                        "batch_id": batch_id,
                        "batch_name": batch_name,
                        "temp": current_temp,
                    },
                }
            },
            upsert=True,
        )
        socketio.emit("fleet_updated", {"truck_id": truck_id, "alert_level": alert_level})

    if current_temp > 0:
        print(f"[ALERT] Critical temp in {batch_id}. Triggering auction...")
        start_auction_in_memory(
            auction_id=f"A-{batch_id}",
            truck_id=truck_id,
            batch_item=f"URGENT: {batch_name} (Temp Breach: {current_temp}C)",
            base_price=800,
            truck_lat=truck_lat,
            truck_lng=truck_lng,
        )
        return jsonify({"status": "Anomaly Detected", "action": "Auction Triggered"}), 200

    return jsonify({"status": "Normal", "action": "None"}), 200
