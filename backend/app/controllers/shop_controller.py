from flask import Blueprint, request, jsonify
from app import db, socketio
from app.services.fleet_automation_service import seed_trucks_if_needed, sync_and_advance_fleet
from app.services.recommendation_service import build_shop_recommendations
import jwt
import os
import uuid
from datetime import datetime

shop_bp = Blueprint('shop', __name__)

TRUCK_POOL = ["T-1001", "T-1002", "T-1003"]


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


def calculate_green_credits(order_lines, grand_total):
    credits = int(grand_total / 500)
    if any(i['shelf_life_days'] <= 10 for i in order_lines):
        credits += 5
    if any(i['quantity'] >= 20 for i in order_lines):
        credits += 3
    return max(credits, 1)


@shop_bp.route('/catalogue', methods=['GET'])
def get_catalogue():
    if db.products.count_documents({}) == 0:
        _seed_catalogue()
    products = list(db.products.find({}, {'_id': 0}))
    return jsonify(products), 200


def _seed_catalogue():
    catalogue = [
        {"product_id": "PRD-001", "name": "Alphonso Mangoes", "category": "Fruits",
         "unit": "Box (12 pcs)", "price_per_unit": 450, "min_order": 10,
         "wholesale_note": "Min 10 boxes for wholesale price",
         "shelf_life_days": 7, "storage_temp": "18-22C",
         "image": "https://images.unsplash.com/photo-1601493700631-2b16ec4b4716?w=300&q=80",
         "supplier": "Fresh Farms Pvt Ltd", "stock_available": 500},

        {"product_id": "PRD-002", "name": "Bananas (Cavendish)", "category": "Fruits",
         "unit": "Bunch (6 pcs)", "price_per_unit": 55, "min_order": 50,
         "wholesale_note": "Min 50 bunches",
         "shelf_life_days": 5, "storage_temp": "12-14C",
         "image": "https://images.unsplash.com/photo-1603833665858-e61d17a86224?w=300&q=80",
         "supplier": "Green Valley Traders", "stock_available": 2000},

        {"product_id": "PRD-003", "name": "Tomatoes Grade A", "category": "Vegetables",
         "unit": "Crate (10 kg)", "price_per_unit": 300, "min_order": 10,
         "wholesale_note": "Min 10 crates = 100 kg",
         "shelf_life_days": 10, "storage_temp": "12-15C",
         "image": "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=300&q=80",
         "supplier": "Kisan Direct Co.", "stock_available": 300},

        {"product_id": "PRD-004", "name": "Onions (Nashik)", "category": "Vegetables",
         "unit": "Sack (50 kg)", "price_per_unit": 900, "min_order": 5,
         "wholesale_note": "Min 5 sacks = 250 kg",
         "shelf_life_days": 60, "storage_temp": "15-20C",
         "image": "https://images.unsplash.com/photo-1587735243615-c03f25aaff15?w=300&q=80",
         "supplier": "Kisan Direct Co.", "stock_available": 200},

        {"product_id": "PRD-005", "name": "Potatoes (Jyoti)", "category": "Vegetables",
         "unit": "Sack (50 kg)", "price_per_unit": 950, "min_order": 5,
         "wholesale_note": "Min 5 sacks = 250 kg",
         "shelf_life_days": 30, "storage_temp": "10-15C",
         "image": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=300&q=80",
         "supplier": "Agro Star India", "stock_available": 400},

        {"product_id": "PRD-006", "name": "Full Cream Milk", "category": "Dairy",
         "unit": "Pouch (1 L)", "price_per_unit": 58, "min_order": 100,
         "wholesale_note": "Min 100 pouches",
         "shelf_life_days": 2, "storage_temp": "2-4C",
         "image": "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=300&q=80",
         "supplier": "Mother Dairy", "stock_available": 5000},

        {"product_id": "PRD-007", "name": "Paneer Fresh Block", "category": "Dairy",
         "unit": "Block (1 kg)", "price_per_unit": 260, "min_order": 20,
         "wholesale_note": "Min 20 kg",
         "shelf_life_days": 5, "storage_temp": "2-4C",
         "image": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=300&q=80",
         "supplier": "Mother Dairy", "stock_available": 500},

        {"product_id": "PRD-008", "name": "Frozen Chicken Breasts", "category": "Frozen",
         "unit": "Carton (10 kg)", "price_per_unit": 1800, "min_order": 5,
         "wholesale_note": "Min 5 cartons = 50 kg",
         "shelf_life_days": 180, "storage_temp": "-18C",
         "image": "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=300&q=80",
         "supplier": "Venky's Foods", "stock_available": 200},

        {"product_id": "PRD-009", "name": "Frozen Green Peas", "category": "Frozen",
         "unit": "Bag (5 kg)", "price_per_unit": 380, "min_order": 20,
         "wholesale_note": "Min 20 bags = 100 kg",
         "shelf_life_days": 365, "storage_temp": "-18C",
         "image": "https://images.unsplash.com/photo-1598974542316-24e03bc29c0f?w=300&q=80",
         "supplier": "ITC Agri Business", "stock_available": 1000},

        {"product_id": "PRD-010", "name": "Basmati Rice Premium", "category": "Grains",
         "unit": "Sack (25 kg)", "price_per_unit": 1750, "min_order": 4,
         "wholesale_note": "Min 4 sacks = 100 kg",
         "shelf_life_days": 365, "storage_temp": "Room temp",
         "image": "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300&q=80",
         "supplier": "India Gate Foods", "stock_available": 300},

        {"product_id": "PRD-011", "name": "Toor Dal", "category": "Grains",
         "unit": "Sack (25 kg)", "price_per_unit": 1950, "min_order": 4,
         "wholesale_note": "Min 4 sacks = 100 kg",
         "shelf_life_days": 180, "storage_temp": "Room temp",
         "image": "https://images.unsplash.com/photo-1599940824399-b87987ceb72a?w=300&q=80",
         "supplier": "Agro Star India", "stock_available": 250},

        {"product_id": "PRD-012", "name": "Farm Fresh Eggs", "category": "Poultry",
         "unit": "Tray (30 pcs)", "price_per_unit": 185, "min_order": 20,
         "wholesale_note": "Min 20 trays = 600 eggs",
         "shelf_life_days": 21, "storage_temp": "4-8C",
         "image": "https://images.unsplash.com/photo-1506976785307-8732e854ad02?w=300&q=80",
         "supplier": "Kegg Farms", "stock_available": 2000},

        {"product_id": "PRD-013", "name": "Sunflower Oil", "category": "Oils",
         "unit": "Can (15 L)", "price_per_unit": 1650, "min_order": 10,
         "wholesale_note": "Min 10 cans = 150 L",
         "shelf_life_days": 365, "storage_temp": "Room temp",
         "image": "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=300&q=80",
         "supplier": "Fortune Foods", "stock_available": 500},

        {"product_id": "PRD-014", "name": "Wheat Flour (Atta)", "category": "Grains",
         "unit": "Sack (50 kg)", "price_per_unit": 1800, "min_order": 5,
         "wholesale_note": "Min 5 sacks = 250 kg",
         "shelf_life_days": 180, "storage_temp": "Room temp",
         "image": "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=300&q=80",
         "supplier": "Aashirvaad", "stock_available": 400},

        {"product_id": "PRD-015", "name": "Sugar (M-30 Grade)", "category": "Grains",
         "unit": "Sack (50 kg)", "price_per_unit": 2100, "min_order": 5,
         "wholesale_note": "Min 5 sacks = 250 kg",
         "shelf_life_days": 730, "storage_temp": "Room temp",
         "image": "https://images.unsplash.com/photo-1559181567-c3190ca9be46?w=300&q=80",
         "supplier": "Renuka Sugars", "stock_available": 600},
    ]
    db.products.insert_many(catalogue)
    print(f"✅ Seeded {len(catalogue)} wholesale products.")


