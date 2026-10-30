import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { PublicTransportServiceAlert, PublicTransportVehicle } from "@nytt/shared";
import { createApp } from "../apps/server/src/app.js";

// O12/U6: real createApp + email-login auth + loopback HTTP over PgStore on the fixture_reader role.
// The app pool is pinned to one connection so connection-local TEMP tables stay visible to it.
type Bounds = { west: number; south: number; east: number; north: number };
type Plan = { "Node Type": string; "Relation Name"?: string; Plans?: Plan[] };
type VehicleRow = {
  id: string;
  mode: string;
  ms: number;
  seenMs: number;
  expMs: number | null;
  stale: boolean;
  included: boolean;
  lon: number;
  lat: number;
  payload: PublicTransportVehicle;
};
type AlertRow = {
  id: string;
  ms: number;
  state: PublicTransportServiceAlert["state"];
  fromMs: number | null;
  toMs: number | null;
  live: boolean;
  lon: number | null;
  lat: number | null;
  payload: PublicTransportServiceAlert;
};

export const O12_ACCEPTANCE_CASES = 58;
const base = Date.parse("2026-07-01T12:00:00.000Z");
const MODES = ["bus", "tram", "rail", "water"] as const;
const sourceRows = [
  ["entur_vehicle_positions", "Entur kjøretøy"],
  ["entur_service_alerts", "Entur avvik"],
  ["nrk", "NRK"],
] as const;
const expectedSources = [
  ["entur_service_alerts", "Entur avvik"],
  ["entur_vehicle_positions", "Entur kjøretøy"],
].map(([source, label]) => ({
  source,
  label,
  state: "ok",
  lastCheckedAt: null,
  lastFailureAt: null,
  nextPollAt: null,
  detail: "Forfatterstyrt",
}));

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dataset(n: number, shape: "dense" | "sparse", seed: number) {
  const rng = mulberry32(seed);
  const dense = shape === "dense";
  const pts = Array.from({ length: n }, () =>
    dense
      ? { lon: 10 + Math.floor(rng() * 512) / 1024, lat: 63.25 + Math.floor(rng() * 256) / 1024 }
      : { lon: 4 + Math.floor(rng() * 4096) / 128, lat: 58 + Math.floor(rng() * 1792) / 128 },
  );
  const narrow: Bounds = dense
    ? { west: 10.125, south: 63.375, east: 10.25, north: 63.4375 }
    : { west: 9.5, south: 63, east: 11.5, north: 64 };
  const wide: Bounds = dense
    ? { west: 9.9, south: 63.2, east: 10.6, north: 63.55 }
    : { west: 3, south: 57, east: 38, north: 73 };
  const step = dense ? 1 / 1024 : 1 / 128;
  pts[1] = { lon: narrow.west, lat: narrow.south };
  pts[2] = { lon: narrow.east, lat: narrow.north };
  pts[3] = { lon: narrow.west - step, lat: narrow.south };
  const edge: Bounds = { west: pts[1].lon, south: pts[1].lat, east: pts[1].lon, north: pts[1].lat };
  const empty: Bounds = { west: -10, south: 40, east: -9, north: 41 };
  const vehicles: VehicleRow[] = pts.map((p, i) => {
    const id = `veh${String(i).padStart(5, "0")}`;
    const cls = i % 10;
    const mode = MODES[i % 4];
    const ms = base - i * 1000;
    return {
      id,
      mode,
      ms,
      seenMs: cls === 8 ? 450000 : 60000,
      expMs: cls === 9 ? -300000 : cls < 7 && i % 2 === 0 ? 300000 : null,
      stale: cls === 7,
      included: cls <= 6,
      lon: p.lon,
      lat: p.lat,
      payload: {
        id,
        source: "entur_vehicle_positions",
        codespaceId: "ATB",
        vehicleId: id,
        mode,
        lastUpdated: new Date(ms).toISOString(),
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        stale: false,
      },
    };
  });
  const alerts: AlertRow[] = pts.map((p, i) => {
    const id = `sal${String(i).padStart(5, "0")}`;
    const cls = i % 10;
    const ms = base - i * 10000;
    const state = cls === 7 ? "expired" : cls === 8 ? "cancelled" : "active";
    const nullGeometry = cls === 4 || cls === 9;
    return {
      id,
      ms,
      state,
      fromMs: cls === 6 ? 3600000 : i % 2 === 0 ? -3600000 : null,
      toMs: cls === 5 ? -3600000 : i % 3 === 0 ? 3600000 : null,
      live: cls !== 5 && cls !== 6,
      lon: nullGeometry ? null : p.lon,
      lat: nullGeometry ? null : p.lat,
      payload: {
        id,
        source: "entur_service_alerts",
        codespaceId: "ATB",
        situationNumber: id,
        state,
        summary: `Avvik ${id}`,
        updatedAt: new Date(ms).toISOString(),
      },
    };
  });
  return { bounds: { wide, narrow, edge, empty }, vehicles, alerts };
}
type Dataset = ReturnType<typeof dataset>;

