"""Profile — stats and reading-globe data."""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import func
from app import db
from app.models import Log, User

profile_bp = Blueprint("profile", __name__)


@profile_bp.get("/stats")
@jwt_required()
def stats():
    uid = int(get_jwt_identity())
    total, avg = db.session.query(func.count(Log.id), func.avg(Log.rating))\
                           .filter_by(user_id=uid).one()
    countries = [r[0] for r in db.session.query(Log.country).filter(
        Log.user_id == uid, Log.country.isnot(None)).distinct()]
    return jsonify(
        books=total,
        avg_rating=round(float(avg), 1) if avg else None,
        countries=countries,
        countries_count=len(countries),
    )


@profile_bp.get("/globe")
@jwt_required()
def globe():
    """Country → book count, for colouring the reading globe."""
    uid = int(get_jwt_identity())
    rows = db.session.query(Log.country, func.count(Log.id))\
                     .filter(Log.user_id == uid, Log.country.isnot(None))\
                     .group_by(Log.country).all()
    return jsonify({country: count for country, count in rows})
