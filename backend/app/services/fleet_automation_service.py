from copy import deepcopy
from datetime import datetime, timezone

from app import db, socketio


TRUCK_BLUEPRINTS = {
    "T-1001": {
        "truck_id": "T-1001",
        "driver": "Ramesh Kumar",
        "destination": "Durgapur Central Hub",
        "origin": "Kolkata Cold Storage",
        "origin_lat": 22.5726,
        "origin_lng": 88.3639,
        "destination_lat": 23.5204,
        "destination_lng": 87.3119,
        "route_total_km": 180,
        "cargo_type": "Frozen Goods",
        "cargo_image": "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=400&q=80",
        "storage_profile": "frozen",
        "target_temperature": -18,
        "temperature_variance": 2,
        "base_humidity": 62,
        "speed_kmh": 62,
        "green_credits_earned": 12,
    },
    "T-1002": {
        "truck_id": "T-1002",
        "driver": "Suresh Patel",
        "destination": "Asansol Market Yard",
        "origin": "Burdwan Farm Gate",
        "origin_lat": 23.2324,
        "origin_lng": 87.8615,
        "destination_lat": 23.6739,
        "destination_lng": 86.9524,
        "route_total_km": 110,
        "cargo_type": "Fresh Vegetables",
        "cargo_image": "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80",
        "storage_profile": "chilled",
        "target_temperature": 4,
        "temperature_variance": 3,
        "base_humidity": 78,
        "speed_kmh": 55,
        "green_credits_earned": 8,
    },
    "T-1003": {
        "truck_id": "T-1003",
        "driver": "Priya Singh",
        "destination": "Dhanbad Retail Hub",
        "origin": "Ranchi Dairy Co-op",
        "origin_lat": 23.3441,
        "origin_lng": 85.3096,
        "destination_lat": 23.7957,
        "destination_lng": 86.4304,
        "route_total_km": 210,
        "cargo_type": "Dairy & Eggs",
        "cargo_image": "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80",
        "storage_profile": "cold",
        "target_temperature": 6,
        "temperature_variance": 2,
        "base_humidity": 55,
        "speed_kmh": 50,
        "green_credits_earned": 5,
    },
}

LOADING_MINUTES = 1
TRANSIT_MINUTES = 8
DELIVERED_MINUTES = LOADING_MINUTES + TRANSIT_MINUTES
INACTIVE_ORDER_STATUSES = ["Delivered", "Auctioned Away"]


def seed_trucks_if_needed() -> None:
    if db is None:
        return

    if db.trucks.count_documents({}) > 0:
        return

    docs = []
    for blueprint in TRUCK_BLUEPRINTS.values():
        docs.append(build_idle_truck_doc(blueprint))
    db.trucks.insert_many(docs)


def build_idle_truck_doc(blueprint: dict) -> dict:
    return {
        **deepcopy(blueprint),
        "status": "Idle",
        "current_temperature": blueprint["target_temperature"],
        "humidity": blueprint["base_humidity"],
        "remaining_shelf_life_hours": 72,
        "distance_left_km": 0,
        "eta_hours": 0,
        "lat": blueprint["origin_lat"],
        "lng": blueprint["origin_lng"],
        "alert_level": "normal",
        "active_order_id": None,
        "last_simulated_at": datetime.utcnow().isoformat(),
    }


def sync_and_advance_fleet() -> None:
    if db is None:
        return

    seed_trucks_if_needed()
    previous_by_truck = {
        truck["truck_id"]: truck
        for truck in db.trucks.find({}, {"_id": 0, "truck_id": 1, "status": 1, "distance_left_km": 1})
    }

    for truck_id, blueprint in TRUCK_BLUEPRINTS.items():
        order = db.orders.find_one(
            {"assigned_truck": truck_id, "status": {"$nin": INACTIVE_ORDER_STATUSES}},
            {"_id": 0},
            sort=[("created_at", 1)],
        )

        truck_state = calculate_truck_state(blueprint, order)
        db.trucks.update_one({"truck_id": truck_id}, {"$set": truck_state}, upsert=True)
        maybe_emit_fleet_update(previous_by_truck.get(truck_id), truck_state)


def calculate_truck_state(blueprint: dict, order: dict | None) -> dict:
    if not order:
        return build_idle_truck_doc(blueprint)

    created_at = parse_iso_datetime(order["created_at"])
    now = datetime.now(timezone.utc)
    elapsed_minutes = max(0.0, (now - created_at).total_seconds() / 60)

    if elapsed_minutes < LOADING_MINUTES:
        phase = "Loading"
        progress = 0.0
    elif elapsed_minutes < DELIVERED_MINUTES:
        phase = "In Transit"
        progress = min(1.0, (elapsed_minutes - LOADING_MINUTES) / TRANSIT_MINUTES)
    else:
        phase = "Delivered"
        progress = 1.0

    distance_left = int(round(blueprint["route_total_km"] * (1 - progress)))
    eta_hours = 0 if phase == "Delivered" else max(1, round((distance_left / max(blueprint["speed_kmh"], 1)) + 0.2))
    lat = interpolate(blueprint["origin_lat"], blueprint["destination_lat"], progress)
    lng = interpolate(blueprint["origin_lng"], blueprint["destination_lng"], progress)
    temperature = calculate_temperature(blueprint, progress, phase)
    humidity = calculate_humidity(blueprint, progress, phase)
    alert_level = determine_alert_level(temperature, blueprint["storage_profile"])

    update_order_progress(order, phase)

    return {
        **deepcopy(blueprint),
        "status": phase,
        "current_temperature": temperature,
        "humidity": humidity,
        "remaining_shelf_life_hours": max(8, 72 - int(elapsed_minutes * 2)),
        "distance_left_km": distance_left,
        "eta_hours": eta_hours,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "alert_level": alert_level,
        "active_order_id": order["order_id"],
        "last_simulated_at": datetime.utcnow().isoformat(),
    }


