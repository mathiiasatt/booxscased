"""Shelves — up to 3 bookshelves per user, one always holding every read book."""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Shelf, ShelfBook, Book, Log

shelves_bp = Blueprint("shelves", __name__)

MAX_SHELVES = 3
DEFAULT_NAME = "All my books"


def _uid():
    return int(get_jwt_identity())


def _ensure_default(user_id):
    """Every user always has the default shelf holding all logged books."""
    default = Shelf.query.filter_by(user_id=user_id, is_default=True).first()
    if not default:
        default = Shelf(user_id=user_id, name=DEFAULT_NAME, is_default=True)
        db.session.add(default)
        db.session.commit()
    return default


def _shelf_json(shelf):
    if shelf.is_default:
        # computed: every book the user has logged
        ol_keys = [l.book.ol_key for l in Log.query.filter_by(user_id=shelf.user_id).all()]
    else:
        ol_keys = [sb.book.ol_key for sb in shelf.books]
    return {"id": shelf.id, "name": shelf.name, "color": shelf.color,
            "is_default": shelf.is_default, "ol_keys": ol_keys}


@shelves_bp.get("")
@jwt_required()
def list_shelves():
    uid = _uid()
    _ensure_default(uid)
    shelves = Shelf.query.filter_by(user_id=uid).order_by(Shelf.is_default.desc(), Shelf.created_at).all()
    return jsonify([_shelf_json(s) for s in shelves])


@shelves_bp.post("")
@jwt_required()
def create_shelf():
    uid = _uid()
    _ensure_default(uid)
    if Shelf.query.filter_by(user_id=uid).count() >= MAX_SHELVES:
        return jsonify(error=f"you can have at most {MAX_SHELVES} shelves"), 409

    data = request.get_json() or {}
    name = (data.get("name") or "").strip()[:60]
    if not name:
        return jsonify(error="name is required"), 400
    if Shelf.query.filter_by(user_id=uid, name=name).first():
        return jsonify(error="you already have a shelf with this name"), 409

    shelf = Shelf(user_id=uid, name=name, color=(data.get("color") or None))
    db.session.add(shelf)
    db.session.commit()
    return jsonify(_shelf_json(shelf)), 201


@shelves_bp.patch("/<int:shelf_id>")
@jwt_required()
def update_shelf(shelf_id):
    uid = _uid()
    shelf = Shelf.query.filter_by(id=shelf_id, user_id=uid).first_or_404()
    data = request.get_json() or {}
    if "name" in data:
        name = (data.get("name") or "").strip()[:60]
        if not name:
            return jsonify(error="name cannot be empty"), 400
        dup = Shelf.query.filter(Shelf.user_id == uid, Shelf.name == name, Shelf.id != shelf.id).first()
        if dup:
            return jsonify(error="you already have a shelf with this name"), 409
        shelf.name = name
    if "color" in data:
        shelf.color = data.get("color") or None
    db.session.commit()
    return jsonify(_shelf_json(shelf))


@shelves_bp.delete("/<int:shelf_id>")
@jwt_required()
def delete_shelf(shelf_id):
    uid = _uid()
    shelf = Shelf.query.filter_by(id=shelf_id, user_id=uid).first_or_404()
    if shelf.is_default:
        return jsonify(error="the default shelf (all read books) cannot be deleted"), 400
    db.session.delete(shelf)
    db.session.commit()
    return "", 204


@shelves_bp.put("/<int:shelf_id>/books")
@jwt_required()
def set_shelf_books(shelf_id):
    """Replace the shelf's contents. Only books the user has logged are allowed."""
    uid = _uid()
    shelf = Shelf.query.filter_by(id=shelf_id, user_id=uid).first_or_404()
    if shelf.is_default:
        return jsonify(error="the default shelf always contains every logged book"), 400

    ol_keys = (request.get_json() or {}).get("ol_keys") or []
    logged = {l.book.ol_key: l.book for l in Log.query.filter_by(user_id=uid).all()}
    unknown = [k for k in ol_keys if k not in logged]
    if unknown:
        return jsonify(error=f"books not in your logs: {', '.join(unknown[:5])}"), 400

    ShelfBook.query.filter_by(shelf_id=shelf.id).delete()
    for k in dict.fromkeys(ol_keys):          # dedupe, keep order
        db.session.add(ShelfBook(shelf_id=shelf.id, book_id=logged[k].id))
    db.session.commit()
    return jsonify(_shelf_json(shelf))
