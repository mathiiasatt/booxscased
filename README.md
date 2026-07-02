# booxscased

A letterboxd for books.

React + Vite frontend for Booxxed — log the books you've read, rate them, see them on a
world reading map, browse a 3D virtual bookshelf, and vote in per-book character polls.

## Frontend (repo root)

```bash
npm install
npm run dev
```

By default the app talks to a local Flask backend at `http://localhost:5001/api`. Without a
backend running, it falls back to demo mode (in-memory data, no persistence). To point at a
different backend, set `window.BOOXXED_API_URL` before the app mounts.

Production build: `npm run build`.

## Backend (`booxxed-backend/`)

Flask + SQLAlchemy + PostgreSQL API (auth, logs, polls, favourites).

```bash
cd booxxed-backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in your DB credentials and secrets
flask db upgrade
python run.py
```
