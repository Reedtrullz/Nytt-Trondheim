import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const invariantsPath = fileURLToPath(
  new URL("../../../scripts/migration-invariants.sql", import.meta.url),
);

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
});
