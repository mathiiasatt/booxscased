"""Books — Open Library proxy with PostgreSQL cache.

The frontend can either call Open Library directly (CORS is open) or go
through these endpoints, which add a local cache so repeated lookups don't
hit the external API.
"""
import urllib.request, urllib.parse, json
from flask import Blueprint, request, jsonify
from app import db
from app.models import Book, Poll, PollCharacter

books_bp = Blueprint("books", __name__)

OL_SEARCH = "https://openlibrary.org/search.json"
OL_WORK   = "https://openlibrary.org{key}.json"

COUNTRY_TO_CONTINENT = {
    "Nigeria": "Africa", "Kenya": "Africa", "Ghana": "Africa", "South Africa": "Africa",
    "Egypt": "Africa", "Morocco": "Africa", "Senegal": "Africa", "Ethiopia": "Africa",
    "United States": "Americas", "Canada": "Americas", "Mexico": "Americas",
    "Brazil": "Americas", "Argentina": "Americas", "Colombia": "Americas", "Chile": "Americas",
    "Japan": "Asia", "China": "Asia", "India": "Asia", "South Korea": "Asia", "Korea": "Asia",
    "Vietnam": "Asia", "Thailand": "Asia", "Pakistan": "Asia", "Turkey": "Asia",
    "United Kingdom": "Europe", "England": "Europe", "France": "Europe", "Germany": "Europe",
    "Spain": "Europe", "Italy": "Europe", "Ireland": "Europe", "Russia": "Europe",
    "Poland": "Europe", "Sweden": "Europe", "Portugal": "Europe", "Greece": "Europe",
    "Australia": "Oceania", "New Zealand": "Oceania", "Papua New Guinea": "Oceania",
}


def _http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Booxxed/1.0 (book logging app)"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def _infer_country(places):
    for s in places or []:
        for country in COUNTRY_TO_CONTINENT:
            if country.lower() in str(s).lower():
                return country
    return None


@books_bp.get("/search")
def search():
    """Proxy Open Library search, preferring English edition titles. ?q=pride"""
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify(docs=[])
    params = urllib.parse.urlencode({
        "q": q, "limit": 8, "lang": "en",
        "fields": "key,title,author_name,first_publish_year,cover_i,"
                  "subject_places,subject,editions,editions.title,editions.cover_i",
    })
    try:
        data = _http_json(f"{OL_SEARCH}?{params}")
        docs = []
        for d in data.get("docs", []):
            # Prefer the best-matching English edition title/cover when present
            en = ((d.get("editions") or {}).get("docs") or [{}])[0]
            d["title"]   = en.get("title")   or d.get("title")
            d["cover_i"] = en.get("cover_i") or d.get("cover_i")
            d.pop("editions", None)
            docs.append(d)
        return jsonify(docs=docs)
    except Exception:
        return jsonify(error="Open Library unreachable"), 502


@books_bp.get("/<path:ol_key>")
def detail(ol_key):
    """
    Get (and cache) a book by Open Library key, e.g. GET /api/books/works/OL66554W
    Creates the global character poll from subject_people on first fetch.
    """
    key = "/" + ol_key if not ol_key.startswith("/") else ol_key

    book = Book.query.filter_by(ol_key=key).first()
    if book:
        return jsonify(_serialize(book))

    try:
        work = _http_json(OL_WORK.format(key=key))
    except Exception:
        return jsonify(error="Open Library unreachable"), 502

    country = _infer_country(work.get("subject_places")) or _infer_country(work.get("subjects"))
    book = Book(
        ol_key=key,
        title=work.get("title") or "Unknown",
        cover_id=(work.get("covers") or [None])[0],
        country=country,
        continent=COUNTRY_TO_CONTINENT.get(country),
    )
    db.session.add(book)
    db.session.flush()  # get book.id before poll creation

    # Global character poll from subject_people (>= 2 names, capped at 6)
    people = [p.strip() for p in work.get("subject_people", [])
              if isinstance(p, str) and 0 < len(p.strip()) <= 200][:6]
    if len(people) >= 2:
        poll = Poll(book_id=book.id)
        db.session.add(poll)
        db.session.flush()
        for name in people:
            db.session.add(PollCharacter(poll_id=poll.id, name=name))

    db.session.commit()
    return jsonify(_serialize(book)), 201


def _serialize(book):
    return {
        "id": book.id, "ol_key": book.ol_key, "title": book.title,
        "author": book.author, "year": book.year, "cover_id": book.cover_id,
        "country": book.country, "continent": book.continent,
        "has_poll": book.poll is not None,
    }
