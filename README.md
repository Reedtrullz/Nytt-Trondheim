# Nytt Trondheim

Private Bokmål news dashboard and situation workspace for Trondheim. It collects headline metadata from supported public sources, highlights local and regional relevance, and provides evidence-labelled maps and private planning notes for developing events.

## Local Development

Requirements: Node.js 20.19+ and npm. CI and production images use Node.js 22.

```bash
npm install
npm run build -w @nytt/shared
npm run dev
```

The development API uses seeded in-memory data and bypasses GitHub authentication unless `DEV_AUTH_BYPASS=false` is set. Open `http://localhost:5173`.

For PostgreSQL/PostGIS-backed development:

```bash
cp .env.example .env.production
docker compose --env-file .env.production up -d postgres
DATABASE_URL=postgres://nytt:nytt@localhost:5432/nytt npm run db:migrate
```

## Application Areas

- `Siste nytt`: chronological Trondheim/Trøndelag views, categories, search, saved links and nearby map.
- `Situasjonsrom`: event timeline, attributed evidence, warning/context layers, related stories and private planning workspace.
- Map provenance is explicit: official information, reporting-derived estimates, DSB preparedness context and private drawings are separate layers.

## Services

- `apps/frontend`: React/Vite interface.
- `apps/server`: authenticated Express API, PostGIS persistence, file upload and ZIP/PDF exports.
- `apps/worker`: scheduled collection, source health and AI-provider boundary.
- `packages/shared`: domain types, validation and development fixture data.

Operational documentation is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/SOURCES.md](docs/SOURCES.md) and [docs/SECURITY.md](docs/SECURITY.md).
