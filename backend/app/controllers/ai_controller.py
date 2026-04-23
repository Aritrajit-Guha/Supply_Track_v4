from flask import Blueprint, jsonify, request

from .shop_controller import get_shop_from_token
from app.services.ai_chat_service import build_chat_response


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
