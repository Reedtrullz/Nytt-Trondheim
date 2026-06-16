#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/nytt-trondheim}"
STATUS_DIR="${STATUS_DIR:-$APP_DIR/runtime-status}"
CACHE_DIR="${XDG_CACHE_HOME:-/var/cache/nytt-restic}"
export XDG_CACHE_HOME="$CACHE_DIR"
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT
mkdir -p "$STATUS_DIR" "$CACHE_DIR"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date -u +%s)"
restic check --retry-lock 2m
restic restore --retry-lock 2m latest --tag nytt-trondheim --target "$CHECK_DIR" \
  --include "*/nytt.dump" \
  --include "*/uploads.tar.gz"
dump_path="$(find "$CHECK_DIR" -name nytt.dump -print -quit)"
uploads_path="$(find "$CHECK_DIR" -name uploads.tar.gz -print -quit)"
test -s "$dump_path"
test -s "$uploads_path"
pg_restore --list "$dump_path" >/dev/null
tar -tzf "$uploads_path" >/dev/null
completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
duration_seconds="$(($(date -u +%s) - started_epoch))"
printf '{"status":"ok","startedAt":"%s","completedAt":"%s","durationSeconds":%s}\n' "$started_at" "$completed_at" "$duration_seconds" > "$STATUS_DIR/restore-check.json.tmp"
chmod 0644 "$STATUS_DIR/restore-check.json.tmp"
mv "$STATUS_DIR/restore-check.json.tmp" "$STATUS_DIR/restore-check.json"
echo "Encrypted backup restore check passed."
