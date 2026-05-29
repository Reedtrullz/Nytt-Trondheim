# Nytt Trondheim

Private Bokmål news dashboard and situation workspace for Trondheim. It collects headline metadata from supported public sources, highlights local and regional relevance, and provides evidence-labelled maps and private planning notes for developing events.

## Local Development

Requirements: Node.js 20.19+ and npm. CI and production images use Node.js 22.

```bash
npm install
npm run build -w @nytt/shared
npm run dev
```

The development API uses seeded in-memory data and bypasses GitHub authentication unless `DEV_AUTH_BYPASS=false` is set. Open `http://127.0.0.1:5173`.

For local DATEX testing, copy `.env.example` to `.env.production` and set `DATEX_USERNAME` / `DATEX_PASSWORD` from the Basic Auth credentials Vegvesen issued. Leave `DATEX_ENDPOINT` blank unless intentionally overriding the application's SRTI-filtered default. Production credentials belong in GitHub repository secrets (`NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`, optional `NYTT_DATEX_ENDPOINT`); see [docs/DEPLOYMENT.md#datex-credentials](docs/DEPLOYMENT.md#datex-credentials).

For PostgreSQL/PostGIS-backed development:

```bash
cp .env.example .env.production
docker compose --env-file .env.production up -d postgres
DATABASE_URL=postgres://nytt:nytt@localhost:5432/nytt npm run db:migrate
```

## Application Areas

- `Siste nytt`: chronological Trondheim/Trøndelag views, categories, search, saved links and nearby map.
- `Situasjonsrom`: event timeline, attributed evidence, warning/context layers, official traffic layers, related stories and private planning workspace.
- `Drift`: owner-only collection, DATEX/source health, DATEX TravelTime traffic pulse, AI and encrypted-backup verification status.
- Map provenance is explicit: official information, official DATEX traffic coordinates, reporting-derived estimates, DSB preparedness context and private drawings are separate layers.
- Situation processing stores MET/NVE official warning context, validated DeepSeek-cited summaries and municipality corroboration without treating warnings as emergency confirmation.
- Statens vegvesen DATEX II v3.1 ingestion uses server-side Basic Auth, an SRTI-filtered default endpoint, conditional polling when available, and promotes only high-impact official traffic records. The same credentials power DATEX TravelTime in Drift as measured/estimated corridor travel time and delay pulse data only.
- Private workspace mutations use CSRF protection; persisted protected exports include manifests, checksums and provenance-separated GeoJSON.
- Automatic situation activation requires two independent sources describing an explicit incident at a specific shared place; high-impact DATEX traffic records are the official-source exception. DATEX TravelTime does not create official events or situations.

## Services

- `apps/frontend`: React/Vite interface.
- `apps/server`: authenticated Express API, PostGIS persistence, file upload and ZIP/PDF exports.
- `apps/worker`: scheduled collection, source health and AI-provider boundary.
- `packages/shared`: domain types, validation and development fixture data.

Operational documentation is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/SOURCES.md](docs/SOURCES.md) and [docs/SECURITY.md](docs/SECURITY.md).