@shop_bp.route('/orders', methods=['POST'])
def place_order():
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401

    seed_trucks_if_needed()
    data       = request.json
    cart_items = data.get('items', [])
    if not cart_items:
        return jsonify({"error": "Cart is empty"}), 400

    order_lines = []
    grand_total = 0

    for item in cart_items:
        product = db.products.find_one({"product_id": item['product_id']}, {'_id': 0})
        if not product:
            return jsonify({"error": f"Product {item['product_id']} not found"}), 404
        qty        = int(item['quantity'])
        line_total = product['price_per_unit'] * qty
        grand_total += line_total
        order_lines.append({
            "product_id":      product['product_id'],
            "name":            product['name'],
            "category":        product['category'],
            "unit":            product['unit'],
            "price_per_unit":  product['price_per_unit'],
            "quantity":        qty,
            "line_total":      line_total,
            "shelf_life_days": product['shelf_life_days'],
            "storage_temp":    product['storage_temp'],
            "supplier":        product['supplier'],
        })

    # Assign truck round-robin
    shop_db     = db.shops.find_one({"shop_id": shop['shop_id']})
    order_count = shop_db.get('total_orders', 0) if shop_db else 0
    assigned_truck = TRUCK_POOL[order_count % len(TRUCK_POOL)]

    credits_earned = calculate_green_credits(order_lines, grand_total)

    order_id       = f"ORD-{str(uuid.uuid4())[:8].upper()}"
    invoice_number = f"INV-{datetime.utcnow().strftime('%Y%m%d')}-{str(uuid.uuid4())[:4].upper()}"

    new_order = {
        "order_id":          order_id,
        "invoice_number":    invoice_number,
        "shop_id":           shop['shop_id'],
        "shop_name":         shop['shop_name'],
        "items":             order_lines,
        "grand_total":       grand_total,
        "status":            "Confirmed",
        "payment_status":    "Paid",
        "assigned_truck":    assigned_truck,
        "credits_earned":    credits_earned,
        "created_at":        datetime.utcnow().isoformat(),
        "estimated_delivery": "3-6 hours",
        "notes":             data.get('notes', ''),
        "delivery_stages": [
            {"stage": "Order Confirmed", "done": True,  "time": datetime.utcnow().strftime("%H:%M")},
            {"stage": "Truck Assigned",  "done": True,  "time": datetime.utcnow().strftime("%H:%M")},
            {"stage": "Loading Cargo",   "done": False, "time": ""},
            {"stage": "In Transit",      "done": False, "time": ""},
            {"stage": "Delivered",       "done": False, "time": ""},
        ]
    }

    db.orders.insert_one(new_order)
    sync_and_advance_fleet()

    db.shops.update_one(
        {"shop_id": shop['shop_id']},
        {"$inc": {
            "green_credits": credits_earned,
            "total_orders":  1,
            "total_spent":   grand_total,
        }}
    )

    socketio.emit('new_order_assigned', {
        "truck_id":   assigned_truck,
        "order_id":   order_id,
        "shop_name":  shop['shop_name'],
        "item_count": len(order_lines),
        "total":      grand_total,
    })

    new_order.pop('_id', None)
    return jsonify({
        "message":        "Order placed!",
        "order":          new_order,
        "credits_earned": credits_earned,
    }), 201


@shop_bp.route('/orders', methods=['GET'])
def get_orders():
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401
    sync_and_advance_fleet()
    orders = list(db.orders.find({"shop_id": shop['shop_id']}, {'_id': 0}).sort("created_at", -1))
    return jsonify(orders), 200


@shop_bp.route('/orders/<order_id>', methods=['GET'])
def get_order(order_id):
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401
    sync_and_advance_fleet()
    order = db.orders.find_one({"order_id": order_id, "shop_id": shop['shop_id']}, {'_id': 0})
    if not order:
        return jsonify({"error": "Order not found"}), 404
    return jsonify(order), 200


@shop_bp.route('/recommendations', methods=['GET'])
def get_recommendations():
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401
    recommendations = build_shop_recommendations(shop['shop_id'], use_ai=False)
    return jsonify(recommendations), 200
