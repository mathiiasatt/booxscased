from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

load_dotenv()

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()


def create_app():
    app = Flask(__name__)

    # ── Config ────────────────────────────────────────────────────────────────
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
        "DATABASE_URL", "postgresql+psycopg://booxxed_user:booxxed_pass@localhost:5432/booxxed_db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret")
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = int(
        os.getenv("JWT_ACCESS_TOKEN_EXPIRES", 86400)
    )

    # ── Extensions ────────────────────────────────────────────────────────────
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # ── Register blueprints ───────────────────────────────────────────────────
    from app.routes.auth import auth_bp
    from app.routes.books import books_bp
    from app.routes.logs import logs_bp
    from app.routes.polls import polls_bp
    from app.routes.favourites import favourites_bp
    from app.routes.profile import profile_bp
    from app.routes.shelves import shelves_bp

    app.register_blueprint(auth_bp,        url_prefix="/api/auth")
    app.register_blueprint(books_bp,       url_prefix="/api/books")
    app.register_blueprint(logs_bp,        url_prefix="/api/logs")
    app.register_blueprint(polls_bp,       url_prefix="/api/polls")
    app.register_blueprint(favourites_bp,  url_prefix="/api/favourites")
    app.register_blueprint(profile_bp,     url_prefix="/api/profile")
    app.register_blueprint(shelves_bp,     url_prefix="/api/shelves")

    # ── Health check ──────────────────────────────────────────────────────────
    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app
