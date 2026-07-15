#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/nytt-trondheim}"
STATUS_DIR="${STATUS_DIR:-$APP_DIR/runtime-status}"
CACHE_DIR="${XDG_CACHE_HOME:-/var/cache/nytt-restic}"
MAX_ATTEMPTS="${RESTORE_CHECK_MAX_ATTEMPTS:-2}"
RETRY_DELAY_SECONDS="${RESTORE_CHECK_RETRY_DELAY_SECONDS:-20}"
export XDG_CACHE_HOME="$CACHE_DIR"
CHECK_DIR="$(mktemp -d)"
trap 'rm -rf "$CHECK_DIR"' EXIT
mkdir -p "$STATUS_DIR" "$CACHE_DIR"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date -u +%s)"

if ! [[ "$MAX_ATTEMPTS" =~ ^[1-3]$ ]]; then
  echo "RESTORE_CHECK_MAX_ATTEMPTS must be between 1 and 3." >&2
  exit 2
fi
if ! [[ "$RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]] || ((RETRY_DELAY_SECONDS > 300)); then
  echo "RESTORE_CHECK_RETRY_DELAY_SECONDS must be between 0 and 300." >&2
  exit 2
fi

retry_restic_read() {
  local label="$1"
  shift
  local attempt=1

  while true; do
    if "$@"; then
      return 0
    fi
    if ((attempt >= MAX_ATTEMPTS)); then
      echo "$label failed after $attempt attempt(s)." >&2
      return 1
    fi
    echo "$label failed on attempt $attempt; retrying after ${RETRY_DELAY_SECONDS}s." >&2
    sleep "$RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
}

restore_latest_snapshot() {
  rm -rf "$CHECK_DIR/restored"
  mkdir -p "$CHECK_DIR/restored"
  restic restore --retry-lock 2m latest --tag nytt-trondheim --target "$CHECK_DIR/restored" \
    --include "*/nytt.dump" \
    --include "*/uploads.tar.gz"
}

# rclone already retries individual requests. These bounded whole-operation retries cover a
# connection timeout after restic has opened the repository while preserving a fail-closed gate.
retry_restic_read "Repository integrity check" restic check --retry-lock 2m
retry_restic_read "Snapshot restore" restore_latest_snapshot
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
