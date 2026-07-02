"""Auth — register, login, current user."""
import bcrypt
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from app import db
from app.models import User

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/register")
def register():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not username or not email or len(password) < 8:
        return jsonify(error="username, email and password (8+ chars) are required"), 400
    if User.query.filter((User.username == username) | (User.email == email)).first():
        return jsonify(error="username or email already taken"), 409

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = User(username=username, email=email, password_hash=pw_hash,
                display_name=data.get("display_name") or username)
    db.session.add(user)
    db.session.commit()

    token = create_access_token(identity=str(user.id))
    return jsonify(token=token, user={"id": user.id, "username": user.username}), 201


@auth_bp.post("/login")
def login():
    data = request.get_json() or {}
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = User.query.filter_by(email=email).first()
    if not user or not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
        return jsonify(error="invalid credentials"), 401

    token = create_access_token(identity=str(user.id))
    return jsonify(token=token, user={"id": user.id, "username": user.username})


@auth_bp.get("/me")
@jwt_required()
def me():
    user = User.query.get_or_404(int(get_jwt_identity()))
    return jsonify(id=user.id, username=user.username, email=user.email,
                   display_name=user.display_name, bio=user.bio, location=user.location)