const inBounds = (lon: number, lat: number, b: Bounds) =>
  lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function expectVehicles(d: Dataset, b: Bounds, limit: number | null, mode?: string) {
  const rows = d.vehicles
    .filter((r) => r.included && inBounds(r.lon, r.lat, b) && (!mode || r.mode === mode))
    .sort((x, y) => y.ms - x.ms || byId(x.id, y.id));
  return rows.slice(0, limit ?? undefined).map((r) => ({ ...r.payload, stale: r.stale }));
}
function expectAlerts(
  d: Dataset,
  b: Bounds,
  limit: number | null,
  states: PublicTransportServiceAlert["state"][] = ["active"],
) {
  const rows = d.alerts
    .filter(
      (r) =>
        r.live &&
        states.includes(r.state) &&
        (r.lon === null || r.lat === null || inBounds(r.lon, r.lat, b)),
    )
    .sort((x, y) => y.ms - x.ms || byId(x.id, y.id));
  return rows.slice(0, limit ?? undefined);
}
const digest = (rows: Array<{ id: string }>) =>
  createHash("sha256").update(rows.map((r) => r.id).join("\n")).digest("hex").slice(0, 16);
const query = (b: Bounds) => `north=${b.north}&south=${b.south}&east=${b.east}&west=${b.west}`;

function planNodes(plan: Plan): Plan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)];
}

