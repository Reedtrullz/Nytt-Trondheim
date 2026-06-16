#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/nytt-trondheim}"
BACKUP_STAGE="${BACKUP_STAGE:-/var/backups/nytt-trondheim}"
STATUS_DIR="${STATUS_DIR:-$APP_DIR/runtime-status}"
CACHE_DIR="${XDG_CACHE_HOME:-/var/cache/nytt-restic}"
export XDG_CACHE_HOME="$CACHE_DIR"
mkdir -p "$BACKUP_STAGE" "$STATUS_DIR" "$CACHE_DIR"
cd "$APP_DIR"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date -u +%s)"

docker compose --env-file .env.production exec -T postgres pg_dump -Fc -U nytt nytt > "$BACKUP_STAGE/nytt.dump"
docker run --rm -v nytt_uploads:/source:ro -v "$BACKUP_STAGE:/backup" alpine \
  sh -c 'tar -czf /backup/uploads.tar.gz -C /source .'

restic unlock >/dev/null 2>&1 || true
restic backup --retry-lock 2m "$BACKUP_STAGE/nytt.dump" "$BACKUP_STAGE/uploads.tar.gz" --tag nytt-trondheim

if [[ "${BACKUP_APPLY_RETENTION:-false}" == "true" ]]; then
  restic forget --retry-lock 2m --tag nytt-trondheim --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune
fi

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
duration_seconds="$(($(date -u +%s) - started_epoch))"
printf '{"status":"ok","startedAt":"%s","completedAt":"%s","durationSeconds":%s}\n' "$started_at" "$completed_at" "$duration_seconds" > "$STATUS_DIR/backup.json.tmp"
chmod 0644 "$STATUS_DIR/backup.json.tmp"
mv "$STATUS_DIR/backup.json.tmp" "$STATUS_DIR/backup.json"
