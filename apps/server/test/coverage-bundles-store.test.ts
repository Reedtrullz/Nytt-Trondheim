import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Article } from "@nytt/shared";
import { PgStore } from "../src/store.js";

describe("coverage bundle store", () => {
  it("lists persisted coverage bundle decisions without reading the source item ledger", async () => {
    const memberArticles: Article[] = [
      {
        id: "nrk-flatåsen-smoke",
        source: "nrk",
        sourceLabel: "NRK Trøndelag",
        title: "Rykka til Flatåsen etter røykutvikling",
        excerpt: "Nødetatene har rykka til Flatåsen i Trondheim etter meldinger om røyk.",
        url: "https://example.test/nrk-flatåsen-smoke",
        publishedAt: "2026-06-18T10:50:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Flatåsen", "Trondheim"],
      },
      {
        id: "politiloggen-flatåsen-smoke",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        title: "Brann: Trondheim",
        excerpt: "Nødetatene rykker til Øvre Flatåsveg etter melding om røyk fra bygning.",
        url: "https://example.test/politiloggen-flatåsen-smoke",
        publishedAt: "2026-06-18T10:48:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Flatåsen", "Trondheim"],
      },
      {
        id: "adressa-other-smoke",
        source: "adressa",
        sourceLabel: "Adresseavisen",
        title: "Røykmelding ved Heimdal",
        excerpt: "Nødetatene undersøker røyk ved Heimdal i Trondheim.",
        url: "https://example.test/adressa-other-smoke",
        publishedAt: "2026-06-18T10:49:00.000Z",
        scope: "trondheim",
        category: "Hendelser",
        places: ["Heimdal", "Trondheim"],
      },
    ];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).not.toContain("source_items");
      if (normalized.startsWith("SELECT cb.id")) {
        expect(normalized).toContain("FROM coverage_bundles cb");
        expect(normalized).toContain("cb.kind = $1");
        expect(normalized).toContain("cb.confidence = $2");
        expect(normalized).toContain("cb.id ILIKE $3");
        expect(normalized).toContain("ORDER BY cb.last_seen_at DESC, cb.id DESC");
        expect(params).toEqual(["incident", "high", "%Flatåsen%", 2]);
        return {
          rows: [
            {
              id: "coverage:flatåsen-smoke",
              kind: "incident",
              confidence: "high",
              reason: "Samme hendelse på tvers av kilder",
              generated_at: "2026-06-18T10:55:00.000Z",
              last_seen_at: "2026-06-18T10:55:00.000Z",
              last_seen_at_cursor: "2026-06-18T10:55:00.000000Z",
              primary_article_id: "nrk-flatåsen-smoke",
              member_article_ids: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
              source_ids: ["nrk", "politiloggen"],
              source_labels: ["NRK Trøndelag", "Politiloggen"],
              signals: [
                {
                  kind: "generic_place_incident",
                  articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
                  detail: "brann",
                },
              ],
              near_misses: [
                {
                  articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
                  reason: "conflicting_specific_places",
                },
              ],
              updated_at: "2026-06-18T10:55:30.000Z",
            },
          ],
        };
      }
      if (normalized === "SELECT payload FROM articles WHERE id = ANY($1::text[])") {
        expect(params).toEqual([
          ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke", "adressa-other-smoke"],
        ]);
        return { rows: memberArticles.map((payload) => ({ payload })) };
      }
      if (normalized.startsWith("SELECT count(*)::text AS total")) {
        expect(normalized).toContain("FROM coverage_bundles cb");
        expect(params).toEqual(["incident", "high", "%Flatåsen%"]);
        return {
          rows: [
            {
              total: "1",
              incident: "1",
              topic: "0",
              update: "0",
              high: "1",
              medium: "0",
              latest_generated_at: "2026-06-18T10:55:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listCoverageBundles(
      { kind: "incident", confidence: "high", q: "Flatåsen", limit: 1 },
      "Reedtrullz",
    );

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "coverage:flatåsen-smoke",
        kind: "incident",
        confidence: "high",
        memberArticles: expect.arrayContaining([
          expect.objectContaining({ id: "nrk-flatåsen-smoke", sourceLabel: "NRK Trøndelag" }),
          expect.objectContaining({
            id: "politiloggen-flatåsen-smoke",
            sourceLabel: "Politiloggen",
          }),
        ]),
        nearMissArticles: expect.arrayContaining([
          expect.objectContaining({
            id: "adressa-other-smoke",
            sourceLabel: "Adresseavisen",
            title: "Røykmelding ved Heimdal",
          }),
        ]),
        signals: expect.arrayContaining([
          expect.objectContaining({ kind: "generic_place_incident" }),
        ]),
        nearMisses: expect.arrayContaining([
          expect.objectContaining({ reason: "conflicting_specific_places" }),
        ]),
      }),
    ]);
    expect(page.items[0]).not.toHaveProperty("payload");
    expect(page.summary).toMatchObject({
      recentBundleCount: 1,
      byKind: { incident: 1, topic: 0, update: 0 },
      byConfidence: { high: 1, medium: 0 },
      latestGeneratedAt: "2026-06-18T10:55:00.000Z",
    });
    expect(page.nextCursor).toBeUndefined();
  });
});