def update_order_progress(order: dict, phase: str) -> None:
    stage_times = {
        "Order Confirmed": format_stage_time(order["created_at"]),
        "Truck Assigned": format_stage_time(order["created_at"]),
        "Loading Cargo": format_stage_time(order["created_at"], minutes=1) if phase in {"Loading", "In Transit", "Delivered"} else "",
        "In Transit": format_stage_time(order["created_at"], minutes=2) if phase in {"In Transit", "Delivered"} else "",
        "Delivered": format_stage_time(order["created_at"], minutes=9) if phase == "Delivered" else "",
    }

    delivery_stages = [
        {"stage": "Order Confirmed", "done": True, "time": stage_times["Order Confirmed"]},
        {"stage": "Truck Assigned", "done": True, "time": stage_times["Truck Assigned"]},
        {"stage": "Loading Cargo", "done": phase in {"Loading", "In Transit", "Delivered"}, "time": stage_times["Loading Cargo"]},
        {"stage": "In Transit", "done": phase in {"In Transit", "Delivered"}, "time": stage_times["In Transit"]},
        {"stage": "Delivered", "done": phase == "Delivered", "time": stage_times["Delivered"]},
    ]

    order_status = "Dispatched" if phase == "Loading" else phase
    estimated_delivery = "Delivered" if phase == "Delivered" else f"{max(1, DELIVERED_MINUTES - minutes_since(order['created_at']))} mins"

    db.orders.update_one(
        {"order_id": order["order_id"]},
        {
            "$set": {
                "status": order_status,
                "estimated_delivery": estimated_delivery,
                "delivery_stages": delivery_stages,
                "last_progress_at": datetime.utcnow().isoformat(),
            }
        },
    )


def maybe_emit_fleet_update(previous: dict | None, current: dict) -> None:
    if previous is None:
        socketio.emit("fleet_updated", {"truck_id": current["truck_id"], "status": current["status"]})
        return

    previous_signature = (previous.get("status"), previous.get("distance_left_km"))
    current_signature = (current.get("status"), current.get("distance_left_km"))
    if previous_signature != current_signature:
        socketio.emit(
            "fleet_updated",
            {
                "truck_id": current["truck_id"],
                "status": current["status"],
                "distance_left_km": current["distance_left_km"],
                "eta_hours": current["eta_hours"],
            },
        )


def get_truck_doc(truck_id: str) -> dict | None:
    sync_and_advance_fleet()
    return db.trucks.find_one({"truck_id": truck_id}, {"_id": 0})


def get_trucks_for_ids(truck_ids: list[str]) -> list[dict]:
    sync_and_advance_fleet()
    return list(db.trucks.find({"truck_id": {"$in": truck_ids}}, {"_id": 0}))


def calculate_temperature(blueprint: dict, progress: float, phase: str) -> int:
    if phase == "Idle":
        return blueprint["target_temperature"]

    variance = blueprint["temperature_variance"]
    if blueprint["storage_profile"] == "frozen":
        return int(round(blueprint["target_temperature"] + progress * variance * 1.5))
    if blueprint["storage_profile"] == "chilled":
        return int(round(blueprint["target_temperature"] + progress * variance))
    return int(round(blueprint["target_temperature"] + progress * variance * 0.8))


def calculate_humidity(blueprint: dict, progress: float, phase: str) -> int:
    if phase == "Idle":
        return blueprint["base_humidity"]
    return int(round(blueprint["base_humidity"] + progress * 6))


def determine_alert_level(temperature: int, storage_profile: str) -> str:
    if storage_profile == "frozen":
        if temperature > -12:
            return "critical"
        if temperature > -15:
            return "warning"
        return "normal"
    if storage_profile == "chilled":
        if temperature > 8:
            return "critical"
        if temperature > 6:
            return "warning"
        return "normal"
    if temperature > 10:
        return "critical"
    if temperature > 8:
        return "warning"
    return "normal"


def format_stage_time(iso_value: str, minutes: int = 0) -> str:
    dt = parse_iso_datetime(iso_value)
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    dt = dt.astimezone(timezone.utc)
    adjusted = dt.timestamp() + (minutes * 60)
    return datetime.fromtimestamp(adjusted, tz=timezone.utc).strftime("%H:%M")


def parse_iso_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def minutes_since(value: str) -> int:
    parsed = parse_iso_datetime(value)
    now = datetime.now(timezone.utc)
    return int(max(0, (now - parsed).total_seconds() // 60))


def interpolate(start: float, end: float, progress: float) -> float:
    return start + ((end - start) * progress)
