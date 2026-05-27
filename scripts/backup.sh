#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/nytt-trondheim}"
BACKUP_STAGE="${BACKUP_STAGE:-/var/backups/nytt-trondheim}"
mkdir -p "$BACKUP_STAGE"
cd "$APP_DIR"

docker compose --env-file .env.production exec -T postgres pg_dump -Fc -U nytt nytt > "$BACKUP_STAGE/nytt.dump"
docker run --rm -v nytt_uploads:/source:ro -v "$BACKUP_STAGE:/backup" alpine \
  sh -c 'tar -czf /backup/uploads.tar.gz -C /source .'

restic backup --retry-lock 2m "$BACKUP_STAGE/nytt.dump" "$BACKUP_STAGE/uploads.tar.gz" --tag nytt-trondheim
restic forget --retry-lock 2m --tag nytt-trondheim --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune
