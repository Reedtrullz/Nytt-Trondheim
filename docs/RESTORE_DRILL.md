# Full Restore Rehearsal Drill

This runbook proves that an encrypted Nytt Trondheim backup can become a running app and worker, not only that `nytt.dump` and `uploads.tar.gz` are readable.

## Non-production warning

Run the drill only with scratch resources. It must not write to the production Postgres container, the `nytt_postgres_data` volume, the `nytt_uploads` volume, the production app/worker containers, or the production Caddy route.

Use unique scratch names for every container, Docker volume, network, database and localhost port. If any command below resolves to `nytt_postgres_data`, `nytt_uploads`, `app`, `worker`, `postgres`, port `8090`, or `https://nytt.reidar.tech`, stop and fix the scratch variables before continuing.

The examples assume they are run on the VPS as `deploy` from `/home/deploy/nytt-trondheim`, where the deploy playbook installs `/etc/nytt-backup.env`, `/etc/nytt-rclone.conf`, `restic`, `rclone`, Docker and the latest built `nytt-trondheim-api:latest` / `nytt-trondheim-worker:latest` images.

## 0. Prepare scratch variables

```bash
cd /home/deploy/nytt-trondheim
set -euo pipefail

DRILL_ID="nytt-restore-$(date -u +%Y%m%dT%H%M%SZ)"
SCRATCH_DIR="$(mktemp -d "/tmp/${DRILL_ID}.XXXXXX")"
SCRATCH_DB_PASSWORD="$(openssl rand -hex 24)"
SCRATCH_DB_URL="postgres://nytt:${SCRATCH_DB_PASSWORD}@${DRILL_ID}-postgres:5432/nytt_restore"
SCRATCH_APP_PORT="18090"

printf 'restore drill id: %s\n' "$DRILL_ID"
```

Cleanup is intentionally listed again at the end. For an interactive rehearsal, keep a second terminal ready with:

```bash
docker rm -f "${DRILL_ID}-app" "${DRILL_ID}-worker" "${DRILL_ID}-postgres" 2>/dev/null || true
docker volume rm "${DRILL_ID}-pg" "${DRILL_ID}-uploads" 2>/dev/null || true
docker network rm "${DRILL_ID}-db" "${DRILL_ID}-outbound" 2>/dev/null || true
rm -rf "$SCRATCH_DIR"
```

## 1. Retrieve latest restic snapshot

Load the same restic/rclone environment used by the scheduled backup scripts, list the latest Nytt snapshot and restore only the database dump plus upload archive into the scratch directory.

```bash
set -a
. /etc/nytt-backup.env
set +a

restic snapshots --tag nytt-trondheim --latest 1
restic restore --retry-lock 2m latest --tag nytt-trondheim --target "$SCRATCH_DIR/restored" \
  --include '*/nytt.dump' \
  --include '*/uploads.tar.gz'

DUMP_PATH="$(find "$SCRATCH_DIR/restored" -name nytt.dump -print -quit)"
UPLOADS_ARCHIVE="$(find "$SCRATCH_DIR/restored" -name uploads.tar.gz -print -quit)"
test -s "$DUMP_PATH"
test -s "$UPLOADS_ARCHIVE"
pg_restore --list "$DUMP_PATH" >/dev/null
tar -tzf "$UPLOADS_ARCHIVE" >/dev/null
```

## 2. Restore Postgres dump to scratch DB/container

Create a private scratch PostGIS container and restore the dump into a scratch database. Do not use `docker compose up postgres` for this drill; the compose file pins the production volume name `nytt_postgres_data`.

```bash
docker network create "${DRILL_ID}-db"
docker volume create "${DRILL_ID}-pg"

docker run -d \
  --name "${DRILL_ID}-postgres" \
  --network "${DRILL_ID}-db" \
  -e POSTGRES_DB=nytt_restore \
  -e POSTGRES_USER=nytt \
  -e POSTGRES_PASSWORD="$SCRATCH_DB_PASSWORD" \
  -v "${DRILL_ID}-pg:/var/lib/postgresql/data" \
  postgis/postgis:16-3.4

until docker exec "${DRILL_ID}-postgres" pg_isready -U nytt -d nytt_restore; do
  sleep 2
done

docker exec -i "${DRILL_ID}-postgres" \
  pg_restore --no-owner --no-acl -U nytt -d nytt_restore < "$DUMP_PATH"
```

Sanity-check restored schema and data:

```bash
docker exec -i "${DRILL_ID}-postgres" \
  psql -U nytt -d nytt_restore -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At <<'SQL'
SELECT count(*) AS schema_versions FROM schema_migrations;
SELECT count(*) AS articles FROM articles;
SELECT count(*) AS situations FROM situations;
SELECT source, state, last_checked_at FROM source_health ORDER BY source LIMIT 20;
SQL
```

## 3. Restore uploads/data tarball to scratch volume

Restore the upload archive into a scratch volume only. Do not mount or overwrite `nytt_uploads`.

```bash
docker volume create "${DRILL_ID}-uploads"

docker run --rm \
  -v "${DRILL_ID}-uploads:/restore" \
  -v "$(dirname "$UPLOADS_ARCHIVE"):/backup:ro" \
  alpine \
  sh -c 'rm -rf /restore/* && tar -xzf /backup/uploads.tar.gz -C /restore && find /restore -maxdepth 2 -type f | head -20'
```

