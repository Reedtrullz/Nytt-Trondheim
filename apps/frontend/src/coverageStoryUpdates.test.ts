import { describe, expect, it } from "vitest";
import type { CityPulseStory } from "@nytt/shared";
import { replaceCoverageStories } from "./coverageStoryUpdates.js";

function story(id: string, latestAt: string): CityPulseStory {
  const primary = {
    id: `${id}-article`,
    source: "nrk" as const,
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: id,
    url: `https://example.test/${id}`,
    publishedAt: latestAt,
    scope: "trondheim" as const,
    category: "Hendelser" as const,
    places: ["Trondheim"],
  };
  return {
    id,
    primaryArticleId: primary.id,
    articleIds: [primary.id],
    primary,
    articles: [primary],
    sourceLabels: [primary.sourceLabel],
    sourceCount: 1,
    updateCount: 0,
    latestAt,
    category: primary.category,
  };
}

describe("replaceCoverageStories", () => {
  it("replaces only removed stories and preserves deterministic order", () => {
    const result = replaceCoverageStories(
      [
        story("newest", "2026-07-12T21:00:00.000Z"),
        story("group", "2026-07-12T20:00:00.000Z"),
        story("old", "2026-07-12T19:00:00.000Z"),
      ],
      ["group"],
      [story("split-a", "2026-07-12T20:00:00.000Z"), story("split-b", "2026-07-12T19:59:00.000Z")],
    );

    expect(result.map((item) => item.id)).toEqual(["newest", "split-a", "split-b", "old"]);
  });

  it("is idempotent when a replacement is replayed", () => {
    const first = replaceCoverageStories(
      [story("group", "2026-07-12T20:00:00.000Z")],
      ["group"],
      [story("split", "2026-07-12T20:00:00.000Z")],
    );
    const second = replaceCoverageStories(
      first,
      ["group"],
      [story("split", "2026-07-12T20:00:00.000Z")],
    );

    expect(second).toEqual(first);
  });

  it("deduplicates replacement ids and uses the newest replacement payload", () => {
    const result = replaceCoverageStories(
      [story("group", "2026-07-12T20:00:00.000Z")],
      ["group"],
      [story("split", "2026-07-12T19:59:00.000Z"), story("split", "2026-07-12T20:01:00.000Z")],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.latestAt).toBe("2026-07-12T20:01:00.000Z");
  });
});
