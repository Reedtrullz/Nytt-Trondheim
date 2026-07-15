import type { Article, CoverageBundleMergeReportRequest } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";

const articles: Article[] = [
  {
    id: "missed-a",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Brannvesenet rykket ut til Lade",
    excerpt: "Det brant i en bod ved Lade.",
    url: "https://example.test/missed-a",
    publishedAt: "2026-07-15T06:00:00.000Z",
    scope: "trondheim",
    category: "Nødetater",
    places: ["Lade"],
  },
  {
    id: "missed-b",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Brann i bod på Lade",
    excerpt: "Nødetatene fikk kontroll på brannen.",
    url: "https://example.test/missed-b",
    publishedAt: "2026-07-15T06:02:00.000Z",
    scope: "trondheim",
    category: "Nødetater",
    places: ["Lade"],
  },
];

function fixture(): MemoryStore {
  const store = new MemoryStore();
  (store as unknown as { articles: Article[] }).articles = articles;
  return store;
}

const input: CoverageBundleMergeReportRequest = {
  anchorArticleId: "missed-a",
  candidateArticleId: "missed-b",
  anchorArticleIds: ["missed-a"],
  candidateArticleIds: ["missed-b"],
  anchorStoryId: "story-a",
  candidateStoryId: "story-b",
  projectionMode: "legacy",
  matcherVersion: "v1",
};

describe("coverage merge report store", () => {
  it("persists an idempotent, non-mutating missed-group report", async () => {
    const store = fixture();
    const before = await store.listCityPulseStories({ scope: "trondheim", limit: 20 }, "owner");
    const first = await store.createCoverageMergeReport(input, "owner");
    const replay = await store.createCoverageMergeReport(
      { ...input, anchorArticleId: "missed-b", candidateArticleId: "missed-a" },
      "owner",
    );
    const after = await store.listCityPulseStories({ scope: "trondheim", limit: 20 }, "owner");

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ status: "open", projectionMode: "legacy", matcherVersion: "v1" });
    expect(after.items).toEqual(before.items);
  });

  it("exports only sanitized evaluation fields", async () => {
    const store = fixture();
    await store.createCoverageMergeReport({ ...input, reason: "private owner note" }, "owner");

    const payload = await store.exportCoverageMergeReports(30);

    expect(payload.rows).toEqual([
      expect.objectContaining({
        label: "together",
        articleIds: ["missed-a", "missed-b"],
        normalizedTitles: ["Brannvesenet rykket ut til Lade", "Brann i bod på Lade"],
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("private owner note");
  });

  it("rejects reports for articles that are no longer available", async () => {
    const store = fixture();
    await expect(
      store.createCoverageMergeReport({ ...input, candidateArticleId: "missing" }, "owner"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
