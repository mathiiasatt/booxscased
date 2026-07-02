"""Logs — create / list / delete reading logs."""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Log, Book, Tag

logs_bp = Blueprint("logs", __name__)


@logs_bp.get("")
@jwt_required()
def list_logs():
    uid = int(get_jwt_identity())
    logs = Log.query.filter_by(user_id=uid).order_by(Log.logged_at.desc()).all()
    return jsonify([_serialize(l) for l in logs])


@logs_bp.post("")
@jwt_required()
def create_log():
    uid = int(get_jwt_identity())
    data = request.get_json() or {}

    ol_key = data.get("ol_key")
    rating = data.get("rating")
    if not ol_key or rating is None:
        return jsonify(error="ol_key and rating are required"), 400
    try:
        rating = float(rating)
        assert 0.5 <= rating <= 5 and (rating * 2) == int(rating * 2)
    except (ValueError, AssertionError):
        return jsonify(error="rating must be 0.5–5.0 in half-star steps"), 400

    book = Book.query.filter_by(ol_key=ol_key).first()
    if not book:
        # Minimal record from the payload; full detail can be hydrated later
        book = Book(ol_key=ol_key, title=data.get("title") or "Unknown",
                    author=data.get("author"), year=data.get("year"),
                    cover_id=data.get("cover_id"),
                    country=data.get("country"), continent=data.get("continent"))
        db.session.add(book)
        db.session.flush()

    if Log.query.filter_by(user_id=uid, book_id=book.id).first():
        return jsonify(error="you already logged this book"), 409

    log = Log(user_id=uid, book_id=book.id, rating=rating,
              comment=(data.get("comment") or "")[:5000] or None,
              country=data.get("country") or book.country,
              continent=data.get("continent") or book.continent)

    for label in (data.get("tags") or [])[:10]:
        label = str(label).strip().lower()[:80]
        if not label:
            continue
        tag = Tag.query.filter_by(label=label).first() or Tag(label=label)
        log.tags.append(tag)

    db.session.add(log)
    db.session.commit()
    return jsonify(_serialize(log)), 201


@logs_bp.delete("/<int:log_id>")
@jwt_required()
def delete_log(log_id):
    uid = int(get_jwt_identity())
    log = Log.query.get_or_404(log_id)
    if log.user_id != uid:
        return jsonify(error="not your log"), 403
    db.session.delete(log)
    db.session.commit()
    return "", 204


def _serialize(log):
    return {
        "id": log.id,
        "book": {"ol_key": log.book.ol_key, "title": log.book.title,
                 "author": log.book.author, "year": log.book.year,
                 "cover_id": log.book.cover_id},
        "rating": float(log.rating), "comment": log.comment,
        "country": log.country, "continent": log.continent,
        "tags": [t.label for t in log.tags],
        "logged_at": log.logged_at.isoformat(),
    }
