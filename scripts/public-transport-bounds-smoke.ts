import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  publicTransportMapQuerySchema,
  type PublicTransportVehicle,
  type PublicTransportServiceAlert,
} from "@nytt/shared";
import { PgStore } from "../apps/server/src/store.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const store = new PgStore(pool);
const results: Array<{ id: string; passed: boolean; detail?: string }> = [];
async function check(id: string, operation: () => unknown | Promise<unknown>) {
  try {
    await operation();
    results.push({ id, passed: true });
  } catch (error) {
    results.push({
      id,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const vehicle = (
  id: string,
  mode: PublicTransportVehicle["mode"] = "water",
): PublicTransportVehicle => ({
  id,
  source: "entur_vehicle_positions",
  codespaceId: "ATB",
  vehicleId: id,
  mode,
  lineRef: "ATB:Line:fixture",
  lineName: "Forfatterstyrt rute",
  operatorName: "Testoperatør",
  lastUpdated: "2026-07-01T12:00:00.000Z",
  geometry: { type: "Point", coordinates: [10, 63] },
  originName: "Start",
  destinationName: "Mål",
  speedMps: 0,
  monitored: true,
  stale: false,
});
const alert = (
  id: string,
  state: PublicTransportServiceAlert["state"] = "active",
): PublicTransportServiceAlert => ({
  id,
  source: "entur_service_alerts",
  codespaceId: "ATB",
  situationNumber: id,
  summary: "Sanitert avvik",
  description: "Forfatterstyrt, ingen leverandørkall",
  state,
  updatedAt: "2026-07-01T12:00:00.000Z",
  version: 7,
  affectedLineRefs: ["ATB:Line:fixture"],
  infoLinks: [{ uri: "https://example.test/transport", label: "Kilde" }],
});
const a = vehicle("a"),
  b = vehicle("b"),
  bus = vehicle("bus", "bus");
const aa = alert("a"),
  nullable = alert("b"),
  cancelled = alert("cancelled", "cancelled");
const rectangle = { west: 9.5, south: 62.5, east: 10.5, north: 63.5 };
const point = { west: 10, south: 63, east: 10, north: 63 };
const vertical = { ...rectangle, west: 10, east: 10 };
const horizontal = { ...rectangle, south: 63, north: 63 };

try {
  await pool.query("BEGIN");
  await pool.query("SET LOCAL statement_timeout = '5s'");
  const identity = await pool.query<{ current_user: string; superuser: boolean }>(
    "SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser",
  );
  assert.equal(identity.rows[0]?.superuser, false);
  // Use the current schema's exact table definitions in connection-local temporary tables.
  const schema = readFileSync(new URL("../apps/server/src/db/schema.sql", import.meta.url), "utf8");
  const start = schema.indexOf("CREATE TABLE IF NOT EXISTS public_transport_vehicles (");
  const end = schema.indexOf("CREATE TABLE IF NOT EXISTS source_health (", start);
  assert(start >= 0 && end > start);
  await pool.query(
    schema.slice(start, end).replaceAll("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE"),
  );
  for (const [payload, freshness] of [
    [a, "fresh"],
    [b, "fresh"],
    [bus, "fresh"],
    [vehicle("stale"), "stale"],
    [vehicle("expired"), "expired"],
    [vehicle("old"), "old"],
    [{ ...vehicle("outside"), geometry: { type: "Point", coordinates: [11, 64] } }, "fresh"],
  ] as const) {
    await pool.query(
      `INSERT INTO public_transport_vehicles
       (id,source,codespace_id,vehicle_id,mode,last_updated,expires_at,geometry,payload,payload_hash,last_seen_at,stale)
       VALUES ($1,$2,$3,$1,$4,$5,CASE WHEN $8='expired' THEN now()-interval '1 second' END,
               ST_SetSRID(ST_MakePoint($6,$7),4326),$9,$1,
               CASE WHEN $8='old' THEN now()-interval '6 minutes' ELSE now() END,$8='stale')`,
      [
        payload.id,
        payload.source,
        payload.codespaceId,
        payload.mode,
        payload.lastUpdated,
        payload.geometry.coordinates[0],
        payload.geometry.coordinates[1],
        freshness,
        payload,
      ],
    );
  }
  for (const [payload, wkt, validity] of [
    [aa, "POINT(10 63)", "current"],
    [nullable, null, "current"],
    [alert("bbox-only"), "MULTIPOINT((9 62),(11 64))", "current"],
    [alert("outside"), "POINT(11 64)", "current"],
    [alert("expired"), "POINT(10 63)", "expired"],
    [alert("future"), "POINT(10 63)", "future"],
    [cancelled, "POINT(10 63)", "current"],
  ] as const) {
    await pool.query(
      `INSERT INTO public_transport_service_alerts
       (id,source,codespace_id,situation_number,state,summary,valid_from,valid_to,updated_at,geometry,payload,payload_hash,last_seen_at)
       VALUES ($1,$2,$3,$1,$4,$5,CASE WHEN $7='future' THEN now()+interval '1 hour' END,
               CASE WHEN $7='expired' THEN now()-interval '1 second' END,$6,ST_GeomFromText($8,4326),$9,$1,now())`,
      [
        payload.id,
        payload.source,
        payload.codespaceId,
        payload.state,
        payload.summary,
        payload.updatedAt,
        validity,
        wkt,
        payload,
      ],
    );
  }
  for (const [name, bounds] of [
    ["rectangle", rectangle],
    ["point", point],
    ["vertical", vertical],
    ["horizontal", horizontal],
  ] as const) {
    await check(`${name}-schema`, () => {
      const parsed = publicTransportMapQuerySchema.parse({ ...bounds, modes: "water" });
      assert.deepEqual(parsed.modes, ["water"]);
      for (const key of ["west", "south", "east", "north"] as const)
        assert.equal(parsed[key], bounds[key]);
    });
    await check(`${name}-vehicles`, async () =>
      assert.deepEqual(await store.listPublicTransportVehicles({ bounds, modes: ["water"] }), [
        a,
        b,
      ]),
    );
    await check(`${name}-alerts`, async () =>
      assert.deepEqual(await store.listPublicTransportServiceAlerts({ bounds }), [aa, nullable]),
    );
  }
  await check("schema-invalid", () => {
    for (const input of [
      { north: 63 },
      { ...rectangle, west: 11 },
      { ...rectangle, north: 60 },
      { ...point, modes: "ferry" },
    ]) {
      assert.equal(publicTransportMapQuerySchema.safeParse(input).success, false);
    }
  });
  await check("rectangle-edge", async () =>
    assert.deepEqual(
      await store.listPublicTransportVehicles({
        bounds: { west: 10, south: 63, east: 10.5, north: 63.5 },
        modes: ["water"],
      }),
      [a, b],
    ),
  );
  const empty = { west: 1, south: 1, east: 1, north: 1 };
  await check("empty-vehicles", async () =>
    assert.deepEqual(await store.listPublicTransportVehicles({ bounds: empty }), []),
  );
  await check("null-alert-outside", async () =>
    assert.deepEqual(await store.listPublicTransportServiceAlerts({ bounds: empty }), [nullable]),
  );
  await check("mode-and-order", async () =>
    assert.deepEqual(await store.listPublicTransportVehicles({ bounds: rectangle }), [a, b, bus]),
  );
  await check("vehicle-explicit-limit", async () =>
    assert.deepEqual(await store.listPublicTransportVehicles({ bounds: rectangle, limit: 1 }), [a]),
  );
  await check("alert-explicit-limit", async () =>
    assert.deepEqual(
      await store.listPublicTransportServiceAlerts({ bounds: rectangle, limit: 1 }),
      [aa],
    ),
  );
  await check("cancelled-state", async () =>
    assert.deepEqual(
      await store.listPublicTransportServiceAlerts({ bounds: rectangle, states: ["cancelled"] }),
      [cancelled],
    ),
  );
  await check("both-states", async () =>
    assert.deepEqual(
      await store.listPublicTransportServiceAlerts({
        bounds: rectangle,
        states: ["active", "cancelled"],
      }),
      [aa, nullable, cancelled],
    ),
  );
  console.log(
    JSON.stringify({
      scope: "Actual PgStore/PostGIS correctness; no performance claim",
      role: identity.rows[0]?.current_user,
      results,
      failures: results.filter((row) => !row.passed).map((row) => row.id),
    }),
  );
  assert.equal(
    results.filter((row) => !row.passed).length,
    0,
    "public transport bounds regression",
  );
} finally {
  await pool.query("ROLLBACK");
  await pool.end();
}
