from flask import Blueprint, jsonify, request

from .shop_controller import get_shop_from_token
from app.services.ai_chat_service import build_chat_response
from app.services.shipment_insights_service import build_shipment_insights


ai_bp = Blueprint("ai", __name__)


@ai_bp.route("/chat", methods=["POST"])
def chat():
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json or {}
    question = (data.get("question") or "").strip()
    page = data.get("page")
    if not question:
        return jsonify({"error": "Question is required"}), 400

    response = build_chat_response(shop["shop_id"], question, page)
    return jsonify(response), 200


@ai_bp.route("/shipment-insights", methods=["GET"])
def shipment_insights():
    shop = get_shop_from_token()
    if not shop:
        return jsonify({"error": "Unauthorized"}), 401

    use_ai = request.args.get("mode") == "ai"
    response = build_shipment_insights(shop["shop_id"], use_ai=use_ai)
    return jsonify(response), 200
