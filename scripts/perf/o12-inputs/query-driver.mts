// Real PgStore article-query workload. Frozen run.mts stays the byte reference; this file resolves pg and @nytt/shared from the selected checkout.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { networkInterfaces } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as C from "./corpus.mts";

type Row = Record<string, unknown>;
type QueryResult = { rows: Row[]; rowCount: number | null };
type PoolLike = { query(text: string | { text: string }, params?: unknown[]): Promise<QueryResult>; end(): Promise<void> };
type PgCtor = { Pool: new (opts: Record<string, unknown>) => PoolLike };
type StoreLike = { listArticles(f: C.Filters, login: string): Promise<C.ListResult>; listSavedArticles(login: string): Promise<C.Article[]> };
type Cap = { text: string; sha: string; params: unknown[]; rows: number; bytes: number; ms: number };
type Actual = { r?: C.ListResult; error?: string; ms: number; q: Cap[] };
type Call = { id: string; repeat: number; driverMs: number; queryMs: number; queryCount: number; rows: number; bytes: number; pass: boolean; digest: string; expectedDigest: string };
type Workload = { id: string; domain: number; repeats: number; scenarios: string[]; textSet: string[]; sportSet: string[]; ordinarySet: string[] };
type Receipt = Record<string, unknown>;
const BIND = ["caseHash", "phase", "unit", "sample", "scenario", "revision", "fixtureDigest", "harnessDigest", "shape", "economicsDigest"] as const;
const HERE = dirname(fileURLToPath(import.meta.url));
let unixSocket: string | undefined;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const fileSha = (p: string): string => sha(readFileSync(p).toString("utf8"));
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function rejected(reason: string): Receipt {
  return { status: "rejected", reason };
}

export function lockedDependency(lock: string, importer: string, name: string): string {
  let section = "";
  let current = "";
  let inDeps = false;
  let dep = "";
  for (const line of lock.split("\n")) {
    if (line === "importers:") { section = "importers"; continue; }
    if (section === "importers" && line.length > 0 && !line.startsWith(" ")) { section = ""; continue; }
    if (section !== "importers") continue;
    if (line.startsWith("  ") && !line.startsWith("   ")) { current = line.trim().replace(/:$/, ""); inDeps = false; dep = ""; continue; }
    if (current !== importer) continue;
    const trimmed = line.trim();
    if (trimmed === "dependencies:" || trimmed === "devDependencies:") { inDeps = true; dep = ""; continue; }
    if (!inDeps) continue;
    if (line.startsWith("      ") && !line.startsWith("       ") && trimmed.endsWith(":")) { dep = trimmed.slice(0, -1); continue; }
    if (dep === name && trimmed.startsWith("version:")) return trimmed.slice("version:".length).trim();
  }
  throw new Error("unlocked " + importer + " " + name);
}

export function findPackageRoot(entry: string, name: string): string {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name === name) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("package root not found for " + name);
}

function exportRelative(exports: unknown, condition: "import" | "default"): string {
  if (typeof exports === "string") return exports;
  if (!exports || typeof exports !== "object") throw new Error("missing package exports");
  const dot = (exports as Record<string, unknown>)["."];
  if (typeof dot === "string") return dot;
  if (!dot || typeof dot !== "object") throw new Error("missing package export .");
  const table = dot as Record<string, unknown>;
  const chosen = table[condition] ?? table.default;
  if (typeof chosen !== "string") throw new Error("missing export condition " + condition);
  return chosen;
}

export function resolvePackageEntry(src: string, specifier: string, condition: "import" | "default"): string {
  const anchor = join(src, "apps/server/package.json");
  if (!existsSync(anchor)) throw new Error("missing apps/server package");
  const entry = createRequire(anchor).resolve(specifier);
  const root = findPackageRoot(entry, specifier);
  const realSrc = realpathSync(src);
  const realRoot = realpathSync(root);
  if (realRoot !== realSrc && !realRoot.startsWith(realSrc + sep)) throw new Error("resolved package is outside the checkout");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports?: unknown };
  return join(root, exportRelative(pkg.exports, condition));
}

