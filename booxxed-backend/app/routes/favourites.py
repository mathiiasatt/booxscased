"""Favourites — the 5-continent shelf. One book per continent, enforced."""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Favourite, Book

favourites_bp = Blueprint("favourites", __name__)

CONTINENTS = {"Africa", "Americas", "Asia", "Europe", "Oceania"}


@favourites_bp.get("")
@jwt_required()
def list_favourites():
    uid = int(get_jwt_identity())
    favs = Favourite.query.filter_by(user_id=uid).all()
    return jsonify({f.continent: _serialize(f) for f in favs})


@favourites_bp.put("/<continent>")
@jwt_required()
def set_favourite(continent):
    """Body: {"ol_key": "/works/OL66554W"} — sets or replaces the slot."""
    if continent not in CONTINENTS:
        return jsonify(error=f"continent must be one of {sorted(CONTINENTS)}"), 400

    uid = int(get_jwt_identity())
    ol_key = (request.get_json() or {}).get("ol_key")
    book = Book.query.filter_by(ol_key=ol_key).first()
    if not book:
        return jsonify(error="book not found — log it first"), 404

    # The continent rule: same book can't occupy two slots
    clash = Favourite.query.filter_by(user_id=uid, book_id=book.id)\
                           .filter(Favourite.continent != continent).first()
    if clash:
        return jsonify(error=f"this book is already your {clash.continent} favourite"), 409

    fav = Favourite.query.filter_by(user_id=uid, continent=continent).first()
    if fav:
        fav.book_id = book.id
    else:
        fav = Favourite(user_id=uid, continent=continent, book_id=book.id)
        db.session.add(fav)
    db.session.commit()
    return jsonify(_serialize(fav))


@favourites_bp.delete("/<continent>")
@jwt_required()
def clear_favourite(continent):
    uid = int(get_jwt_identity())
    fav = Favourite.query.filter_by(user_id=uid, continent=continent).first_or_404()
    db.session.delete(fav)
    db.session.commit()
    return "", 204


def _serialize(fav):
    return {
        "continent": fav.continent,
        "book": {"ol_key": fav.book.ol_key, "title": fav.book.title,
                 "author": fav.book.author, "cover_id": fav.book.cover_id},
    }
