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
});
