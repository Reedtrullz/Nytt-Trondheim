#!/usr/bin/env bash
# One protocol invocation: run-invocation.sh N ROLE PHASE SRC_CHECKOUT RECEIPT_DIR. Runs the real PgStore from SRC_CHECKOUT (read-only).
# Per-invocation scratch (cap 16 MiB) is created under the owned root, sampled every 0.1s for its whole lifetime (peak recorded,
# process killed over cap), then removed. Wrapper fields (n/role/phase/rc/identity) override anything the harness prints.
set -u
source /Users/reidar/Documents/Codex/2026-10-20/new-chat/.omo/evidence/portfolio-performance/nytt-t12-query-20261023-0257/baseline-repair/series3/env.sh
n=$1; role=$2; phase=$3; checkout=$4; out=$5
CAP=16777216
scratch=$(mktemp -d "$ROOT/inv.XXXXXX"); export TMPDIR=$scratch NODE_COMPILE_CACHE=$scratch/nc BUN_RUNTIME_TRANSPILER_CACHE_PATH=$scratch/bt
export SRC=$checkout SRC_REV=$(git -C "$checkout" rev-parse HEAD) MODE=invoke WORKLOAD_FILE=$Q/workload-W1.json QA_PG_ROOT=$checkout/node_modules/pg QA_CNAME=$CNAME QA_OFFLINE=1
export EXPECT_FIXTURE_DIGEST=$(node -e 'console.log(JSON.stringify(require(process.argv[1]).fixtureDigest))' "$Q/frozen-manifest.json")
mkdir -p "$out"
peakf="$scratch.peak"; echo 0 > "$peakf"; capf="$scratch.capkill"; rm -f "$capf"
start=$(date -u +%FT%TZ)
cd "$Q" && "$checkout/node_modules/.bin/tsx" --require "$Q/preload-pgstdio.cjs" run.mts > "$scratch.raw" 2> "$out/inv-$n.err" &
pid=$!
( while kill -0 $pid 2>/dev/null; do
    b=$(( $(du -sk "$scratch" 2>/dev/null | cut -f1) * 1024 )); [ "$b" -gt "$(cat "$peakf")" ] && echo "$b" > "$peakf"
    if [ "$b" -gt "$CAP" ]; then touch "$capf"; pkill -P $pid; kill $pid; break; fi
    sleep 0.1
  done ) &
mon=$!
wait $pid; rc=$?; wait $mon
end=$(date -u +%FT%TZ)
cid=$(docker inspect "$CNAME" --format '{{.Id}}' 2>/dev/null)
node -e 'const fs=require("fs");const [raw,n,role,phase,rc,dst,start,end,peakf,capf,cid,man,errf,script,q,checkout]=process.argv.slice(1);const sha=p=>require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");let j={};try{j=JSON.parse(fs.readFileSync(raw,"utf8"))}catch(e){j={status:"PARSE_ERROR"}}fs.writeFileSync(dst,JSON.stringify({...j,n:+n,role,phase,rc:+rc,startedAt:start,endedAt:end,peakScratchBytes:+fs.readFileSync(peakf,"utf8"),capKilled:fs.existsSync(capf),containerId:cid,manifestSha256:sha(man),runInvocationSha256:sha(script),runSha256:sha(q+"/run.mts"),stderrBytes:fs.statSync(errf).size,checkout}))' "$scratch.raw" "$n" "$role" "$phase" "$rc" "$out/inv-$n.json" "$start" "$end" "$peakf" "$capf" "$cid" "$Q/frozen-manifest.json" "$out/inv-$n.err" "$Q/run-invocation.sh" "$Q" "$checkout"
rm -rf "$scratch" "$scratch.raw" "$peakf" "$capf"
exit $rc
