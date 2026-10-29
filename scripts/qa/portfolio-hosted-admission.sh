#!/usr/bin/env bash
set -euo pipefail

source_root="$PWD"
node_binary="$(command -v node)"
output="$source_root/.artifacts/portfolio-runtime-admission"
mkdir -p "$output"
export source_root node_binary
set +e
(
  node scripts/qa/bounded-output.mjs "$output" 110000 sudo --preserve-env=source_root,node_binary unshare --mount --net --pid --fork --kill-child=KILL --mount-proc bash -euo pipefail -c '
    mount --make-rprivate /
    mount --bind / /
    mount -o remount,bind,ro /
    mount -t tmpfs -o size=16m,mode=1777,nosuid,nodev tmpfs /tmp
    mount -t tmpfs -o size=1m,mode=755,ro,nosuid,nodev tmpfs /dev/shm
    ip link set lo up
    mkdir -m 700 /tmp/private
    printf "%s" authored-private-canary > /tmp/private/canary
    chmod 600 /tmp/private/canary
    mkdir /tmp/source
    mount --bind "$source_root" /tmp/source
    mount -o remount,bind,ro /tmp/source
    mount --bind /tmp/private /tmp/source/.git
    mkdir /tmp/home
    chown 65534:65534 /tmp/home
    cd /tmp/source
    exec setpriv --reuid=65534 --regid=65534 --clear-groups --bounding-set=-all --no-new-privs \
      env -i PATH="$(dirname "$node_binary"):/usr/bin:/bin" HOME=/tmp/home TMPDIR=/tmp \
      XDG_CACHE_HOME=/tmp/home/cache CI=true \
      bash -euo pipefail -c '\''
        node scripts/qa/portfolio-hosted-admission.mjs
        node scripts/qa/bounded-output-checks.mjs
      '\''
  '
)
status=$?
set -e
printf '{"exitCode":%d,"applicationExecuted":false,"scratchLimitBytes":16777216,"timeoutSeconds":120}\n' "$status" > "$output/result.json"
cat "$output/stdout.txt"
if [[ "$status" != 0 ]]; then
  cat "$output/stderr.txt" >&2
fi
exit "$status"
