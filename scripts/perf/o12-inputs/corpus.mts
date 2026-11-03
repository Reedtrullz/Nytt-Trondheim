// Article-only corpus generator, structural validator and LITERAL oracle (Issue81). Pure: no DB, no PgStore. Strict TypeScript, no suppression.
// Deterministic: every value is a function of SEED and the article/situation index. Wall clock is never read.
import { createHash } from "node:crypto";
export const SEED = 20261023;
export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
export const canon = (v: unknown): string => JSON.stringify(v, (_k: string, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, (x as Record<string, unknown>)[q]])) : x));

export type Fold = (s: string) => string;
export type Loc = { lat: number; lng: number; label: string };
export type Verification = { officialSources: string[]; reportingSources: string[]; situationId: string; status: string; label: string; detail: string };
export type Article = {
  id: string; source: string; sourceLabel: string; title: string; excerpt: string; url: string; publishedAt: string; scope: string; category: string; places: string[];
  topics?: string[]; location?: Loc; imageUrl?: string; access?: "paid"; situationId?: string; publicVerification?: Verification; saved?: boolean;
};
export type Evidence = { id: string; situationId: string; source: string; sourceLabel: string; sourceUrl: string; supportingSnippet: string; claim: string; claimType: string; provenance: string; confidence: number; extractedAt: string; publishedAt: string };
export type Situation = {
  id: string; type: string; title: string; summary: string; status: string; publicVisibility?: string; verificationStatus: string; importance: string; updatedAt: string; createdAt: string;
  locationLabel: string; officialSource?: string; officialEventId?: string; relatedArticleIds: string[]; evidence: Evidence[]; features: unknown[]; timeline: unknown[];
};
export type Parser = { safeParse(v: unknown): { success: boolean } };
export type Shared = {
  sourceIdSchema: Parser; articleCategorySchema: Parser; articleTopicSchema: Parser; sourceIdLabel(s: string): string;
  sampleArticles: Record<string, unknown>[]; buildDatabasePoolOptions(role: string): Record<string, unknown>;
};
export type Filters = { scope?: string; category?: string; topic?: string; q?: string; from?: string; to?: string; cursor?: string; limit?: number; cursorFrom?: string; cursorIsoAt?: [string, number] };
export type ListResult = { items: Article[]; nextCursor?: string };
export type Expected = { items: Article[]; nextCursor?: string; error?: undefined } | { items?: undefined; nextCursor?: undefined; error: string };
export type Corpus = { n: number; articles: Article[]; situations: Situation[]; saved: Record<string, Set<string>>; featured: Situation[] };
export type Scenario = { id: string; kind: "list" | "saved"; login: string; filters: Filters };

