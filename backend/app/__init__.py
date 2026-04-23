from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()
FRONTEND_URL = os.getenv("FRONTEND_URL")
socketio = SocketIO()
mongo_client = None
db = None

def create_app():
    app = Flask(__name__)
    CORS(app, resources={r"/api/*":{"origins":FRONTEND_URL}})

    global mongo_client, db
    mongo_uri = os.getenv("MONGO_URI")

    try:
        mongo_client = MongoClient(mongo_uri)
        db = mongo_client.get_database()
        print("✅ Successfully connected to MongoDB")
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {e}")

    socketio.init_app(app, cors_allowed_origins=FRONTEND_URL)

    from .controllers.truck_controller import truck_bp
    from .controllers.auction_controller import auction_bp
    from .controllers.auth_controller import auth_bp
    from .controllers.shop_controller import shop_bp   # NEW
    from .controllers.ai_controller import ai_bp

    app.register_blueprint(truck_bp, url_prefix='/api/truck')
    app.register_blueprint(auction_bp, url_prefix='/api/auction')
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(shop_bp, url_prefix='/api/shop')  # NEW
    app.register_blueprint(ai_bp, url_prefix='/api/ai')

    @app.route('/')
    def home():
        return {"message": "Live-Track API is running!"}

    return app
