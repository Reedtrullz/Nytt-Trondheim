#!/usr/bin/env bash
set -euo pipefail

: "${FIXTURE_SERVICE_ID:?Existing PostGIS CI service is required}"
: "${BOUNDS_EXPECTATION:?baseline or candidate is required}"
[[ "$BOUNDS_EXPECTATION" == baseline || "$BOUNDS_EXPECTATION" == candidate ]]
source_root="$PWD"
node_binary="$(command -v node)"
output="$source_root/.artifacts/portfolio-bounds"
mkdir -p "$output" packages/shared/dist
fixture="nytt-bounds-${GITHUB_RUN_ID:?}"
socket_root="$(mktemp -d "$RUNNER_TEMP/nytt-bounds.XXXXXX")"
chmod 755 "$socket_root"
sudo chown 999:999 "$socket_root"
cleanup() {
  docker logs "$fixture" > "$output/database-log.txt" 2>&1 || true
  docker inspect "$fixture" > "$output/container-final.json" 2>/dev/null || true
  docker rm -f -v "$fixture" > "$output/removed.txt" 2>&1 || true
  remaining="$(docker ps -aq --filter "name=^/${fixture}$")"
  if [[ -n "$remaining" ]]; then
    printf '{"removed":false}\n' > "$output/cleanup.json"
    exit 1
  fi
  sudo rm -rf -- "$socket_root"
  printf '{"removed":true,"socketDirectoryRemoved":true,"namespaceChildrenReaped":true}\n' > "$output/cleanup.json"
}
trap cleanup EXIT
trap 'exit 124' TERM INT
image="$(docker inspect --format '{{.Image}}' "$FIXTURE_SERVICE_ID")"
docker stop "$FIXTURE_SERVICE_ID" > "$output/stopped-service.txt"
docker create --name "$fixture" --pull never --network none --read-only \
  --tmpfs /var/lib/postgresql/data:rw,size=128m,uid=999,gid=999,mode=0700 \
  --tmpfs /var/run/postgresql:rw,size=4m,uid=999,gid=999 --tmpfs /tmp:rw,size=16m \
  --mount "type=bind,src=$socket_root,dst=/sock" \
  --memory 512m --memory-swap 512m --pids-limit 128 --cpus 1 \
  --log-driver local --log-opt max-size=1m --log-opt max-file=1 --log-opt compress=false \
  -e POSTGRES_USER=fixture_admin -e POSTGRES_PASSWORD=authored-fixture-only \
  -e POSTGRES_DB=fixture_db -e POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 \
  "$image" -c max_wal_size=48MB -c min_wal_size=32MB -c unix_socket_directories=/var/run/postgresql,/sock \
  -c listen_addresses='' > "$output/container-id.txt"
docker inspect "$fixture" > "$output/container-inspect.json"
docker start "$fixture" > "$output/started.txt"
for attempt in {1..40}; do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$fixture")" != true ]]; then
    echo "PostGIS fixture exited during initialization" >&2
    exit 1
  fi
  if docker exec "$fixture" sh -c '[ "$(cat /proc/1/comm)" = postgres ]' && \
    docker exec "$fixture" pg_isready -h /sock -U fixture_admin -d fixture_db >/dev/null 2>&1; then
    # PID 1 must be the final server, after the temporary initdb server has stopped.
    if docker exec -e PGPASSWORD=authored-fixture-only "$fixture" psql -X -h /sock -U fixture_admin -d fixture_db -Atc "SELECT postgis_version()" > "$output/postgis.txt" 2>/dev/null; then
      break
    fi
  fi
  sleep 0.5
done
docker exec -e PGPASSWORD=authored-fixture-only "$fixture" psql -X -h /sock -U fixture_admin -d fixture_db -v ON_ERROR_STOP=1 -c \
  "CREATE ROLE fixture_reader LOGIN NOSUPERUSER PASSWORD 'authored-reader-only';" > "$output/role.txt"
if docker exec -e PGPASSWORD=authored-wrong-password "$fixture" psql -X -h /sock -U fixture_reader -d fixture_db -c 'SELECT 1' > "$output/wrong-password.txt" 2>&1; then
  echo "Fixture unexpectedly accepted the wrong reader password" >&2
  exit 1
fi
grep -q 'password authentication failed' "$output/wrong-password.txt"
export source_root node_binary socket_root
set +e
(
  ulimit -f 512
  sudo --preserve-env=source_root,node_binary,socket_root unshare --mount --net --pid --fork --kill-child=KILL --mount-proc bash -euo pipefail -c '
    mount --make-rprivate /
    mount --bind / /
    mount -o remount,bind,ro /
    mount -t tmpfs -o size=16m,mode=1777,nosuid,nodev tmpfs /tmp
    mount -t tmpfs -o size=1m,mode=755,ro,nosuid,nodev tmpfs /dev/shm
    ip link set lo up
    mkdir -m 700 /tmp/private
    printf "%s" authored-private-canary > /tmp/private/canary
    chmod 600 /tmp/private/canary
    mkdir /tmp/source /tmp/pgsocket /tmp/home /tmp/compiled
    mount --bind "$source_root" /tmp/source
    mount -o remount,bind,ro /tmp/source
    mount --bind /tmp/private /tmp/source/.git
    mount --bind "$socket_root" /tmp/pgsocket
    mount -o remount,bind,ro /tmp/pgsocket
    mount --bind /tmp/compiled /tmp/source/packages/shared/dist
    chown 65534:65534 /tmp/home /tmp/compiled
    cd /tmp/source
    exec setpriv --reuid=65534 --regid=65534 --clear-groups --bounding-set=-all --no-new-privs \
      env -i PATH="$(dirname "$node_binary"):/usr/bin:/bin" HOME=/tmp/home TMPDIR=/tmp \
      XDG_CACHE_HOME=/tmp/home/cache CI=true \
      DATABASE_URL="postgresql://fixture_reader:authored-reader-only@localhost/fixture_db?host=/tmp/pgsocket" \
      bash -euo pipefail -c '\''
        node scripts/qa/portfolio-hosted-admission.mjs
        node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json
        node node_modules/vitest/vitest.mjs run --config scripts/qa/vitest-bounds.config.ts --configLoader runner --no-cache apps/server/test/api.test.ts -t "PgStore hides expired|PgStore keeps line-only"
        node --import tsx scripts/public-transport-bounds-smoke.ts
      '\''
  '
) > "$output/stdout.txt" 2> "$output/stderr.txt"
status=$?
set -e
printf '{"exitCode":%d,"expectation":"%s","scratchLimitBytes":16777216,"timeoutSeconds":120}\n' "$status" "$BOUNDS_EXPECTATION" > "$output/result.json"
cat "$output/stdout.txt"
cat "$output/stderr.txt" >&2
node - "$output" "$status" "$BOUNDS_EXPECTATION" <<'JS'
const fs = require('node:fs'), assert = require('node:assert/strict');
const [output,status,expectation]=process.argv.slice(2);
const lines=fs.readFileSync(output+'/stdout.txt','utf8').split('\n');
const line=lines.find(value=>value.startsWith('{"scope":"Actual PgStore/PostGIS correctness;'));
assert(line,'Missing actual PgStore result');
const result=JSON.parse(line);
assert.equal(result.role,'fixture_reader');
assert.equal(result.results.length,21);
assert.deepEqual(result.failures,expectation==='baseline'?['point-vehicles','point-alerts']:[]);
assert.equal(Number(status),expectation==='baseline'?1:0);
fs.writeFileSync(output+'/pgstore-result.json',JSON.stringify(result,null,2)+'\n');
JS
