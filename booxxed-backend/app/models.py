"""
Booxxed — SQLAlchemy models
=========================

Table map
─────────
users               — registered readers
books               — books cached from Open Library
logs                — one row per (user, book) reading log
log_tags            — many-to-many between logs and tags
tags                — normalised tag vocabulary
polls               — one global character poll per book
poll_characters     — characters belonging to a poll
poll_votes          — one vote per (user, poll)
favourites          — user's 5-continent shelf (one row per continent slot)
shelves             — up to 3 bookshelves per user (one default: all read books)
shelf_books         — which logged books sit on which custom shelf
"""

from datetime import datetime, timezone
from app import db


# ── Helpers ──────────────────────────────────────────────────────────────────

def utcnow():
    return datetime.now(timezone.utc)


# ── Association table: logs ↔ tags ────────────────────────────────────────────

log_tags = db.Table(
    "log_tags",
    db.Column("log_id", db.Integer, db.ForeignKey("logs.id",  ondelete="CASCADE"), primary_key=True),
    db.Column("tag_id", db.Integer, db.ForeignKey("tags.id",  ondelete="CASCADE"), primary_key=True),
)


# ── Users ─────────────────────────────────────────────────────────────────────

class User(db.Model):
    __tablename__ = "users"

    id           = db.Column(db.Integer, primary_key=True)
    username     = db.Column(db.String(60),  unique=True, nullable=False)
    email        = db.Column(db.String(255), unique=True, nullable=False)
    password_hash= db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(120), nullable=True)
    bio          = db.Column(db.String(500), nullable=True)
    location     = db.Column(db.String(120), nullable=True)
    created_at   = db.Column(db.DateTime(timezone=True), default=utcnow)

    # relationships
    logs         = db.relationship("Log",       back_populates="user", cascade="all, delete-orphan")
    favourites   = db.relationship("Favourite", back_populates="user", cascade="all, delete-orphan")
    poll_votes   = db.relationship("PollVote",  back_populates="user", cascade="all, delete-orphan")
    shelves      = db.relationship("Shelf",     back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.username}>"


# ── Books (Open Library cache) ────────────────────────────────────────────────