export function boundStore(src: string, phase: string, expected: string): string {
  if (phase !== "baseline" && phase !== "candidate") throw new Error("incorrect phase");
  const file = join(src, "apps/server/src/store.ts");
  if (!existsSync(file)) throw new Error("missing checkout");
  const got = fileSha(file);
  if (got !== expected) throw new Error("store hash mismatch");
  return got;
}

export function requireFixtureDigest(raw: string | undefined): Row {
  if (!raw) throw new Error("missing fixture");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("missing fixture"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missing fixture");
  const row = value as Row;
  for (const key of ["a", "s", "t", "n"]) if (!(key in row)) throw new Error("missing fixture");
  return row;
}

export function authoredWorkload(protocol: unknown): Workload {
  if (!protocol || typeof protocol !== "object") throw new Error("missing protocol");
  const workload = (protocol as { workload?: unknown }).workload;
  if (!workload || typeof workload !== "object") throw new Error("missing workload");
  const w = workload as Partial<Workload>;
  if (w.id !== "W1" || w.domain !== 10000 || w.repeats !== 3) throw new Error("workload is not the authored W1 10k/3");
  if (!Array.isArray(w.scenarios) || !Array.isArray(w.textSet) || !Array.isArray(w.sportSet) || !Array.isArray(w.ordinarySet)) throw new Error("missing workload");
  const known = new Set(C.SCENARIOS.map((s) => s.id));
  for (const id of w.scenarios) if (!known.has(id)) throw new Error("unknown scenario " + id);
  const sets = [w.textSet, w.sportSet, w.ordinarySet];
  const seen = new Set<string>();
  for (const set of sets) for (const id of set) {
    if (seen.has(id) || !w.scenarios.includes(id)) throw new Error("scenario set mismatch");
    seen.add(id);
  }
  if (seen.size !== w.scenarios.length || w.scenarios.length !== 27) throw new Error("scenario set mismatch");
  return { id: w.id, domain: w.domain, repeats: w.repeats, scenarios: [...w.scenarios], textSet: [...w.textSet], sportSet: [...w.sportSet], ordinarySet: [...w.ordinarySet] };
}

export function acceptCalls(calls: Call[], expected: number): void {
  if (calls.length !== expected) throw new Error("partial result");
  for (const call of calls) {
    if (call.pass !== true || call.digest !== call.expectedDigest) throw new Error("digest mismatch " + call.id);
    if (call.queryCount < 1) throw new Error("missing query count " + call.id);
    for (const value of [call.driverMs, call.queryMs, call.rows, call.bytes]) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("invalid measurement " + call.id);
    }
  }
}

function sumCalls(calls: Call[], ids: string[], field: "queryMs" | "driverMs" | "rows" | "bytes" | "queryCount", repeats: number): number {
  const wanted = new Set(ids);
  let total = 0;
  let seen = 0;
  for (const call of calls) if (wanted.has(call.id)) { total += call[field]; seen += 1; }
  if (seen !== ids.length * repeats) throw new Error("missing set coverage");
  return field === "queryMs" || field === "driverMs" ? +total.toFixed(3) : total;
}

function metric(unit: "ms" | "count" | "bytes", value: number): Receipt {
  return { scope: "invocation", unit, values: [value] };
}

export function bindRequest(request: Receipt | undefined, phase: string): void {
  if (!request) return;
  if (request.phase !== phase) throw new Error("phase binding mismatch");
  for (const key of BIND) if (request[key] === undefined) throw new Error("partial binding " + key);
}

