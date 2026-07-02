"""Polls — global character polls, one per book. Votes are changeable."""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import func
from app import db
from app.models import Book, Poll, PollCharacter, PollVote

polls_bp = Blueprint("polls", __name__)


@polls_bp.get("/<path:ol_key>")
@jwt_required(optional=True)
def get_poll(ol_key):
    key = "/" + ol_key if not ol_key.startswith("/") else ol_key
    book = Book.query.filter_by(ol_key=key).first_or_404()
    if not book.poll:
        return jsonify(poll=None)

    uid = get_jwt_identity()
    return jsonify(poll=_serialize(book.poll, int(uid) if uid else None))


@polls_bp.post("/<path:ol_key>/vote")
@jwt_required()
def vote(ol_key):
    """
    Cast or change a vote. Body: {"character_id": 3}
    Changing is allowed: the previous vote row is updated in place.
    """
    key = "/" + ol_key if not ol_key.startswith("/") else ol_key
    book = Book.query.filter_by(ol_key=key).first_or_404()
    if not book.poll:
        return jsonify(error="this book has no poll"), 404

    uid = int(get_jwt_identity())
    char_id = (request.get_json() or {}).get("character_id")
    character = PollCharacter.query.filter_by(id=char_id, poll_id=book.poll.id).first()
    if not character:
        return jsonify(error="character not in this poll"), 400

    existing = PollVote.query.filter_by(user_id=uid, poll_id=book.poll.id).first()
    if existing:
        existing.character_id = character.id   # change vote in place
    else:
        db.session.add(PollVote(user_id=uid, poll_id=book.poll.id, character_id=character.id))
    db.session.commit()

    return jsonify(poll=_serialize(book.poll, uid))


def _serialize(poll, uid=None):
    counts = dict(
        db.session.query(PollVote.character_id, func.count(PollVote.id))
        .filter_by(poll_id=poll.id).group_by(PollVote.character_id).all()
    )
    user_vote = None
    if uid:
        v = PollVote.query.filter_by(user_id=uid, poll_id=poll.id).first()
        user_vote = v.character_id if v else None

    return {
        "id": poll.id,
        "characters": [
            {"id": c.id, "name": c.name, "votes": counts.get(c.id, 0)}
            for c in poll.characters
        ],
        "user_vote": user_vote,
        "total_votes": sum(counts.values()),
    }