class Book(db.Model):
    """
    Lightweight local cache of Open Library data.
    ol_key is the canonical identifier (e.g. '/works/OL82563W').
    We never store the full Open Library payload — only what Booxxed needs.
    """
    __tablename__ = "books"

    id          = db.Column(db.Integer, primary_key=True)
    ol_key      = db.Column(db.String(50), unique=True, nullable=False, index=True)
    title       = db.Column(db.String(500), nullable=False)
    author      = db.Column(db.String(300), nullable=True)
    year        = db.Column(db.Integer,     nullable=True)
    cover_id    = db.Column(db.Integer,     nullable=True)   # Open Library cover ID
    country     = db.Column(db.String(100), nullable=True)   # inferred or user-set
    continent   = db.Column(db.String(50),  nullable=True)
    cached_at   = db.Column(db.DateTime(timezone=True), default=utcnow)

    # relationships
    logs        = db.relationship("Log",    back_populates="book", cascade="all, delete-orphan")
    poll        = db.relationship("Poll",   back_populates="book", uselist=False, cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Book {self.ol_key} — {self.title}>"


# ── Tags ──────────────────────────────────────────────────────────────────────

class Tag(db.Model):
    __tablename__ = "tags"

    id    = db.Column(db.Integer, primary_key=True)
    label = db.Column(db.String(80), unique=True, nullable=False, index=True)

    logs  = db.relationship("Log", secondary=log_tags, back_populates="tags")

    def __repr__(self):
        return f"<Tag {self.label}>"


# ── Logs ──────────────────────────────────────────────────────────────────────

class Log(db.Model):
    """
    One row per (user, book) — a user can log the same book only once.
    """
    __tablename__ = "logs"
    __table_args__ = (
        db.UniqueConstraint("user_id", "book_id", name="uq_user_book"),
    )

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id    = db.Column(db.Integer, db.ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    rating     = db.Column(db.Numeric(3, 1), nullable=False)   # 0.5 – 5.0
    comment    = db.Column(db.Text,  nullable=True)
    # User may override the country detected on the book
    country    = db.Column(db.String(100), nullable=True)
    continent  = db.Column(db.String(50),  nullable=True)
    logged_at  = db.Column(db.DateTime(timezone=True), default=utcnow)

    # relationships
    user  = db.relationship("User", back_populates="logs")
    book  = db.relationship("Book", back_populates="logs")
    tags  = db.relationship("Tag",  secondary=log_tags, back_populates="logs")

    def __repr__(self):
        return f"<Log user={self.user_id} book={self.book_id} rating={self.rating}>"


# ── Polls ─────────────────────────────────────────────────────────────────────

class Poll(db.Model):
    """
    One global character poll per book.
    Created the first time any user logs the book and supplies characters.
    """
    __tablename__ = "polls"

    id         = db.Column(db.Integer, primary_key=True)
    book_id    = db.Column(db.Integer, db.ForeignKey("books.id", ondelete="CASCADE"), unique=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow)

    # relationships
    book       = db.relationship("Book",          back_populates="poll")
    characters = db.relationship("PollCharacter", back_populates="poll", cascade="all, delete-orphan")
    votes      = db.relationship("PollVote",      back_populates="poll", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Poll book_id={self.book_id}>"


class PollCharacter(db.Model):
    """
    A character option within a poll.
    Vote counts are derived at query time via COUNT on PollVote — no denormalised counter.
    """
    __tablename__ = "poll_characters"

    id       = db.Column(db.Integer, primary_key=True)
    poll_id  = db.Column(db.Integer, db.ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True)
    name     = db.Column(db.String(200), nullable=False)

    poll     = db.relationship("Poll", back_populates="characters")
    votes    = db.relationship("PollVote", back_populates="character", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<PollCharacter {self.name}>"


class PollVote(db.Model):
    """
    One vote per (user, poll). Enforced at the DB level via unique constraint.
    """
    __tablename__ = "poll_votes"
    __table_args__ = (
        db.UniqueConstraint("user_id", "poll_id", name="uq_user_poll"),
    )

    id           = db.Column(db.Integer, primary_key=True)
    user_id      = db.Column(db.Integer, db.ForeignKey("users.id",            ondelete="CASCADE"), nullable=False, index=True)
    poll_id      = db.Column(db.Integer, db.ForeignKey("polls.id",            ondelete="CASCADE"), nullable=False, index=True)
    character_id = db.Column(db.Integer, db.ForeignKey("poll_characters.id",  ondelete="CASCADE"), nullable=False)
    voted_at     = db.Column(db.DateTime(timezone=True), default=utcnow)

    user      = db.relationship("User",          back_populates="poll_votes")
    poll      = db.relationship("Poll",          back_populates="votes")
    character = db.relationship("PollCharacter", back_populates="votes")

    def __repr__(self):
        return f"<PollVote user={self.user_id} poll={self.poll_id} char={self.character_id}>"


# ── Bookshelves ───────────────────────────────────────────────────────────────

class Shelf(db.Model):
    """
    A user can have at most 3 shelves (enforced in the route layer).
    Exactly one per user is the default shelf: its contents are always
    every book the user has logged (computed, never stored in shelf_books).
    Custom shelves are filled by hand from the user's logged books.
    """
    __tablename__ = "shelves"
    __table_args__ = (
        db.UniqueConstraint("user_id", "name", name="uq_user_shelf_name"),
    )

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name       = db.Column(db.String(60), nullable=False)
    color      = db.Column(db.String(20), nullable=True)    # wood tint, hex e.g. "#a97e4c"
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow)

    user  = db.relationship("User", back_populates="shelves")
    books = db.relationship("ShelfBook", back_populates="shelf", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Shelf user={self.user_id} {self.name}{' (default)' if self.is_default else ''}>"


class ShelfBook(db.Model):
    """A book placed on a custom shelf. One row per (shelf, book)."""
    __tablename__ = "shelf_books"
    __table_args__ = (
        db.UniqueConstraint("shelf_id", "book_id", name="uq_shelf_book"),
    )

    id       = db.Column(db.Integer, primary_key=True)
    shelf_id = db.Column(db.Integer, db.ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False, index=True)
    book_id  = db.Column(db.Integer, db.ForeignKey("books.id",   ondelete="CASCADE"), nullable=False)

    shelf = db.relationship("Shelf", back_populates="books")
    book  = db.relationship("Book")

    def __repr__(self):
        return f"<ShelfBook shelf={self.shelf_id} book={self.book_id}>"


# ── Favourites (5-continent shelf) ───────────────────────────────────────────

class Favourite(db.Model):
    """
    One row per (user, continent).
    Enforced unique: a user cannot have two favourites for the same continent.
    """
    __tablename__ = "favourites"
    __table_args__ = (
        db.UniqueConstraint("user_id", "continent", name="uq_user_continent"),
    )

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id",  ondelete="CASCADE"), nullable=False, index=True)
    book_id    = db.Column(db.Integer, db.ForeignKey("books.id",  ondelete="CASCADE"), nullable=False)
    continent  = db.Column(db.String(50), nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = db.relationship("User", back_populates="favourites")
    book = db.relationship("Book")

    def __repr__(self):
        return f"<Favourite user={self.user_id} continent={self.continent} book={self.book_id}>"