export function completeReceipt(workload: Workload, calls: Call[], storeSha256: string, pgVersion: string, observedFixture: Row, corpusDigest: string, request: Receipt | undefined): Receipt {
  acceptCalls(calls, workload.repeats * workload.scenarios.length);
  if (workload.textSet.length === 0 || workload.sportSet.length === 0 || workload.ordinarySet.length === 0) throw new Error("missing set coverage");
  bindRequest(request, String(request?.phase ?? "baseline"));
  const semantic = sha(C.canon(calls.map((c) => ({ id: c.id, repeat: c.repeat, digest: c.digest, expectedDigest: c.expectedDigest }))));
  const receipt: Receipt = {
    status: "complete",
    semanticDigest: semantic,
    capabilities: { driver: "nytt-article-query", engine: "PgStore", pool: "pg", pgLock: pgVersion, roles: ["fixture_admin", "fixture_server"], workload: workload.id, domain: workload.domain, repeats: workload.repeats, scenarios: workload.scenarios.length, oracle: "corpus.mts" },
    metrics: {
      text_query_ms: metric("ms", sumCalls(calls, workload.textSet, "queryMs", workload.repeats)),
      text_driver_ms: metric("ms", sumCalls(calls, workload.textSet, "driverMs", workload.repeats)),
      sport_query_ms: metric("ms", sumCalls(calls, workload.sportSet, "queryMs", workload.repeats)),
      ordinary_query_ms: metric("ms", sumCalls(calls, workload.ordinarySet, "queryMs", workload.repeats)),
      rows: metric("count", sumCalls(calls, workload.scenarios, "rows", workload.repeats)),
      bytes: metric("bytes", sumCalls(calls, workload.scenarios, "bytes", workload.repeats)),
      query_count: metric("count", sumCalls(calls, workload.scenarios, "queryCount", workload.repeats)),
    },
    calls,
    storeSha256,
    observedFixtureDigest: observedFixture,
    corpusDigest,
  };
  const metrics = receipt.metrics as Record<string, Receipt>;
  for (const id of workload.scenarios) for (const field of ["rows", "bytes", "queryCount"] as const) {
    metrics[id + "_" + field] = metric(field === "bytes" ? "bytes" : "count", sumCalls(calls, [id], field, workload.repeats));
  }
  if (request) for (const key of BIND) receipt[key] = request[key];
  return receipt;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const url = (u: string, p: string): string => "postgresql://" + u + ":" + p + "@pgstdio.invalid:5432/fixture_db";
const fold = C.makeFold(false);
const sumMs = (q: Cap[]): number => +q.reduce((x, y) => x + y.ms, 0).toFixed(3);
const normDigest = (sc: C.Scenario, x: { items: C.Article[]; nextCursor?: string }): string => C.sha(C.canon(sc.kind === "list" ? { items: x.items, nextCursor: x.nextCursor ?? null } : { items: [...x.items].sort((p, q) => (p.publishedAt < q.publishedAt ? 1 : p.publishedAt > q.publishedAt ? -1 : p.id < q.id ? -1 : 1)) }));
const outDigest = (sc: C.Scenario, r: { items?: C.Article[]; nextCursor?: string } | undefined, error: string | undefined): string => (error !== undefined || r === undefined || r.items === undefined ? "error:" + error : normDigest(sc, { items: r.items, nextCursor: r.nextCursor }));

function resolveFilters(sc: C.Scenario, exp: Record<string, C.Expected>): C.Filters {
  const f: C.Filters = { ...sc.filters };
  if (f.cursorFrom) { const c = exp[f.cursorFrom]?.nextCursor; if (c !== undefined) f.cursor = c; delete f.cursorFrom; }
  if (f.cursorIsoAt) { const [src, idx] = f.cursorIsoAt; const published = exp[src]?.items?.[idx]?.publishedAt; if (published !== undefined) f.cursor = published; delete f.cursorIsoAt; }
  return f;
}
function oracle(c: C.Corpus, sc: C.Scenario, f: C.Filters): C.Expected {
  try { return sc.kind === "list" ? C.oracleList(c, f, sc.login, fold) : { items: C.oracleSaved(c, sc.login) }; } catch (e) { return { error: errMsg(e) }; }
}

// Expected semantics are derived without PgStore, pools, SQL, or timing observations.
export function expectedSemantics(workload: Workload, corpus: C.Corpus): string {
  const exp: Record<string, C.Expected> = {};
  for (const sc of C.SCENARIOS) exp[sc.id] = oracle(corpus, sc, resolveFilters(sc, exp));
  const calls: { id: string; repeat: number; digest: string; expectedDigest: string }[] = [];
  for (let repeat = 0; repeat < workload.repeats; repeat++) for (const id of workload.scenarios) {
    const sc = C.SCENARIOS.find((s) => s.id === id), e = exp[id];
    if (!sc || !e) throw new Error("unknown oracle scenario " + id);
    const digest = outDigest(sc, e, e.error);
    calls.push({ id, repeat, digest, expectedDigest: digest });
  }
  return sha(C.canon(calls));
}

export function requireSocketContext(socket: string): void {
  if (socket !== "/tmp/pgsocket" || process.platform !== "linux" || process.getuid?.() !== 65534) throw new Error("isolated Unix socket context required");
  if (!/^NoNewPrivs:\s+1$/m.test(readFileSync("/proc/self/status", "utf8"))) throw new Error("no-new-privileges required");
  if (!statSync(join(socket, ".s.PGSQL.5432")).isSocket()) throw new Error("fixture socket missing");
  const interfaces = readFileSync("/proc/net/dev", "utf8").split("\n").filter((s) => s.includes(":"));
  if (interfaces.some((s) => s.split(":")[0]?.trim() !== "lo")) throw new Error("network namespace required");
  if (Object.keys(networkInterfaces()).some((s) => s !== "lo")) throw new Error("external interface present");
}

type Runtime = { src: string; pgRoot: string; admin: PoolLike; serverPool: PoolLike; store: StoreLike; captured: Cap[]; realQuery: PoolLike["query"]; shared: C.Shared };

function armTransport(src: string, pgRoot: string): void {
  if (!process.env.QA_CNAME) throw new Error("missing stdio fixture");
  if (process.env.QA_OFFLINE !== "1") throw new Error("QA_OFFLINE must be 1");
  process.env.QA_PG_ROOT = pgRoot;
  createRequire(import.meta.url)(join(src, "scripts/perf/o12-inputs/preload-pgstdio.cjs"));
  const stream = createRequire(join(pgRoot, "package.json"))(join(pgRoot, "lib/stream.js")) as { getStream?: unknown };
  if (!String(stream.getStream).includes("DockerStdioSocket")) throw new Error("stdio preload missed the resolved pg package");
}

async function loadRuntime(src: string): Promise<Runtime> {
  const pgEntry = resolvePackageEntry(src, "pg", "import");
  const pgRoot = findPackageRoot(pgEntry, "pg");
  if (unixSocket) requireSocketContext(unixSocket); else armTransport(src, pgRoot);
  const pgMod = await import(pathToFileURL(pgEntry).href) as { default?: PgCtor } & Partial<PgCtor>;
  const pg = pgMod.default ?? pgMod;
  if (!pg.Pool) throw new Error("pg.Pool missing");
  const shared = await import(pathToFileURL(resolvePackageEntry(src, "@nytt/shared", "default")).href) as C.Shared;
  const storeMod = await import(pathToFileURL(join(src, "apps/server/src/store.ts")).href) as { PgStore: new (pool: PoolLike, mode: string) => StoreLike };
  const connection = (user: string, password: string): Record<string, unknown> => unixSocket
    ? { host: unixSocket, port: 5432, database: "fixture_db", user, password }
    : { connectionString: url(user, password) };
  const admin = new pg.Pool({ ...connection("fixture_admin", "fixture_admin_pw"), max: 2 });
  const serverPool = new pg.Pool({ ...connection("fixture_server", "fixture_server_pw"), ...shared.buildDatabasePoolOptions("server") });
  const captured: Cap[] = [];
  const realQuery = serverPool.query.bind(serverPool);
  serverPool.query = async (text: string | { text: string }, params?: unknown[]): Promise<QueryResult> => {
    const t0 = performance.now();
    const res = await realQuery(text, params);
    const t = typeof text === "string" ? text : text.text;
    const rows = typeof res.rowCount === "number" ? res.rowCount : res.rows.length;
    captured.push({ text: t, sha: C.sha(t), params: params ?? [], rows, bytes: Buffer.byteLength(JSON.stringify(res.rows)), ms: performance.now() - t0 });
    return res;
  };
  return { src, pgRoot, admin, serverPool, store: new storeMod.PgStore(serverPool, "legacy"), captured, realQuery, shared };
}

async function seed(rt: Runtime, c: C.Corpus): Promise<void> {
  await rt.admin.query("TRUNCATE articles, situations, saved_articles, official_events RESTART IDENTITY CASCADE");
  for (let o = 0; o < c.articles.length; o += 500) {
    const part = c.articles.slice(o, o + 500), params: unknown[] = [], vals: string[] = [];
    part.forEach((a) => { const b = params.length; params.push(a.id, a.url, a.id, a.source, a.publishedAt, a.scope, a.category, a); vals.push("($" + (b + 1) + ",$" + (b + 2) + ",$" + (b + 3) + ",$" + (b + 4) + ",$" + (b + 5) + ",$" + (b + 6) + ",$" + (b + 7) + ",$" + (b + 8) + ")"); });
    await rt.admin.query("INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload) VALUES " + vals.join(","), params);
  }
  for (const s of c.situations) await rt.admin.query("INSERT INTO situations (id,type,status,verification_status,importance,updated_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)", [s.id, s.type, s.status, s.verificationStatus, s.importance, s.updatedAt, s]);
  for (const o of C.OWNERS) for (const id of c.saved[o] ?? []) await rt.admin.query("INSERT INTO saved_articles (github_login, article_id) VALUES ($1,$2)", [o, id]);
  await rt.admin.query("ANALYZE");
}
async function fixtureDigest(rt: Runtime): Promise<Row> {
  const r = await rt.admin.query("SELECT md5(string_agg(id || payload::text, '' ORDER BY id)) AS a, (SELECT md5(string_agg(github_login||article_id, '' ORDER BY github_login, article_id)) FROM saved_articles) AS s, (SELECT md5(string_agg(id||payload::text, '' ORDER BY id)) FROM situations) AS t, count(*)::int AS n FROM articles");
  const row = r.rows[0];
  if (!row) throw new Error("missing fixture");
  return row;
}
async function actual(rt: Runtime, sc: C.Scenario, f: C.Filters): Promise<Actual> {
  rt.captured.length = 0;
  const t0 = performance.now();
  try {
    const r = sc.kind === "list" ? await rt.store.listArticles(f, sc.login) : { items: await rt.store.listSavedArticles(sc.login) };
    return { r, ms: performance.now() - t0, q: rt.captured.slice() };
  } catch (e) { return { error: errMsg(e), ms: performance.now() - t0, q: rt.captured.slice() }; }
}
function same(sc: C.Scenario, a: Actual, e: C.Expected): boolean {
  if (e.error !== undefined || a.error !== undefined || a.r === undefined) return e.error === a.error;
  const ai = a.r.items, ei = e.items;
  if (sc.kind === "saved") {
    const key = (l: C.Article[]): string => l.map((x) => x.publishedAt).join();
    if (key(ai) !== key(ei) || ai.length !== ei.length) return false;
    const em = new Map(ei.map((x) => [x.id, C.canon(x)]));
    return ai.every((x) => em.get(x.id) === C.canon(x));
  }
  if (ai.length !== ei.length || (a.r.nextCursor ?? null) !== (e.nextCursor ?? null)) return false;
  return ai.every((item, i) => C.canon(item) === C.canon(ei[i]));
}

async function measure(rt: Runtime, workload: Workload, expectedFixture: Row | undefined): Promise<{ calls: Call[]; observed: Row; corpusDigest: string }> {
  const corpus = C.buildCorpus(workload.domain, rt.shared);
  if (!expectedFixture) throw new Error("missing fixture");
  const observed = await fixtureDigest(rt);
  if (C.canon(observed) !== C.canon(expectedFixture)) throw new Error("fixture mismatch");
  const exp: Record<string, C.Expected> = {}, calls: Call[] = [], fmap = new Map<string, C.Filters>();
  for (const sc of C.SCENARIOS) {
    const f = resolveFilters(sc, exp);
    exp[sc.id] = oracle(corpus, sc, f);
    fmap.set(sc.id, f);
  }
  for (let repeat = 0; repeat < workload.repeats; repeat++) for (const id of workload.scenarios) {
    const sc = C.SCENARIOS.find((x) => x.id === id);
    const f = fmap.get(id);
    const e = exp[id];
    if (!sc || !f || !e) throw new Error("unknown scenario " + id);
    const a = await actual(rt, sc, f);
    calls.push({ id, repeat, driverMs: +a.ms.toFixed(3), queryMs: sumMs(a.q), queryCount: a.q.length, rows: a.q.reduce((x, y) => x + y.rows, 0), bytes: a.q.reduce((x, y) => x + y.bytes, 0), pass: same(sc, a, e), digest: outDigest(sc, a.r, a.error), expectedDigest: outDigest(sc, e, e.error) });
  }
  return { calls, observed, corpusDigest: C.sha(C.canon(corpus.articles)) };
}

async function runInvoke(src: string, phase: string, storeSha: string, workload: Workload, fixtureRaw: string, request: Receipt | undefined): Promise<Receipt> {
  const got = boundStore(src, phase, storeSha);
  const expected = requireFixtureDigest(fixtureRaw);
  const pgVersion = lockedDependency(readFileSync(join(src, "pnpm-lock.yaml"), "utf8"), "apps/server", "pg");
  const rt = await loadRuntime(src);
  try {
    const measured = await measure(rt, workload, expected);
    return completeReceipt(workload, measured.calls, got, pgVersion, measured.observed, measured.corpusDigest, request);
  } finally { await rt.serverPool.end(); await rt.admin.end(); }
}

async function selfCheck(): Promise<void> {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync: mk } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const protocol = authoredWorkload(JSON.parse(readFileSync(join(HERE, "protocol.json"), "utf8")));
  if (protocol.scenarios.length !== 27) throw new Error("self-check authored workload");
  const bad = structuredClone(JSON.parse(readFileSync(join(HERE, "protocol.json"), "utf8"))) as { workload: { scenarios: string[] } };
  bad.workload.scenarios.push("NOPE");
  expectThrow(() => authoredWorkload(bad), "unknown scenario");
  expectThrow(() => boundStore(HERE, "common", "abc"), "incorrect phase");
  expectThrow(() => requireFixtureDigest(undefined), "missing fixture");
  expectThrow(() => requireFixtureDigest("{}"), "missing fixture");
  const seed = JSON.parse(readFileSync(join(HERE, "seed.json"), "utf8")) as { fixtureDigest?: unknown };
  requireFixtureDigest(JSON.stringify(seed.fixtureDigest));
  const root = mkdtempSync(join(tmpdir(), "o12-qd-"));
  try {
    const src = join(root, "checkout");
    mk(join(src, "apps/server/node_modules/pg/lib"), { recursive: true });
    mk(join(src, "apps/server/node_modules/pg/esm"), { recursive: true });
    mk(join(src, "node_modules/pg/esm"), { recursive: true });
    mk(join(src, "apps/server/src"), { recursive: true });
    writeFileSync(join(src, "apps/server/package.json"), JSON.stringify({ name: "server" }));
    writeFileSync(join(src, "apps/server/node_modules/pg/package.json"), JSON.stringify({ name: "pg", main: "./lib/index.js", exports: { ".": { import: "./esm/index.mjs", require: "./lib/index.js" } } }));
    writeFileSync(join(src, "apps/server/node_modules/pg/lib/index.js"), "module.exports={}");
    writeFileSync(join(src, "apps/server/node_modules/pg/esm/index.mjs"), "export default {}");
    writeFileSync(join(src, "node_modules/pg/package.json"), JSON.stringify({ name: "pg", exports: { ".": "./esm/index.mjs" } }));
    writeFileSync(join(src, "node_modules/pg/esm/index.mjs"), "decoy");
    const resolved = resolvePackageEntry(src, "pg", "import");
    if (!resolved.endsWith(join("apps/server/node_modules/pg/esm/index.mjs"))) throw new Error("self-check resolved the flat pg path");
    writeFileSync(join(src, "apps/server/src/store.ts"), "store-bytes");
    const digest = fileSha(join(src, "apps/server/src/store.ts"));
    if (boundStore(src, "candidate", digest) !== digest) throw new Error("self-check store");
    expectThrow(() => boundStore(src, "baseline", "deadbeef"), "store hash mismatch");
    expectThrow(() => boundStore(join(root, "absent"), "baseline", digest), "missing checkout");
  } finally { rmSync(root, { recursive: true, force: true }); }
  const lock = readFileSync(join(HERE, "../../../pnpm-lock.yaml"), "utf8");
  if (lockedDependency(lock, ".", "pg") !== "8.21.0" || lockedDependency(lock, "apps/server", "pg") !== "8.21.0") throw new Error("self-check pg lock");
  if (lockedDependency(lock, "apps/server", "tsx") !== "4.22.3") throw new Error("self-check tsx lock");
  expectThrow(() => acceptCalls([], 81), "partial result");
  const good = call("A14", "aa");
  expectThrow(() => acceptCalls([{ ...good, digest: "no" }], 1), "digest mismatch");
  expectThrow(() => acceptCalls([{ ...good, queryCount: 0 }], 1), "missing query count");
  const workload: Workload = { id: "W1", domain: 10000, repeats: 1, scenarios: ["A14", "A09", "A01"], textSet: ["A14"], sportSet: ["A09"], ordinarySet: ["A01"] };
  const situations = C.genSituations(20);
  const pure: C.Corpus = { n: 20, articles: C.genArticles(20, (s) => s), situations, saved: {}, featured: C.featuredSituations(situations) };
  const oracleDigest = expectedSemantics(workload, pure);
  if (!/^[0-9a-f]{64}$/.test(oracleDigest) || oracleDigest !== expectedSemantics(workload, pure)) throw new Error("self-check pure oracle digest");
  expectThrow(() => expectedSemantics({ ...workload, scenarios: ["NOPE"] }, pure), "unknown oracle scenario");
  expectThrow(() => requireSocketContext("/not-an-admitted-socket"), "isolated Unix socket context");
  const request = { caseHash: "c", phase: "baseline", unit: "pilot-0-0", sample: 0, scenario: "happy", revision: "r", fixtureDigest: "f", harnessDigest: "h", shape: "s", economicsDigest: "e" };
  const ok = completeReceipt(workload, [good, call("A09", "bb"), call("A01", "cc")], "store", "8.21.0", { a: "1", s: "2", t: "3", n: 1 }, "corpus", request);
  if (ok.status !== "complete" || ok.caseHash !== "c" || rejected("x").status === "complete") throw new Error("self-check receipt");
  const changed = [good, call("A09", "bb"), call("A01", "cc")].map((c) => ({ ...c, rows: c.rows + 4, bytes: c.bytes + 8, queryCount: c.queryCount + 1, driverMs: 9, queryMs: 9 }));
  const other = completeReceipt(workload, changed, "store", "8.21.0", { a: "1", s: "2", t: "3", n: 1 }, "corpus", request);
  const rowsOf = (r: Receipt): number => (r.metrics as { rows: { values: number[] } }).rows.values[0] ?? -1;
  if (ok.semanticDigest !== other.semanticDigest || rowsOf(ok) === rowsOf(other)) throw new Error("self-check semantic counters");
  const savedName = process.env.QA_CNAME, savedOff = process.env.QA_OFFLINE;
  delete process.env.QA_CNAME;
  delete process.env.QA_OFFLINE;
  try {
    expectThrow(() => armTransport(HERE, HERE), "missing stdio fixture");
    process.env.QA_CNAME = "fixture";
    expectThrow(() => armTransport(HERE, HERE), "QA_OFFLINE must be 1");
  } finally {
    if (savedName === undefined) delete process.env.QA_CNAME; else process.env.QA_CNAME = savedName;
    if (savedOff === undefined) delete process.env.QA_OFFLINE; else process.env.QA_OFFLINE = savedOff;
  }
  expectThrow(() => bindRequest({ ...request, phase: "candidate" }, "baseline"), "phase binding mismatch");
  const flatPg = String.fromCharCode(34) + "/" + "node_modules/pg/esm/index.mjs" + String.fromCharCode(34);
  if (readFileSync(fileURLToPath(import.meta.url), "utf8").includes(flatPg)) throw new Error("self-check hardcoded pg path");
  process.stdout.write(JSON.stringify({ status: "PASS", checks: ["authored-w1", "phase", "store-hash", "fixture", "unknown-scenario", "partial", "digest", "query-count", "pg-lock", "resolver"] }) + "\n");
}