## 4. Run migration against scratch

Run the repository migration image against the scratch database URL. `-e DATABASE_URL=...` must come after `--env-file .env.production` so it overrides the production value.

```bash
docker run --rm \
  --name "${DRILL_ID}-migrate" \
  --network "${DRILL_ID}-db" \
  --env-file .env.production \
  -e DATABASE_URL="$SCRATCH_DB_URL" \
  nytt-trondheim-api:latest \
  node apps/server/dist/db/migrate.js
```

Verify the scratch database still answers after migrations:

```bash
docker exec -i "${DRILL_ID}-postgres" \
  psql -U nytt -d nytt_restore -v ON_ERROR_STOP=1 -P pager=off -At \
  -c "select version from schema_migrations order by version;"
```

## 5. Start app/worker against scratch

Create a separate outbound network for external read calls and run app/worker with the scratch database and scratch upload volume. The app binds to localhost port `18090`, not the production `8090` route.

```bash
docker network create "${DRILL_ID}-outbound"
mkdir -p "$SCRATCH_DIR/runtime-status"

docker run -d \
  --name "${DRILL_ID}-app" \
  --network "${DRILL_ID}-db" \
  --env-file .env.production \
  -e DATABASE_URL="$SCRATCH_DB_URL" \
  -e UPLOAD_DIR=/data/uploads \
  -e RUNTIME_STATUS_DIR=/data/runtime-status \
  -v "${DRILL_ID}-uploads:/data/uploads" \
  -v "$SCRATCH_DIR/runtime-status:/data/runtime-status:ro" \
  -p "127.0.0.1:${SCRATCH_APP_PORT}:8080" \
  nytt-trondheim-api:latest

docker network connect "${DRILL_ID}-outbound" "${DRILL_ID}-app"

docker run -d \
  --name "${DRILL_ID}-worker" \
  --network "${DRILL_ID}-db" \
  --env-file .env.production \
  -e DATABASE_URL="$SCRATCH_DB_URL" \
  nytt-trondheim-worker:latest

docker network connect "${DRILL_ID}-outbound" "${DRILL_ID}-worker"
```

Watch startup without following forever:

```bash
docker logs --tail=80 "${DRILL_ID}-app"
docker logs --tail=120 "${DRILL_ID}-worker"
```

## 6. Verify `/health`, source-health rows, and `/trafikk` read paths

The rehearsal passes only when the scratch app can start, read the restored DB, serve public read pages and expose source-health state from the restored backup.

```bash
curl -fsS "http://127.0.0.1:${SCRATCH_APP_PORT}/health"

curl -fsS -o "$SCRATCH_DIR/trafikk.html" \
  -w '%{http_code} %{content_type}\n' \
  "http://127.0.0.1:${SCRATCH_APP_PORT}/trafikk"

grep -Eq 'Trafikk|Nå i trafikken|Drift' "$SCRATCH_DIR/trafikk.html"
```

Verify source-health rows directly from the scratch DB:

```bash
docker exec -i "${DRILL_ID}-postgres" \
  psql -U nytt -d nytt_restore -v ON_ERROR_STOP=1 -P pager=off -F ' | ' -At <<'SQL'
SELECT source, state, detail, last_checked_at, next_poll_at
FROM source_health
ORDER BY source;
SQL
```

If authenticated map APIs are intentionally protected, an anonymous `/api/map/traffic-events` request may return `401`. That is acceptable for an auth-protected read path as long as `/trafikk` itself renders and the DB/source-health checks prove restored data is readable.

```bash
curl -sS -o "$SCRATCH_DIR/traffic-events.json" \
  -w '%{http_code}\n' \
  "http://127.0.0.1:${SCRATCH_APP_PORT}/api/map/traffic-events?north=63.5&south=63.3&east=10.6&west=10.1"
```

Expected result:

- `/health` returns HTTP 200 and reports Postgres-backed `status: ok`.
- `/trafikk` returns HTTP 200 HTML from the scratch app port.
- `source_health` rows are readable from the scratch database.
- App and worker logs show no repeated crash loop.
- No command touched the production database, production volumes or production port.

## 7. Destroy scratch resources

Destroy the scratch app, worker, Postgres container, volumes, networks and temporary files. Check the resource names before pressing Enter; every name must start with the current `$DRILL_ID`.

```bash
printf 'destroying scratch drill resources for %s\n' "$DRILL_ID"

docker rm -f "${DRILL_ID}-app" "${DRILL_ID}-worker" "${DRILL_ID}-postgres" 2>/dev/null || true
docker volume rm "${DRILL_ID}-pg" "${DRILL_ID}-uploads" 2>/dev/null || true
docker network rm "${DRILL_ID}-outbound" "${DRILL_ID}-db" 2>/dev/null || true
rm -rf "$SCRATCH_DIR"
```

Final safety check:

```bash
docker ps --format '{{.Names}}' | grep "^${DRILL_ID}-" && echo 'scratch containers still exist' || true
docker volume ls --format '{{.Name}}' | grep "^${DRILL_ID}-" && echo 'scratch volumes still exist' || true
docker network ls --format '{{.Name}}' | grep "^${DRILL_ID}-" && echo 'scratch networks still exist' || true
```
