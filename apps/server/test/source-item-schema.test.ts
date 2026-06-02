import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(new URL("../src/db/schema.sql", import.meta.url));

describe("source item schema", () => {
  it("defines source_items with safe dedupe indexes and situation links", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS source_items");
    expect(schema).toContain("raw_payload jsonb NOT NULL");
    expect(schema).toContain("normalized_payload jsonb NOT NULL");
    expect(schema).toContain("geo_hint geometry(Geometry, 4326)");
    expect(schema).toContain("source_items_provider_kind_external_id_unique");
    expect(schema).toContain("WHERE external_id IS NOT NULL");
    expect(schema).toContain("source_items_capture_hash_unique");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS situation_source_items");
    expect(schema).toContain("relationship text NOT NULL DEFAULT 'supports'");
    expect(schema).toContain("situation_source_items_source_item_idx");
  });

  it("backfills legacy articles and official events into source items idempotently", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(schema).toContain("-- Backfill existing articles into the source item ledger.");
    expect(schema).toContain("INSERT INTO source_items");
    expect(schema).toContain("FROM articles a");
    expect(schema).toContain("FROM official_events oe");
    expect(schema).toContain("ON CONFLICT (id) DO UPDATE SET");
    expect(schema).toContain(
      "digest(jsonb_build_array(a.source, 'article', a.id)::text, 'sha256')",
    );
    expect(schema).toContain(
      "digest(jsonb_build_array(oe.source, 'official_event', oe.id)::text, 'sha256')",
    );
  });

  it("backfills situation source links and keeps DATEX TravelTime out of the ledger", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("-- Backfill source-item links for legacy situation/article joins.");
    expect(schema).toContain("FROM situation_articles sa");
    expect(schema).toContain("WHERE si.kind = 'article'");
    expect(schema).toContain(
      "-- Backfill source-item links for situations created directly from official events.",
    );
    expect(schema).toContain("s.payload->>'officialSource'");
    expect(schema).toContain("s.payload->>'officialEventId'");
    expect(schema).toContain("WHERE si.kind = 'official_event'");
    expect(schema).toContain("ON CONFLICT (situation_id, source_item_id) DO NOTHING");
    expect(schema).not.toMatch(/INSERT INTO source_items[\s\S]*FROM datex_travel_times/);
    expect(schema).not.toContain("datex_travel_time', 'official_event'");
  });

  it("enforces telemetry/context feeds as non-causal incident context", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const provider of [
      "datex_travel_time",
      "datex_weather",
      "datex_cctv",
      "trafikkdata",
      "entur_vehicle_positions",
    ]) {
      expect(schema).toContain(provider);
    }
    expect(schema).toContain("evidence_items_no_telemetry_source_check");
    expect(schema).toContain("source_items_entur_vehicle_positions_kind_check");
    expect(schema).toContain("enforce_situation_source_item_relationship");
    expect(schema).toContain("relationship = 'supports'");
    expect(schema).toContain("RAISE EXCEPTION");
  });
});