const pad = (n: number, w: number): string => String(n).padStart(w, "0");
const iso = (ms: number): string => new Date(ms).toISOString();
function mulberry32(seed: number): () => number { let a = seed; return function (): number { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const BASE = Date.UTC(2026, 9, 1, 12, 0, 0);
const CAT20 = ["Nyheter","Hendelser","Krim","Byutvikling","Kultur","Nyheter","Transport","Politikk","Nyheter","Hendelser","Nyheter","Krim","Sport","Nyheter","Transport","Kultur","Sport","Byutvikling","Nyheter","Hendelser"];
const SRCS = ["nrk", "adressa", "avisa_st", "vg", "dagbladet"];
const WORDS = ["havn", "bru", "torg", "tog", "skole"];
const PLACES: string[][] = [["Lade"], ["Midtbyen"], ["Byåsen"], ["Lade", "Singsaker"]];
// Labelled legacy-classifier examples. sport = expected truth under the PgStore SQL predicate (sportCategorySqlPredicate), stated literally here.
export const SPORT_CASES: { t: string; e: string; sport: boolean; why: string }[] = [
  { t: "Rosenborg tapte 2–1 mot Brann", e: "Kampen endte i Bergen.", sport: true, why: "club + tapte/kamp + score" },
  { t: "RANHEIM FOTBALL: ny trener", e: "Klubben presenterte seg.", sport: true, why: "upper case club + fotball" },
  { t: "BYÅSEN HÅNDBALL vant", e: "Profilen scoret.", sport: true, why: "non-ASCII upper case, locale dependent" },
  { t: "Rosenborgveien stengt etter kamp", e: "Trafikk i området.", sport: true, why: "substring club inside street name: SQL positive, word-boundary shared regex negative" },
  { t: "Ranheim åpner ny butikk", e: "Åpning på torsdag.", sport: false, why: "club without sports context" },
  { t: "Kamp om parkering i sentrum", e: "Beboere protesterer.", sport: false, why: "context without club" },
  { t: "Karbkjøp i butikken", e: "Pris 3 kroner.", sport: false, why: "rbk substring only, no context" },
  { t: "Strindheim skole: foreldremøte", e: "Divisjon av klasser.", sport: true, why: "SQL over-match: club + divisjon" },
  { t: "Kolstad vinner 3-1", e: "Ingen annen kontekst.", sport: true, why: "score regex" },
  { t: "Levanger vant kampen", e: "Hjemmekamp i dag.", sport: false, why: "Levanger absent from SQL club list; shared regex would match" },
];
export const sportCaseIndex = (i: number): number => (i % 50 === 7 ? Math.floor(i / 50) % SPORT_CASES.length : -1);
const FILL = (rng: () => number): string => "x".repeat(40 + Math.floor(rng() * 160));
export function genArticles(n: number, sharedLabel: (s: string) => string): Article[] {
  const rng = mulberry32(SEED);
  const rows: Article[] = [];
  for (let i = 0; i < n; i++) {
    const id = "art" + pad(i, 5);
    let category = CAT20[i % 20] as string;
    const source = SRCS[i % 5] as string;
    const scope = i % 3 === 0 ? "trondelag" : "trondheim";
    let title = "Sak " + i + " " + (WORDS[i % 5] as string) + (i % 97 === 0 ? " sjeldenord" : "");
    let excerpt = "Utdrag " + i + " " + FILL(rng) + (i % 1009 === 3 ? " sjeldeneksc" : "");
    const sc = sportCaseIndex(i);
    const spCase = sc >= 0 ? SPORT_CASES[sc] : undefined;
    if (spCase) { category = "Nyheter"; title = spCase.t; excerpt = spCase.e; }
    const payload: Article = { id, source, sourceLabel: sharedLabel(source), title, excerpt, url: "https://example.invalid/a/" + i, publishedAt: iso(BASE - Math.floor(i / 4) * 60000), scope, category, places: PLACES[i % 4] as string[] };
    if (category === "Sport") {
      const m = i % 40;
      if (m === 12) payload.topics = ["rosenborg"];
      if (m === 16) payload.title = "Sak " + i + " RBK hjemme";
      if (m === 32) { payload.topics = []; payload.title = "Sak " + i + " rbk ute"; }
    }
    if ((category === "Transport" && i % 2 === 0) || i % 25 === 3) payload.location = { lat: 63.4 + (i % 10) * 0.001, lng: 10.4 + (i % 7) * 0.001, label: "Midtbyen" };
    if (i % 211 === 5) payload.places = ["Heimdal"];
    if (i % 9 === 0) payload.imageUrl = "https://example.invalid/img/" + i + ".jpg";
    if (i % 17 === 0) payload.access = "paid";
    rows.push(payload);
  }
  return rows;
}
const OLD = "2026-01-01T00:00:00.000Z", FUTURE = "2099-01-01T00:00:00.000Z"; // fixed: neutralises the wall-clock age rule
export function genSituations(n: number): Situation[] {
  const m = n === 1000 ? 10 : 30, out: Situation[] = [];
  for (let j = 0; j < m; j++) {
    const kind = j % 6, id = "sit" + pad(j, 3);
    const related = ["art00001", ...[0, 1, 2].map((d) => "art" + pad(3 * j + d + 2, 5))];
    const ev = (src: string, prov: string, k: number): Evidence => ({ id: id + "-ev" + k, situationId: id, source: src, sourceLabel: src, sourceUrl: "https://example.invalid/ev/" + id + "/" + k, supportingSnippet: "s", claim: "c", claimType: "t", provenance: prov, confidence: 0.8, extractedAt: FUTURE, publishedAt: FUTURE });
    const evidence = kind === 0 ? [ev("datex", "official", 0), ev("nrk", "reporting_estimate", 1), ev("vg", "reporting_estimate", 2), ev("nrk", "reporting_estimate", 3), ev("datex_travel_time", "reporting_estimate", 4)] : [ev("nrk", "reporting_estimate", 0)];
    out.push({ id, type: kind === 0 || kind === 4 ? "traffic" : "fire", title: "Hendelse " + j, summary: "Oppsummering " + j, status: kind === 1 ? "preliminary" : kind === 2 ? "resolved" : "active", ...(kind === 3 ? { publicVisibility: "command_center" } : kind === 5 ? { publicVisibility: "public" } : {}), verificationStatus: kind === 0 ? "Offentlig bekreftet" : "Foreløpig fra rapportering", importance: "normal", updatedAt: iso(Date.UTC(2026, 9, 2, 0, 0, 0) - j * 3600000), createdAt: kind === 4 || kind === 5 ? OLD : FUTURE, locationLabel: "Midtbyen", ...(kind === 0 ? { officialSource: "datex", officialEventId: "ev" + j } : {}), relatedArticleIds: related, evidence, features: [], timeline: [] });
  }
  return out;
}
export const OWNERS = ["ownerA", "ownerB", "ownerC", "ownerX"];
export const savedBy = (owner: string, i: number): boolean => (owner === "ownerA" ? i % 7 === 0 : owner === "ownerB" ? i % 11 === 0 : owner === "ownerX" ? i % 2 === 0 : false);
// ---- structural validation: no Article zod schema exists in the source, so validate the full Article type + enum membership ----
const ALLOWED = new Set(["id","source","sourceLabel","title","excerpt","url","publishedAt","scope","category","topics","places","location","saved","situationId","imageUrl","access","coverageBundle","publicVerification"]);
const REQUIRED = ["id","source","sourceLabel","title","excerpt","url","publishedAt","scope","category","places"];
export function validateArticle(a: Record<string, unknown>, shared: Shared): string[] {
  const err: string[] = [];
  for (const k of REQUIRED) if (!(k in a)) err.push("missing " + k);
  for (const k of Object.keys(a)) if (!ALLOWED.has(k)) err.push("unknown " + k);
  if ("saved" in a) err.push("saved must not be stored");
  for (const k of ["id","sourceLabel","title","excerpt","url"]) if (typeof a[k] !== "string" || !a[k]) err.push("string " + k);
  if (!shared.sourceIdSchema.safeParse(a.source).success) err.push("source enum");
  if (!shared.articleCategorySchema.safeParse(a.category).success) err.push("category enum");
  if (a.scope !== "trondheim" && a.scope !== "trondelag") err.push("scope enum");
  const pub = a.publishedAt;
  if (typeof pub !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(pub) || Number.isNaN(Date.parse(pub))) err.push("publishedAt");
  if (!Array.isArray(a.places) || a.places.some((p: unknown) => typeof p !== "string")) err.push("places");
  if (a.topics !== undefined && !(Array.isArray(a.topics) && a.topics.every((t: unknown) => shared.articleTopicSchema.safeParse(t).success))) err.push("topics");
  if (a.location !== undefined) {
    const l = a.location as Record<string, unknown>;
    if (!(l !== null && typeof l === "object" && Number.isFinite(l.lat) && Number.isFinite(l.lng) && typeof l.label === "string" && Object.keys(l).length === 3)) err.push("location");
  }
  if (a.access !== undefined && a.access !== "paid") err.push("access");
  if (a.imageUrl !== undefined && typeof a.imageUrl !== "string") err.push("imageUrl");
  return err;
}
// ---- literal oracle (independent re-statement of the documented PgStore semantics; not a call into the source) ----
export function makeFold(asciiOnly: boolean): Fold { return asciiOnly ? (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase()) : (s) => s.toLowerCase(); }
const reEsc = (c: string): string => c.replace(/[.*+?^$|()[\]\\{}]/g, "\\$&");
export function ilike(value: string, pattern: string, fold: Fold): boolean {
  const p = fold(pattern); let re = "";
  for (let k = 0; k < p.length; k++) {
    const c = p.charAt(k);
    if (c === "\\") { k++; if (k >= p.length) throw new Error("LIKE pattern must not end with escape character"); re += reEsc(p.charAt(k)); }
    else if (c === "%") re += "[\\s\\S]*"; else if (c === "_") re += "[\\s\\S]"; else re += reEsc(c);
  }
  return new RegExp("^" + re + "$", "u").test(fold(value));
}
const CLUBS = ["ranheim","rosenborg","rbk","kolstad","byåsen","nardo","strindheim"];
const CTX = ["bortesmell","bortekompleks","bortetap","divisjon","fotball","håndball","kamp","profil","tapte"];
export function legacySport(a: Article, fold: Fold): boolean {
  const fields = [a.title, a.excerpt].map(fold);
  return a.category === "Nyheter" && CLUBS.some((c) => fields.some((f) => f.includes(c))) && (CTX.some((c) => fields.some((f) => f.includes(c))) || [a.title, a.excerpt].some((f) => /\d+\s*[–-]\s*\d+/i.test(f)));
}
export const encodeCursor = (ts: string, id: string): string => Buffer.from(JSON.stringify([ts, id]), "utf8").toString("base64url");
function decodeCursorLiteral(c: string): { ts: number; id?: string } {
  if (!Number.isNaN(Date.parse(c))) return { ts: Date.parse(c) };
  try { const p: unknown = JSON.parse(Buffer.from(c, "base64url").toString("utf8")); if (Array.isArray(p) && typeof p[0] === "string" && !Number.isNaN(Date.parse(p[0])) && typeof p[1] === "string") return { ts: Date.parse(p[0]), id: p[1] }; } catch { /* fall through to the documented error */ }
  throw new Error("Ugyldig sidepeker.");
}
const newsroom = new Set(["nrk","adressa","avisa_st","vg","dagbladet"]);
const LAB: Record<string, string> = { datex: "Statens vegvesen DATEX", nrk: "NRK", vg: "VG" }; // literal labels for the sources the corpus uses
const verificationFor = (s: Situation): Verification | undefined => {
  if (!(s.officialSource === "datex" || s.officialSource === "politiloggen") || s.verificationStatus !== "Offentlig bekreftet") return undefined;
  const official = s.officialSource;
  if (!s.evidence.some((e) => e.source === official && e.provenance === "official")) return undefined;
  const rep = [...new Set(s.evidence.filter((e) => e.provenance === "reporting_estimate" && newsroom.has(e.source)).map((e) => e.source))];
  return rep.length ? { officialSources: [official], reportingSources: rep, situationId: s.id, status: "verified", label: "Verifisert", detail: "Bekreftet av " + LAB[official] + " og " + rep.map((r) => LAB[r]).join(", ") + "." } : undefined;
};
// Effective featured situation per article: public, preliminary|active, not (older than 7 days AND traffic/nature type); newest updatedAt first.
export function featuredSituations(situations: Situation[]): Situation[] {
  return situations.filter((s) => (s.publicVisibility ?? "public") === "public" && (s.status === "active" || s.status === "preliminary") && !(s.createdAt === OLD && (s.type === "traffic" || s.type === "landslide" || s.type === "weather"))).sort((l, r) => r.updatedAt.localeCompare(l.updatedAt));
}
export function oracleList(c: Corpus, f: Filters, login: string, fold: Fold): ListResult {
  const fx = c.featured, cur = f.cursor ? decodeCursorLiteral(f.cursor) : null;
  const sportOk = (a: Article): boolean => a.category === "Sport" || legacySport(a, fold);
  const hit = c.articles.filter((a) => {
    if (f.scope && a.scope !== f.scope) return false;
    if (f.category && f.category !== "Alle" && !(f.category === "Sport" ? sportOk(a) : a.category === f.category)) return false;
    if (f.topic === "rosenborg") {
      const t = !!(a.topics && a.topics.includes("rosenborg"));
      const legacy = !("topics" in a) && sportOk(a) && ["rosenborg", "rbk"].some((w) => fold(a.title).includes(w) || fold(a.excerpt).includes(w));
      if (!(t || legacy)) return false;
    }
    if (f.q) {
      const pat = "%" + f.q + "%";
      if (![a.title, a.excerpt, a.sourceLabel, a.category].some((v) => ilike(v, pat, fold)) && !a.places.some((p) => ilike(p, pat, fold))) return false;
    }
    const t = Date.parse(a.publishedAt);
    if (f.from && t < Date.parse(f.from)) return false;
    if (f.to && t > Date.parse(f.to)) return false;
    if (cur && !(t < cur.ts || (cur.id !== undefined && t === cur.ts && a.id < cur.id))) return false;
    return true;
  }).sort((l, r) => (Date.parse(r.publishedAt) - Date.parse(l.publishedAt)) || (l.id < r.id ? 1 : l.id > r.id ? -1 : 0));
  const limit = f.limit ?? 40, page = hit.slice(0, limit), ids = new Set(page.map((a) => a.id));
  const items = page.map((a) => {
    const s = fx.find((x) => x.relatedArticleIds.some((r) => r === a.id && ids.has(r)));
    const o: Article = { ...a };
    if (s) { o.situationId = a.situationId ?? s.id; const v = verificationFor(s); if (v) o.publicVerification = { ...v }; }
    o.saved = c.saved[login]?.has(a.id) ?? false;
    return o;
  });
  const last = items[items.length - 1];
  return { items, nextCursor: hit.length > limit && last ? encodeCursor(last.publishedAt, last.id) : undefined };
}
export function oracleSaved(c: Corpus, login: string): Article[] {
  return c.articles.filter((a) => c.saved[login]?.has(a.id)).sort((l, r) => Date.parse(r.publishedAt) - Date.parse(l.publishedAt)).map((a) => ({ ...a, saved: true }));
}
export function buildCorpus(n: number, shared: Shared): Corpus {
  const articles = genArticles(n, shared.sourceIdLabel), situations = genSituations(n);
  const saved = Object.fromEntries(OWNERS.map((o) => [o, new Set(articles.filter((_, i) => savedBy(o, i)).map((a) => a.id))]));
  return { n, articles, situations, saved, featured: featuredSituations(situations) };
}
// ---- scenario catalogue (identical for both domains; ids and filters are frozen data) ----
const RAW: [string, "list" | "saved", string, Filters][] = [
  ["A01","list","ownerA",{limit:40}],["A02","list","ownerA",{limit:40,cursorFrom:"A01"}],["A03","list","ownerA",{limit:20,cursorIsoAt:[ "A01", 39 ]}],
  ["A04","list","ownerB",{limit:100}],["A05","list","ownerC",{limit:40}],["A06","list","ownerA",{scope:"trondelag",limit:40}],
  ["A07","list","ownerA",{category:"Nyheter",limit:40}],["A08","list","ownerB",{category:"Kultur",scope:"trondheim",limit:25}],
  ["A09","list","ownerA",{category:"Sport",limit:30}],["A10","list","ownerA",{category:"Sport",limit:30,cursorFrom:"A09"}],
  ["A11","list","ownerA",{category:"Vær",limit:40}],["A12","list","ownerA",{category:"Transport",limit:40}],["A13","list","ownerA",{topic:"rosenborg",limit:100}],
  ["A14","list","ownerA",{q:"sjeldenord",limit:40}],["A15","list","ownerA",{q:"zzzzqx",limit:40}],["A16","list","ownerA",{q:"sak",limit:40}],["A17","list","ownerA",{q:"SAK",limit:40}],
  ["A18","list","ownerA",{q:"Midtbyen",limit:40}],["A19","list","ownerA",{q:"nyheter",limit:40}],["A20","list","ownerA",{q:"NRK",limit:40}],
  ["A21","list","ownerA",{q:"sjelden_rd",limit:40}],["A22","list","ownerA",{q:"sjeldenor",limit:40}],["A23","list","ownerA",{q:"sjeldenordd",limit:40}],
  ["A24","list","ownerA",{q:"%",limit:40}],["A25","list","ownerA",{q:"sak\\",limit:40}],["A26","list","ownerA",{q:"sjeldeneksc",limit:40}],
  ["A27","list","ownerA",{scope:"trondheim",category:"Nyheter",q:"havn",from:"2026-09-28T00:00:00.000Z",to:"2026-10-01T11:00:00.000Z",limit:20}],
  ["A28","list","ownerA",{scope:"trondheim",category:"Nyheter",q:"havn",from:"2026-09-28T00:00:00.000Z",to:"2026-10-01T11:00:00.000Z",limit:20,cursorFrom:"A27"}],
  ["A29","list","ownerA",{from:"2000-01-01T00:00:00.000Z",to:"2000-01-02T00:00:00.000Z",limit:40}],
  ["A30","list","ownerA",{category:"Sport",q:"rosenborg",limit:40}],["A31","list","ownerA",{topic:"rosenborg",q:"rbk",limit:40}],
  ["A32","list","ownerA",{cursor:"bogus-cursor",limit:40}],["A33","list","ownerA",{limit:1}],
  ["A34","list","ownerA",{category:"Sport",q:"BYÅSEN",limit:40}],["A35","list","ownerB",{q:"Heimdal",limit:40}],
  ["B01","saved","ownerA",{}],["B02","saved","ownerB",{}],["B03","saved","ownerC",{}],
];
export const SCENARIOS: Scenario[] = RAW.map(([id, kind, login, filters]) => ({ id, kind, login, filters }));
