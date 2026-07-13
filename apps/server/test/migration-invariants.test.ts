import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const invariantsPath = fileURLToPath(
  new URL("../../../scripts/migration-invariants.sql", import.meta.url),
);
const schemaPath = fileURLToPath(new URL("../src/db/schema.sql", import.meta.url));

describe("migration invariants", () => {
  it("proves Web Push is source-health only", async () => {
    const sql = await readFile(invariantsPath, "utf8");

    expect(sql).toContain("Web Push must stay out of evidence_items");
    expect(sql).toContain("Web Push must stay out of source_items");
    expect(sql).toContain("'evidence_items_no_health_only_source_check'");
    expect(sql).toContain("'source_items_no_health_only_provider_check'");
    expect(sql).toContain(
      "INSERT INTO source_health (source, label, state, last_checked_at, detail)",
    );
    expect(sql).toContain("'web_push'");
  });

  it("defines the normalized coverage lifecycle schema", async () => {
    const sql = await readFile(schemaPath, "utf8");
    const normalizedSql = sql.replace(/\s+/g, " ");

    for (const table of [
      "coverage_bundle_generations",
      "coverage_generation_articles",
      "coverage_bundle_versions",
      "coverage_bundle_members",
      "coverage_bundle_edges",
      "coverage_bundle_corrections",
    ]) {
      expect(normalizedSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    for (const column of [
      "generation_id",
      "state",
      "matcher_version",
      "match_tier",
      "match_score",
      "match_rationale",
      "first_seen_at",
    ]) {
      expect(normalizedSql).toContain(
        `ALTER TABLE coverage_bundles ADD COLUMN IF NOT EXISTS ${column}`,
      );
    }

    expect(normalizedSql).toContain(
      "WHERE is_current AND status = 'completed' AND mode = 'active'",
    );
    expect(normalizedSql).toContain(
      "ALTER TABLE coverage_bundle_versions ADD COLUMN IF NOT EXISTS confidence text",
    );
    expect(normalizedSql).toContain(
      "ALTER TABLE coverage_bundle_versions ALTER COLUMN confidence SET NOT NULL",
    );
    expect(normalizedSql).toContain("VALUES ('016_coverage_bundle_lifecycle')");
  });
});