export async function runO12Acceptance(databaseUrl: string) {
  Object.assign(process.env, {
    NYTT_DB_POOL_MAX: "1",
    NYTT_DB_IDLE_TIMEOUT_MS: "3600000",
    NYTT_DB_MAX_LIFETIME_SECONDS: "3600",
    NYTT_DB_CONNECTION_TIMEOUT_MS: "30000",
  });
  const results: Array<{ id: string; passed: boolean; detail?: string }> = [];
  const accept = async (id: string, operation: () => Promise<string | void>) => {
    try {
      const detail = await operation();
      results.push({ id, passed: true, ...(detail ? { detail } : {}) });
    } catch (error) {
      results.push({
        id,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-o12-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    databaseUrl,
    seedDemo: false,
    devAuthBypass: false,
    githubClientId: "offline-fixture",
    githubClientSecret: "offline-fixture",
    githubAllowedLogin: "fixture-owner",
    sessionSecret: "authored-fixture-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: false,
    emailSender: { async send() {} },
  });
  const pool = runtime.pool;
  assert(pool, "createApp must use the PgStore pool");
  const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  Object.assign(pool, {
    query: (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("FROM public_transport_")) {
        captured.push({ sql: args[0], params: (args[1] as unknown[] | undefined) ?? [] });
      }
      return originalQuery(...args);
    },
  });
  const server = http.createServer(runtime.app);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await originalQuery("SET statement_timeout = '15s'");
    const schema = readFileSync(
      new URL("../apps/server/src/db/schema.sql", import.meta.url),
      "utf8",
    );
    for (const [from, to] of [
      ["CREATE TABLE IF NOT EXISTS public_transport_vehicles (", "CREATE TABLE IF NOT EXISTS collector_state ("],
      ["CREATE TABLE IF NOT EXISTS access_requests (", "CREATE TABLE IF NOT EXISTS coverage_bundle_corrections ("],
      ["CREATE TABLE IF NOT EXISTS user_identities (", "CREATE TABLE IF NOT EXISTS push_subscriptions ("],
      ['CREATE TABLE IF NOT EXISTS "session" (', "INSERT INTO schema_migrations (version) VALUES ('001"],
    ] as const) {
      const start = schema.indexOf(from);
      const end = schema.indexOf(to, start + from.length);
      assert(start >= 0 && end > start, `schema section ${from}`);
      await originalQuery(
        schema.slice(start, end).replaceAll("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE"),
      );
    }
    for (const [source, label] of sourceRows) {
      await originalQuery(
        "INSERT INTO source_health (source,label,state,detail) VALUES ($1,$2,'ok','Forfatterstyrt')",
        [source, label],
      );
    }

    const cookies = new Map<string, string>();
    const remember = (response: Response) => {
      for (const header of response.headers.getSetCookie()) {
        const [pair = ""] = header.split(";");
        const split = pair.indexOf("=");
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
    };
    const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const send = async (target: string, init: RequestInit = {}, withCookie = true) => {
      const response = await fetch(baseUrl + target, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        ...init,
        headers: { ...(withCookie && cookies.size ? { cookie: cookieHeader() } : {}), ...init.headers },
      });
      remember(response);
      return { response, text: await response.text() };
    };
    const api = (target: string, withCookie = true) => send(target, {}, withCookie);

    await accept("reader-role", async () => {
      const identity = await originalQuery(
        "SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser",
      );
      const row = (identity as unknown as { rows: Array<{ current_user: string; superuser: boolean }> })
        .rows[0];
      assert.equal(row?.current_user, "fixture_reader");
      assert.equal(row?.superuser, false);
    });

    await accept("email-login", async () => {
      const grant = await runtime.store.grantUserAccess(
        { displayName: "Fixture Viewer", email: "fixture-viewer@example.test" },
        "owner",
      );
      const token = grant.invite.token;
      const form = await send(`/auth/email/callback?token=${encodeURIComponent(token)}`);
      assert.equal(form.response.status, 200);
      const csrf = form.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
      assert(csrf);
      const login = await send("/auth/email/callback", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, _csrf: csrf }),
      });
      assert.equal(login.response.status, 302);
      assert.equal(login.response.headers.get("location"), "/");
      const session = await api("/api/session");
      assert.equal(session.response.status, 200);
      const user = (JSON.parse(session.text) as { user: { role: string; status: string } }).user;
      assert.deepEqual([user.role, user.status], ["viewer", "active"]);
    });

    const unauthorized = {
      error: "Innlogging kreves.",
      loginUrl: "/logg-inn",
    };
    await accept("unauthorized", async () => {
      const wide = query(dataset(1000, "dense", 1).bounds.wide);
      const anonymous = await send(`/api/map/public-transport?${wide}`, {}, false);
      assert.equal(anonymous.response.status, 401);
      assert.deepEqual(JSON.parse(anonymous.text), unauthorized);
      const forged = await send(`/api/map/public-transport?${wide}`, {
        headers: { cookie: "nytt.sid=s%3Aforged.invalid" },
      }, false);
      assert.equal(forged.response.status, 401);
      assert.deepEqual(JSON.parse(forged.text), unauthorized);
    });

    const validBounds = "north=63.5&south=63.3&east=10.5&west=10.2";
    for (const [id, target, path] of [
      ["malformed-partial-bounds", "north=63", "bounds"],
      ["malformed-inverted-bounds", "north=63.1&south=63.3&east=10.5&west=10.2", "north"],
      ["malformed-mode", `modes=ferry&${validBounds}`, "modes"],
    ] as const) {
      await accept(id, async () => {
        const bad = await api(`/api/map/public-transport?${target}`);
        assert.equal(bad.response.status, 400);
        const body = JSON.parse(bad.text) as { error: string; details: Array<{ path: string }> };
        assert.equal(body.error, "Ugyldig forespørsel.");
        assert(body.details.some((detail) => detail.path.startsWith(path)), bad.text);
      });
    }

    const insert = async (d: Dataset) => {
      await originalQuery("DELETE FROM public_transport_vehicles");
      await originalQuery("DELETE FROM public_transport_service_alerts");
      await originalQuery(
        `INSERT INTO public_transport_vehicles
         (id,source,codespace_id,vehicle_id,mode,last_updated,expires_at,geometry,payload,payload_hash,last_seen_at,stale)
         SELECT id,'entur_vehicle_positions','ATB',id,mode,lu::timestamptz,
                now()+exp*interval '1 millisecond',ST_SetSRID(ST_MakePoint(lon,lat),4326),
                payload::jsonb,id,now()-seen*interval '1 millisecond',stale
         FROM unnest($1::text[],$2::text[],$3::text[],$4::float8[],$5::float8[],$6::text[],$7::int[],$8::int[],$9::boolean[])
              AS t(id,mode,lu,lon,lat,payload,seen,exp,stale)`,
        [
          d.vehicles.map((r) => r.id),
          d.vehicles.map((r) => r.mode),
          d.vehicles.map((r) => r.payload.lastUpdated),
          d.vehicles.map((r) => r.lon),
          d.vehicles.map((r) => r.lat),
          d.vehicles.map((r) => JSON.stringify(r.payload)),
          d.vehicles.map((r) => r.seenMs),
          d.vehicles.map((r) => r.expMs),
          d.vehicles.map((r) => r.stale),
        ],
      );
      await originalQuery(
        `INSERT INTO public_transport_service_alerts
         (id,source,codespace_id,situation_number,state,summary,valid_from,valid_to,updated_at,geometry,payload,payload_hash,last_seen_at)
         SELECT id,'entur_service_alerts','ATB',id,state,'Avvik '||id,
                now()+vf*interval '1 millisecond',now()+vt*interval '1 millisecond',ua::timestamptz,
                CASE WHEN lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lon,lat),4326) END,
                payload::jsonb,id,now()
         FROM unnest($1::text[],$2::text[],$3::text[],$4::int[],$5::int[],$6::float8[],$7::float8[],$8::text[])
              AS t(id,state,ua,vf,vt,lon,lat,payload)`,
        [
          d.alerts.map((r) => r.id),
          d.alerts.map((r) => r.state),
          d.alerts.map((r) => r.payload.updatedAt),
          d.alerts.map((r) => r.fromMs),
          d.alerts.map((r) => r.toMs),
          d.alerts.map((r) => r.lon),
          d.alerts.map((r) => r.lat),
          d.alerts.map((r) => JSON.stringify(r.payload)),
        ],
      );
    };

    let seed = 20261030;
    for (const [shape, n] of [["dense", 1000], ["sparse", 1000], ["dense", 10000], ["sparse", 10000]] as const) {
      const tag = `${shape}-${n / 1000}k`;
      const d = dataset(n, shape, seed++);
      await insert(d);
      const b = d.bounds;
      const http = async (
        id: string,
        bounds: Bounds,
        extra: string,
        mode: string | undefined,
        alerts: boolean,
        expectRows: boolean,
      ) =>
        accept(`${tag}-http-${id}`, async () => {
          captured.length = 0;
          const res = await api(`/api/map/public-transport?${query(bounds)}${extra}`);
          assert.equal(res.response.status, 200);
          assert.match(res.response.headers.get("content-type") ?? "", /^application\/json/);
          const body = JSON.parse(res.text) as {
            vehicles: PublicTransportVehicle[];
            alerts: PublicTransportServiceAlert[];
            sources: unknown[];
            generatedAt: string;
          };
          assert.deepEqual(Object.keys(body).sort(), ["alerts", "generatedAt", "sources", "vehicles"]);
          assert(!Number.isNaN(Date.parse(body.generatedAt)));
          const vehicles = expectVehicles(d, bounds, 1000, mode);
          const alertRows = alerts ? expectAlerts(d, bounds, 500).map((r) => r.payload) : [];
          if (expectRows) assert(vehicles.length > 0 && (!alerts || alertRows.length > 0));
          assert.deepEqual(body.vehicles, vehicles);
          assert.deepEqual(body.alerts, alertRows);
          assert.deepEqual(body.sources, expectedSources);
          assert.equal(digest(body.vehicles), digest(vehicles));
          return `v=${vehicles.length}:${digest(vehicles)} a=${alertRows.length}:${digest(alertRows)}`;
        });
      await http("wide", b.wide, "", undefined, true, true);
      await http("narrow", b.narrow, "", undefined, true, true);
      await http("edge-point", b.edge, "", undefined, true, true);
      await http("empty-bounds", b.empty, "", undefined, true, false);
      await http("wide-bus", b.wide, "&modes=bus", "bus", true, true);
      await http("wide-no-alerts", b.wide, "&includeAlerts=false", undefined, false, true);

      const direct = async (id: string, operation: () => Promise<string>) =>
        accept(`${tag}-store-${id}`, operation);
      await direct("vehicles-limit-100", async () => {
        const rows = await runtime.store.listPublicTransportVehicles({ bounds: b.wide, limit: 100 });
        assert.deepEqual(rows, expectVehicles(d, b.wide, 100));
        return `v=${rows.length}:${digest(rows)}`;
      });
      await direct("vehicles-limit-null", async () => {
        const rows = await runtime.store.listPublicTransportVehicles({ bounds: b.wide, limit: null });
        assert.deepEqual(rows, expectVehicles(d, b.wide, null));
        assert(rows.length > 1000);
        return `v=${rows.length}:${digest(rows)}`;
      });
      await direct("vehicles-edge-point", async () => {
        const rows = await runtime.store.listPublicTransportVehicles({ bounds: b.edge, limit: 200 });
        assert.deepEqual(rows, expectVehicles(d, b.edge, 200));
        assert(rows.length > 0);
        return `v=${rows.length}:${digest(rows)}`;
      });
      await direct("alerts-all-states-limit-200", async () => {
        const states = ["active", "expired", "cancelled"] as const;
        const rows = await runtime.store.listPublicTransportServiceAlerts({
          bounds: b.wide,
          states: [...states],
          limit: 200,
        });
        assert.deepEqual(rows, expectAlerts(d, b.wide, 200, [...states]).map((r) => r.payload));
        return `a=${rows.length}:${digest(rows)}`;
      });
      await direct("alerts-limit-null", async () => {
        const rows = await runtime.store.listPublicTransportServiceAlerts({ bounds: b.wide, limit: null });
        assert.deepEqual(rows, expectAlerts(d, b.wide, null).map((r) => r.payload));
        assert(rows.length > 500);
        return `a=${rows.length}:${digest(rows)}`;
      });

      // Plan of the exact SQL the HTTP request ran, under the same role and connection.
      for (const [id, table] of [
        ["vehicles", "public_transport_vehicles"],
        ["alerts", "public_transport_service_alerts"],
      ] as const) {
        await accept(`${tag}-explain-${id}`, async () => {
          captured.length = 0;
          assert.equal((await api(`/api/map/public-transport?${query(b.wide)}`)).response.status, 200);
          const sql = captured.find((entry) => entry.sql.includes(`FROM ${table}`));
          assert(sql, "HTTP request did not reach the PgStore query");
          const explain = (await originalQuery(`EXPLAIN (FORMAT JSON) ${sql.sql}`, sql.params)) as unknown as {
            rows: Array<{ "QUERY PLAN": Array<{ Plan: Plan }> }>;
          };
          const root = explain.rows[0]?.["QUERY PLAN"][0]?.Plan;
          assert(root);
          const nodes = planNodes(root);
          assert.equal(root["Node Type"], "Limit");
          assert(nodes.some((node) => node["Relation Name"] === table));
          return nodes.map((node) => node["Node Type"]).join(">");
        });
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await originalQuery("SELECT 1").catch(() => undefined);
    await pool.end();
  }
  return { results, failures: results.filter((row) => !row.passed).map((row) => row.id) };
}
