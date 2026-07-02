# booxscased

A letterboxd for books.

React + Vite frontend for Booxxed — log the books you've read, rate them, see them on a
world reading map, browse a 3D virtual bookshelf, and vote in per-book character polls.

## Development

```bash
npm install
npm run dev
```

By default the app talks to a local Flask backend at `http://localhost:5000/api`. Without a
backend running, it falls back to demo mode (in-memory data, no persistence). To point at a
different backend, set `window.BOOXXED_API_URL` before the app mounts.

## Build

```bash
npm run build
```
