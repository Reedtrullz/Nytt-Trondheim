#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_EVENT_NAME:?}" == workflow_dispatch && "${GITHUB_REF:?}" != refs/heads/main ]]
[[ "$(df -Pk / | awk 'NR==2 {print $4}')" -ge 31457280 ]]
source_root="$PWD"
node_binary="$(command -v node)"
[[ "$($node_binary --version)" == v22.22.3 ]]
[[ "$(pnpm --version)" == 10.34.5 ]]
output="$source_root/.artifacts/o12-hosted-w1"
mkdir -p "$output"
owned="$(mktemp -d "${RUNNER_TEMP:?}/o12-w1.XXXXXX")"
fixture="nytt-o12-w1-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
printf '%s\n' "$owned" "$fixture" > "$output/owned-resources.txt"
cleanup() {
  status=$?
  trap - EXIT
  docker rm -f -v "$fixture" > "$output/removed.txt" 2>&1 || true
  remaining="$(docker ps -aq --filter "name=^/${fixture}$")"
  if [[ -n "$remaining" ]]; then
    printf '{"removed":false}\n' > "$output/cleanup.json"
    exit 1
  fi
  sudo rm -rf -- "$owned"
  [[ ! -e "$owned" ]] || exit 1
  printf '{"removed":true,"ownedDirectoryRemoved":true,"namespaceExited":true}\n' > "$output/cleanup.json"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 124' TERM INT
head="$(git rev-parse HEAD)"
base="$(git rev-parse HEAD^)"
for phase in baseline candidate; do
  git clone --no-hardlinks --no-checkout "$source_root" "$owned/$phase"
  git -C "$owned/$phase" remote remove origin
  revision="$head"
  [[ "$phase" != baseline ]] || revision="$base"
  git -C "$owned/$phase" checkout --detach "$revision"
  # Install/build before isolation; both immutable phases use the same lock graph.
  (cd "$owned/$phase" && pnpm install --frozen-lockfile && pnpm --filter @nytt/shared run build)
done
cmp "$owned/baseline/pnpm-lock.yaml" "$owned/candidate/pnpm-lock.yaml"
tsx_binary="$(realpath "$owned/candidate/apps/server/node_modules/tsx/dist/cli.mjs")"
mkdir "$owned/socket" "$owned/result"
chmod 755 "$owned" "$owned/socket"
sudo chown 999:999 "$owned/socket"
sudo chown -R 65534:65534 "$owned/result"
docker create --name "$fixture" --network none --read-only \
  --tmpfs /var/lib/postgresql/data:rw,size=128m,uid=999,gid=999,mode=0700 \
  --tmpfs /var/run/postgresql:rw,size=4m,uid=999,gid=999 --tmpfs /tmp:rw,size=16m \
  --mount "type=bind,src=$owned/socket,dst=/sock" \
  --memory 512m --memory-swap 512m --pids-limit 128 --cpus 1 \
  --log-driver local --log-opt max-size=1m --log-opt max-file=1 --log-opt compress=false \
  -e POSTGRES_USER=fixture_admin -e POSTGRES_PASSWORD=fixture_admin_pw \
  -e POSTGRES_DB=fixture_db -e POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 \
  postgis/postgis:16-3.4 -c max_wal_size=48MB -c min_wal_size=32MB \
  -c unix_socket_directories=/var/run/postgresql,/sock -c listen_addresses='' > "$output/container-id.txt"
docker inspect "$fixture" > "$output/container-inspect.json"
docker start "$fixture" > "$output/started.txt"
ready=false
for attempt in {1..40}; do
  if docker exec "$fixture" sh -c '[ "$(cat /proc/1/comm)" = postgres ]' && \
    docker exec -e PGPASSWORD=fixture_admin_pw "$fixture" psql -X -h /sock -U fixture_admin -d fixture_db -Atc 'SELECT postgis_version()' > "$output/postgis.txt" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 0.5
done
[[ "$ready" == true ]]
# Run the genuine existing sandbox/native canaries before schema or app work.
(cd "$owned/baseline" && timeout --signal=TERM --kill-after=5s 120s bash scripts/qa/portfolio-hosted-admission.sh)
cp "$owned/baseline/.artifacts/portfolio-runtime-admission/stdout.txt" "$owned/pre-schema-admission.json"
sudo chown -R 65534:65534 "$owned/baseline" "$owned/candidate"
docker exec -i -e PGPASSWORD=fixture_admin_pw "$fixture" psql -X -h /sock -U fixture_admin -d fixture_db -v ON_ERROR_STOP=1 \
  < "$owned/baseline/apps/server/src/db/schema.sql" > "$output/schema.txt" 2>&1
docker exec -e PGPASSWORD=fixture_admin_pw "$fixture" psql -X -h /sock -U fixture_admin -d fixture_db -v ON_ERROR_STOP=1 -c \
  "CREATE ROLE fixture_server LOGIN NOSUPERUSER PASSWORD 'fixture_server_pw'; GRANT CONNECT ON DATABASE fixture_db TO fixture_server; GRANT USAGE ON SCHEMA public TO fixture_server; GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixture_server;" > "$output/role.txt"
if docker exec -e PGPASSWORD=authored-wrong-password "$fixture" psql -X -h /sock -U fixture_server -d fixture_db -c 'SELECT 1' > "$output/wrong-password.txt" 2>&1; then exit 1; fi
grep -q 'password authentication failed' "$output/wrong-password.txt"
docker inspect "$fixture" > "$owned/db-inspect.json"
docker exec -e PGPASSWORD=fixture_server_pw "$fixture" psql -X -h /sock -U fixture_server -d fixture_db -Atc \
  'SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user' > "$owned/db-role.txt"
python3 scripts/perf/o12-hosted.py --admit-db "$owned/db-inspect.json" "$owned/db-role.txt" > "$output/db-admission.json"
export owned node_binary tsx_binary source_root
# One read-only source/network/PID namespace covers both phases and all engine calls.
# /tmp is the combined 16 MiB parent/child/cache/artifact filesystem.
set +e
sudo --preserve-env=owned,node_binary,tsx_binary,source_root unshare --mount --net --pid --fork --kill-child=KILL --mount-proc bash -euo pipefail -c '
  mount --make-rprivate /
  mount --bind / /
  mount -o remount,bind,ro /
  mount -t tmpfs -o size=16m,mode=1777,nosuid,nodev tmpfs /tmp
  mount -t tmpfs -o size=1m,mode=755,ro,nosuid,nodev tmpfs /dev/shm
  ip link set lo up
  mkdir /tmp/pgsocket /tmp/measurement /tmp/private /tmp/home
  printf "%s" authored-private-canary > /tmp/private/canary
  chmod 700 /tmp/private
  mount --bind /tmp/private "$source_root/.git"
  for phase in baseline candidate; do
    mount --bind "$owned/$phase" "$owned/$phase"
    mount -o remount,bind,ro "$owned/$phase"
  done
  mount --bind "$owned/socket" /tmp/pgsocket
  mount -o remount,bind,ro /tmp/pgsocket
  mount --bind "$owned/result" "$owned/result"
  mount -o remount,bind,rw "$owned/result"
  chown 65534:65534 /tmp/measurement /tmp/home
  cp "$owned/db-inspect.json" "$owned/db-role.txt" "$owned/pre-schema-admission.json" /tmp/measurement/
  # Ephemeral .git directories contain no remotes, auth headers, or global config.
  # Their source and metadata are owned by UID65534 and mounted read-only with /.
  set +e
  cd "$owned/baseline"
  setpriv --reuid=65534 --regid=65534 --clear-groups --bounding-set=-all --no-new-privs \
    env -i PATH="$(dirname "$node_binary"):/usr/bin:/bin" HOME=/tmp/home TMPDIR=/tmp \
    "$node_binary" scripts/qa/portfolio-hosted-admission.mjs > /tmp/measurement/admission.json
  admission=$?
  [[ "$admission" == 0 ]] || exit "$admission"
  setpriv --reuid=65534 --regid=65534 --clear-groups --bounding-set=-all --no-new-privs \
    env -i PATH="$(dirname "$node_binary"):/usr/bin:/bin" HOME=/tmp/measurement TMPDIR=/tmp \
    PYTHONDONTWRITEBYTECODE=1 LANG=C \
    python3 "$owned/baseline/scripts/perf/o12-hosted.py" /tmp/measurement "$owned/baseline" "$owned/candidate" "$node_binary" "$tsx_binary"
  code=$?
  set -e
  cp -a /tmp/measurement/. "$owned/result/"
  exit "$code"
'
status=$?
set -e
sudo cp -a "$owned/result/." "$output/runtime/"
sudo chown -R "$(id -u):$(id -g)" "$output/runtime"
printf '{"exitCode":%d,"measurementScope":"W1 only; whole O12 incomplete"}\n' "$status" > "$output/result.json"
exit "$status"