function call(id: string, digest: string): Call {
  return { id, repeat: 0, driverMs: 1, queryMs: 1, queryCount: 1, rows: 1, bytes: 1, pass: true, digest, expectedDigest: digest };
}
function expectThrow(fn: () => unknown, part: string): void {
  try { fn(); } catch (e) { if (!errMsg(e).includes(part)) throw new Error("self-check wanted " + part + " got " + errMsg(e)); return; }
  throw new Error("self-check accepted " + part);
}

function fail(reason: string): never {
  process.stdout.write(JSON.stringify(rejected(reason)) + "\n");
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-check")) { await selfCheck(); return; }
  const mode = flag(argv, "--mode") ?? process.env.MODE ?? "invoke";
  const src = flag(argv, "--checkout") ?? process.env.SRC;
  const phase = flag(argv, "--phase") ?? process.env.PHASE;
  const storeSha = flag(argv, "--store-sha") ?? process.env.EXPECT_STORE_SHA;
  const protocolPath = flag(argv, "--protocol") ?? process.env.PROTOCOL_FILE ?? join(HERE, "protocol.json");
  const fixtureRaw = flag(argv, "--fixture-digest") ?? process.env.EXPECT_FIXTURE_DIGEST ?? JSON.stringify((JSON.parse(readFileSync(join(HERE, "seed.json"), "utf8")) as { fixtureDigest: unknown }).fixtureDigest);
  if (!src || !phase || !storeSha) throw new Error("missing checkout, phase, or store hash");
  const request = process.env.MEASURE_REQUEST ? JSON.parse(process.env.MEASURE_REQUEST) as Receipt : undefined;
  bindRequest(request, phase);
  const workload = authoredWorkload(JSON.parse(readFileSync(protocolPath, "utf8")));
  if (mode === "expected") {
    boundStore(src, phase, storeSha);
    const shared = await import(pathToFileURL(resolvePackageEntry(src, "@nytt/shared", "default")).href) as C.Shared;
    const corpus = C.buildCorpus(workload.domain, shared);
    const lock = readFileSync(join(src, "pnpm-lock.yaml"), "utf8");
    const pgLock = lockedDependency(lock, "apps/server", "pg");
    const pgRoot = findPackageRoot(resolvePackageEntry(src, "pg", "import"), "pg");
    const installed = JSON.parse(readFileSync(join(pgRoot, "package.json"), "utf8")) as { version?: string };
    if (installed.version !== pgLock) throw new Error("installed pg differs from locked graph");
    process.stdout.write(JSON.stringify({ status: "expected", semanticDigest: expectedSemantics(workload, corpus), capabilities: { driver: "nytt-article-query", engine: "PgStore", pool: "pg", pgLock, roles: ["fixture_admin", "fixture_server"], workload: workload.id, domain: workload.domain, repeats: workload.repeats, scenarios: workload.scenarios.length, oracle: "corpus.mts" } }) + "\n");
    return;
  }
  unixSocket = flag(argv, "--socket");
  if (mode === "invoke") {
    if (unixSocket && !request) throw new Error("hosted invoke requires MEASURE_REQUEST");
    process.stdout.write(JSON.stringify(await runInvoke(src, phase, storeSha, workload, fixtureRaw, request)) + "\n");
    return;
  }
  if (mode === "oracle" || mode === "seed") {
    const got = boundStore(src, phase, storeSha);
    const rt = await loadRuntime(src);
    try {
      const corpus = C.buildCorpus(workload.domain, rt.shared);
      if (mode === "seed") await seed(rt, corpus);
      const observed = mode === "seed" ? await fixtureDigest(rt) : undefined;
      process.stdout.write(JSON.stringify({ status: mode === "seed" ? "seeded" : "oracle", storeSha256: got, corpusDigest: C.sha(C.canon(corpus.articles)), observedFixtureDigest: observed }) + "\n");
    } finally { await rt.serverPool.end(); await rt.admin.end(); }
    return;
  }
  throw new Error("unknown mode");
}

await main().catch((e: unknown) => fail(errMsg(e)));
