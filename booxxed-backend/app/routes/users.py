"""Public user profiles — search readers and browse their library."""
from flask import Blueprint, request, jsonify
from app.models import User, Log, Shelf

users_bp = Blueprint("users", __name__)


def _book_json(b):
    return {"ol_key": b.ol_key, "title": b.title, "author": b.author,
            "year": b.year, "cover_id": b.cover_id}


def _log_json(l):
    return {"id": l.id, "book": _book_json(l.book), "country": l.country,
            "continent": l.continent, "rating": float(l.rating),
            "comment": l.comment, "tags": [t.label for t in l.tags],
            "logged_at": l.logged_at.isoformat() if l.logged_at else None}


@users_bp.get("")
def search_users():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify([])
    users = User.query.filter(User.username.ilike(f"%{q}%")).order_by(User.username).limit(10).all()
    return jsonify([
        {"username": u.username, "display_name": u.display_name, "books": len(u.logs)}
        for u in users
    ])


@users_bp.get("/<username>")
def get_user(username):
    u = User.query.filter_by(username=username).first_or_404()
    logs = Log.query.filter_by(user_id=u.id).order_by(Log.logged_at.desc()).all()

    favourites = {f.continent: _book_json(f.book) for f in u.favourites}

    shelves = []
    for s in Shelf.query.filter_by(user_id=u.id).order_by(Shelf.is_default.desc(), Shelf.created_at).all():
        ol_keys = ([l.book.ol_key for l in logs] if s.is_default
                   else [sb.book.ol_key for sb in s.books])
        shelves.append({"id": s.id, "name": s.name, "color": s.color,
                        "is_default": s.is_default, "ol_keys": ol_keys})

    return jsonify(
        user={"username": u.username, "display_name": u.display_name,
              "bio": u.bio, "location": u.location,
              "joined": u.created_at.isoformat() if u.created_at else None},
        logs=[_log_json(l) for l in logs],
        favourites=favourites,
        shelves=shelves,
    )
