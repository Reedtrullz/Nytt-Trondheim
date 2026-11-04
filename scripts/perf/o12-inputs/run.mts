// Article baseline/candidate harness (Issue81). Executes the REAL PgStore from a read-only checkout (SRC) with a real pg.Pool over the
// docker-exec stdio wire adapter (preload-pgstdio.cjs). MODE=full: seed+verify+EXPLAIN. MODE=invoke: one protocol invocation receipt.
// Strict TypeScript, no suppression.
import { appendFileSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import * as C from "./corpus.mts";

type Row = Record<string, unknown>;
type QueryResult = { rows: Row[]; rowCount: number | null };
type PoolLike = { query(text: string | { text: string }, params?: unknown[]): Promise<QueryResult>; end(): Promise<void> };
type PgModule = { default: { Pool: new (opts: Record<string, unknown>) => PoolLike } };
type StoreLike = { listArticles(f: C.Filters, login: string): Promise<C.ListResult>; listSavedArticles(login: string): Promise<C.Article[]> };
type MemLike = { articles: C.Article[]; listArticles(f: C.Filters): Promise<C.ListResult> };
type StoreModule = { PgStore: new (pool: PoolLike, mode: string) => StoreLike; MemoryStore: new (mode: string) => MemLike };
type Cap = { text: string; sha: string; params: unknown[]; rows: number; bytes: number; ms: number };
type Actual = { r?: C.ListResult; error?: string; ms: number; q: Cap[] };
type Diff = Record<string, unknown>;
type PlanNode = { "Node Type": string; "Index Name"?: string; "Relation Name"?: string; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; "Actual Rows"?: number; Plans?: PlanNode[] };
type PlanDoc = { Plan: PlanNode; "Execution Time": number; "Planning Time": number; JIT?: unknown };
type PlanSummary = { qi: number; sha: string; exec?: number; planning?: number; jit?: boolean; rootRows?: number; nodes?: string[]; indexes?: string[]; relations?: string[]; sharedHit?: number; sharedRead?: number; explainError?: string };
type Workload = { id: string; domain: number; repeats: number; scenarios: string[] };

const env = (k: string): string => { const v = process.env[k]; if (v === undefined || v === "") throw new Error("missing env " + k); return v; };
const SRC = env("SRC"), Q = env("Q"), MODE = process.env.MODE || "full", TMP = env("TMPDIR");
const pgMod = (await import("file://" + SRC + "/node_modules/pg/esm/index.mjs")) as PgModule;
const pg = pgMod.default;
const shared = (await import(SRC + "/packages/shared/dist/index.js")) as C.Shared;
const { PgStore, MemoryStore } = (await import(SRC + "/apps/server/src/store.ts")) as StoreModule;
const url = (u: string, p: string): string => "postgresql://" + u + ":" + p + "@pgstdio.invalid:5432/fixture_db";
const D = Q + "/data"; mkdirSync(D, { recursive: true });
const wr = (f: string, o: unknown): void => appendFileSync(D + "/" + f, JSON.stringify(o) + "\n");
const fold = C.makeFold(false); // fixture DB is en_US.utf8 (recorded in logs/dbinfo.out)
const admin = new pg.Pool({ connectionString: url("fixture_admin", "fixture_admin_pw"), max: 2 });
const serverPool = new pg.Pool({ connectionString: url("fixture_server", "fixture_server_pw"), ...shared.buildDatabasePoolOptions("server") });
const captured: Cap[] = [];
const realQuery = serverPool.query.bind(serverPool);
serverPool.query = async (text: string | { text: string }, params?: unknown[]): Promise<QueryResult> => {
  const t0 = performance.now(); const res = await realQuery(text, params); const ms = performance.now() - t0;
  const t = typeof text === "string" ? text : text.text;
  captured.push({ text: t, sha: C.sha(t), params: params ?? [], rows: res.rowCount ?? 0, bytes: Buffer.byteLength(JSON.stringify(res.rows)), ms });
  return res;
};
const store = new PgStore(serverPool, "legacy");
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const firstRow = (r: QueryResult): Row => { const row = r.rows[0]; if (!row) throw new Error("query returned no row"); return row; };
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function seed(c: C.Corpus): Promise<void> {
  await admin.query("TRUNCATE articles, situations, saved_articles, official_events RESTART IDENTITY CASCADE");
  for (let o = 0; o < c.articles.length; o += 500) {
    const part = c.articles.slice(o, o + 500), params: unknown[] = [], vals: string[] = [];
    part.forEach((a) => { const b = params.length; params.push(a.id, a.url, a.id, a.source, a.publishedAt, a.scope, a.category, a); vals.push("($" + (b + 1) + ",$" + (b + 2) + ",$" + (b + 3) + ",$" + (b + 4) + ",$" + (b + 5) + ",$" + (b + 6) + ",$" + (b + 7) + ",$" + (b + 8) + ")"); });
    await admin.query("INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload) VALUES " + vals.join(","), params);
  }
  for (const s of c.situations) await admin.query("INSERT INTO situations (id,type,status,verification_status,importance,updated_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)", [s.id, s.type, s.status, s.verificationStatus, s.importance, s.updatedAt, s]);
  for (const o of C.OWNERS) for (const id of c.saved[o] ?? []) await admin.query("INSERT INTO saved_articles (github_login, article_id) VALUES ($1,$2)", [o, id]);
  await admin.query("ANALYZE");
}
const fixtureDigest = async (): Promise<Row> => firstRow(await admin.query("SELECT md5(string_agg(id || payload::text, '' ORDER BY id)) AS a, (SELECT md5(string_agg(github_login||article_id, '' ORDER BY github_login, article_id)) FROM saved_articles) AS s, (SELECT md5(string_agg(id||payload::text, '' ORDER BY id)) FROM situations) AS t, count(*)::int AS n FROM articles"));

function resolve(sc: C.Scenario, exp: Record<string, C.Expected>): C.Filters {
  const f: C.Filters = { ...sc.filters };
  if (f.cursorFrom) { const c = exp[f.cursorFrom]?.nextCursor; if (c !== undefined) f.cursor = c; delete f.cursorFrom; }
  if (f.cursorIsoAt) { const [src, idx] = f.cursorIsoAt; const p = exp[src]?.items?.[idx]?.publishedAt; if (p !== undefined) f.cursor = p; delete f.cursorIsoAt; }
  return f;
}
function oracle(c: C.Corpus, sc: C.Scenario, f: C.Filters): C.Expected {
  try { return sc.kind === "list" ? C.oracleList(c, f, sc.login, fold) : { items: C.oracleSaved(c, sc.login) }; } catch (e) { return { error: errMsg(e) }; }
}
async function actual(sc: C.Scenario, f: C.Filters): Promise<Actual> {
  captured.length = 0; const t0 = performance.now();
  try { const r = sc.kind === "list" ? await store.listArticles(f, sc.login) : { items: await store.listSavedArticles(sc.login) }; return { r, ms: performance.now() - t0, q: captured.slice() }; }
  catch (e) { return { error: errMsg(e), ms: performance.now() - t0, q: captured.slice() }; }
}
// Saved reads have no tie-break in SQL (ORDER BY published_at DESC only): compare per-timestamp groups as sets, record observed order.
function same(sc: C.Scenario, a: Actual, e: C.Expected): Diff | null {
  if (e.error !== undefined || a.error !== undefined || a.r === undefined) return e.error === a.error ? null : { kind: "error", expected: e.error, actual: a.error };
  const ai = a.r.items, ei = e.items;
  if (sc.kind === "saved") {
    const key = (l: C.Article[]): string => l.map((x) => x.publishedAt).join();
    if (key(ai) !== key(ei)) return { kind: "saved-order-by-time", expected: key(ei).slice(0, 300), actual: key(ai).slice(0, 300) };
    const em = new Map(ei.map((x) => [x.id, C.canon(x)]));
    for (const x of ai) if (em.get(x.id) !== C.canon(x)) return { kind: "saved-item", id: x.id, expected: em.get(x.id)?.slice(0, 500), actual: C.canon(x).slice(0, 500) };
    return ai.length === ei.length ? null : { kind: "saved-count", expected: ei.length, actual: ai.length };
  }
  if (ai.length !== ei.length) return { kind: "count", expected: ei.length, actual: ai.length, firstExpected: ei[0]?.id, firstActual: ai[0]?.id };
  for (let i = 0; i < ai.length; i++) if (C.canon(ai[i]) !== C.canon(ei[i])) return { kind: "item", index: i, expected: C.canon(ei[i]).slice(0, 700), actual: C.canon(ai[i]).slice(0, 700) };
  if ((a.r.nextCursor ?? null) !== (e.nextCursor ?? null)) return { kind: "nextCursor", expected: e.nextCursor, actual: a.r.nextCursor };
  return null;
}
function summarizePlan(p: PlanDoc[], qi: number, sha: string): PlanSummary {
  const doc = p[0]; if (!doc) throw new Error("empty EXPLAIN document");
  const nodes: string[] = [], idx = new Set<string>(), rels = new Set<string>();
  (function w(n: PlanNode): void { nodes.push(n["Node Type"]); if (n["Index Name"]) idx.add(n["Index Name"]); if (n["Relation Name"]) rels.add(n["Relation Name"]); (n.Plans || []).forEach(w); })(doc.Plan);
  return { qi, sha, exec: doc["Execution Time"], planning: doc["Planning Time"], jit: !!doc.JIT, rootRows: doc.Plan["Actual Rows"], nodes, indexes: [...idx], relations: [...rels], sharedHit: doc.Plan["Shared Hit Blocks"], sharedRead: doc.Plan["Shared Read Blocks"] };
}
function sizeOf(dir: string): number { let t = 0; if (!existsSync(dir)) return 0; for (const n of readdirSync(dir)) { const p = dir + "/" + n, s = statSync(p); t += s.isDirectory() ? sizeOf(p) : s.size; } return t; }
const sumMs = (q: Cap[]): number => +q.reduce((x, y) => x + y.ms, 0).toFixed(3);
// Normalized output digest: lists compare items+cursor in order; saved reads (no SQL tie-break) compare in (publishedAt desc, id) order.
type Norm = { items: C.Article[]; nextCursor?: string };
const normDigest = (sc: C.Scenario, x: Norm): string => C.sha(C.canon(sc.kind === "list" ? { items: x.items, nextCursor: x.nextCursor ?? null } : { items: [...x.items].sort((p, q) => (p.publishedAt < q.publishedAt ? 1 : p.publishedAt > q.publishedAt ? -1 : p.id < q.id ? -1 : 1)) }));
const outDigest = (sc: C.Scenario, r: { items?: C.Article[]; nextCursor?: string } | undefined, error: string | undefined): string => (error !== undefined || r === undefined || r.items === undefined ? "error:" + error : normDigest(sc, { items: r.items, nextCursor: r.nextCursor }));

if (MODE === "full") {
  const SAMPLES = 5, domains = (process.env.DOMAINS || "1000,10000").split(",").map(Number);
  for (const n of domains) {
    const c = C.buildCorpus(n, shared);
    for (const f of ["results", "actual", "expected", "plans", "corpus", "summary"]) writeFileSync(D + "/" + f + "-" + n + ".jsonl", "");
    c.articles.forEach((a) => wr("corpus-" + n + ".jsonl", a));
    wr("corpus-" + n + ".jsonl", { __situations: c.situations, __saved: Object.fromEntries(C.OWNERS.map((o) => [o, [...(c.saved[o] ?? [])]])) });
    await seed(c);
    const fd = await fixtureDigest();
    const exp: Record<string, C.Expected> = {}, mem = new MemoryStore("legacy"); mem.articles = clone(c.articles);
    const qcat = new Map<string, string>();
    for (const sc of C.SCENARIOS) {
      const f = resolve(sc, exp), e = oracle(c, sc, f); exp[sc.id] = e;
      wr("expected-" + n + ".jsonl", { id: sc.id, filters: f, login: sc.login, expected: e });
      const runs: Actual[] = [];
      for (let s = 0; s < SAMPLES; s++) runs.push(await actual(sc, f));
      const first = runs[0]; if (!first) throw new Error("no sample");
      let diff: Diff | null = same(sc, first, e);
      const qs = first.q;
      wr("actual-" + n + ".jsonl", { id: sc.id, result: first.error !== undefined ? { error: first.error } : first.r });
      for (const a of runs.slice(1)) if (a.error === undefined && a.r !== undefined && first.r !== undefined && C.canon(a.r) !== C.canon(first.r) && sc.kind === "list") diff = diff || { kind: "unstable-between-samples" };
      const samples = runs.map((a) => ({ driverMs: +a.ms.toFixed(3), queryMs: sumMs(a.q) }));
      let parity: Record<string, unknown> | null = null;
      if (sc.kind === "list" && e.error === undefined) {
        try { const m = await mem.listArticles({ ...f }); const mi = m.items.map((x) => x.id), ei = e.items.map((x) => x.id); parity = { sameIds: mi.join() === ei.join(), sameNext: (m.nextCursor ?? null) === (e.nextCursor ?? null), memCount: mi.length, expCount: ei.length }; } catch (x) { parity = { memError: errMsg(x) }; }
      }
      const plans: PlanSummary[] = [];
      for (let qi = 0; qi < qs.length; qi++) {
        const q = qs[qi]; if (!q) continue;
        qcat.set(q.sha, q.text);
        try { const r = await realQuery("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + q.text, q.params); const raw = firstRow(r)["QUERY PLAN"] as PlanDoc[]; wr("plans-" + n + ".jsonl", { id: sc.id, qi, sha: q.sha, raw }); plans.push(summarizePlan(raw, qi, q.sha)); }
        catch (x) { plans.push({ qi, sha: q.sha, explainError: errMsg(x) }); }
      }
      const out = first.error !== undefined || first.r === undefined ? { error: first.error } : { items: first.r.items.length, digest: C.sha(C.canon(first.r)) };
      wr("results-" + n + ".jsonl", { domain: n, id: sc.id, kind: sc.kind, login: sc.login, filters: f, pass: diff === null, diff, out, expectedDigest: C.sha(C.canon(e.error !== undefined ? { error: e.error } : (sc.kind === "list" ? e : { items: e.items }))), queryCount: qs.length, queries: qs.map((q) => ({ sha: q.sha, params: JSON.stringify(q.params).slice(0, 600), rows: q.rows, bytes: q.bytes, ms: +q.ms.toFixed(3) })), composedExplainExecMs: +plans.reduce((x, p) => x + (p.exec || 0), 0).toFixed(3), samples, plans, memoryParity: parity });
    }
    // exhaustive paging checks: every Sport classification and the full keyset order
    const sportIds = new Set<string>(); let cur: string | undefined, pages = 0, qn = 0; const labelFail: string[] = [];
    do { captured.length = 0; const r = await store.listArticles({ category: "Sport", limit: 100, cursor: cur }, "ownerA"); r.items.forEach((x) => sportIds.add(x.id)); cur = r.nextCursor; pages++; qn += captured.length; } while (cur);
    const wantSport = new Set(c.articles.filter((a) => a.category === "Sport" || C.legacySport(a, fold)).map((a) => a.id));
    c.articles.forEach((a, i) => { const k = C.sportCaseIndex(i); const sc = k >= 0 ? C.SPORT_CASES[k] : undefined; if (sc && sportIds.has(a.id) !== sc.sport) labelFail.push(a.id + ":" + k); });
    const sportMiss = [...wantSport].filter((x) => !sportIds.has(x)).concat([...sportIds].filter((x) => !wantSport.has(x)));
    wr("results-" + n + ".jsonl", { domain: n, id: "X01", kind: "sport-exhaustive", pass: sportMiss.length === 0 && labelFail.length === 0, pages, queryCount: qn, sportCount: sportIds.size, expectedCount: wantSport.size, mismatchIds: sportMiss.slice(0, 20), labelFailures: labelFail });
    const all: C.Article[] = []; cur = undefined; pages = 0; qn = 0;
    do { captured.length = 0; const r = await store.listArticles({ limit: 100, cursor: cur }, "ownerA"); all.push(...r.items); cur = r.nextCursor; pages++; qn += captured.length; } while (cur);
    const eAll: C.Article[] = []; let ec: string | undefined; do { const r = C.oracleList(c, { limit: 100, cursor: ec }, "ownerA", fold); eAll.push(...r.items); ec = r.nextCursor; } while (ec);
    const okAll = C.canon(all) === C.canon(eAll);
    wr("results-" + n + ".jsonl", { domain: n, id: "X02", kind: "full-keyset-paging", pass: okAll && all.length === n, pages, queryCount: qn, items: all.length, digest: C.sha(C.canon(all)), expectedDigest: C.sha(C.canon(eAll)) });
    const sizes = (await admin.query("SELECT c.relname, c.relkind, pg_relation_size(c.oid)::bigint AS rel, pg_total_relation_size(c.oid)::bigint AS total FROM pg_class c WHERE c.relname IN ('articles','saved_articles','situations') OR c.relname LIKE 'articles\\_%' OR c.relname LIKE 'saved\\_articles%' OR c.relname LIKE 'situations\\_%' ORDER BY 1")).rows;
    wr("summary-" + n + ".jsonl", { domain: n, corpusDigest: C.sha(C.canon(c.articles)), situationsDigest: C.sha(C.canon(c.situations)), fixtureDigest: fd, sizes, queryCatalog: Object.fromEntries(qcat), dbSize: firstRow(await admin.query("SELECT pg_database_size('fixture_db')::bigint AS b")).b, scratchBytes: sizeOf(TMP) });
  }
} else if (MODE === "seed") {
  const c = C.buildCorpus(Number(env("DOMAIN")), shared); await seed(c);
  console.log(JSON.stringify({ status: "SEEDED", domain: c.articles.length, corpusDigest: C.sha(C.canon(c.articles)), fixtureDigest: await fixtureDigest() }));
} else if (MODE === "oracle") {
  // Frozen independent full-payload oracle: no database, no PgStore. Digests of the literal oracle output per scenario.
  const c = C.buildCorpus(Number(env("DOMAIN")), shared), exp: Record<string, C.Expected> = {}, digests: Record<string, string> = {};
  for (const sc of C.SCENARIOS) { const f = resolve(sc, exp); exp[sc.id] = oracle(c, sc, f); digests[sc.id] = outDigest(sc, exp[sc.id], exp[sc.id]?.error); }
  console.log(JSON.stringify({ domain: c.articles.length, corpusDigest: C.sha(C.canon(c.articles)), digests }));
} else if (MODE === "invoke") {
  const w = JSON.parse(readFileSync(env("WORKLOAD_FILE"), "utf8")) as Workload, n = w.domain;
  const c = C.buildCorpus(n, shared), fd = await fixtureDigest();
  if (C.canon(fd) !== C.canon(JSON.parse(env("EXPECT_FIXTURE_DIGEST")))) { console.log(JSON.stringify({ status: "FIXTURE_MISMATCH", fd })); process.exit(3); }
  const exp: Record<string, C.Expected> = {}, calls: Record<string, unknown>[] = [], fmap = new Map<string, C.Filters>();
  for (const sc of C.SCENARIOS) { const f = resolve(sc, exp); exp[sc.id] = oracle(c, sc, f); fmap.set(sc.id, f); }
  for (let r = 0; r < w.repeats; r++) for (const id of w.scenarios) {
    const sc = C.SCENARIOS.find((x) => x.id === id), f = fmap.get(id), e = exp[id];
    if (!sc || !f || !e) throw new Error("unknown scenario " + id);
    const a = await actual(sc, f);
    calls.push({ id, repeat: r, driverMs: +a.ms.toFixed(3), queryMs: sumMs(a.q), queryCount: a.q.length, rows: a.q.reduce((x, y) => x + y.rows, 0), bytes: a.q.reduce((x, y) => x + y.bytes, 0), pass: same(sc, a, e) === null, digest: outDigest(sc, a.r, a.error), expectedDigest: outDigest(sc, e, e.error) });
  }
  const sc = sizeOf(TMP);
  console.log(JSON.stringify({ status: "OK", terminal: "COMPLETE", src: SRC, rev: process.env.SRC_REV, storeSha256: C.sha(readFileSync(SRC + "/apps/server/src/store.ts", "utf8")), workload: w.id, fixtureDigest: fd, calls, scratchBytes: sc, scratchWithinCap: sc <= 16 * 1024 * 1024 }));
}
await serverPool.end(); await admin.end();
