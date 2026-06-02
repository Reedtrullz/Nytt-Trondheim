import { describe, expect, it, vi } from "vitest";
import type { SourceHealth, SourceItemInput } from "@nytt/shared";
import { collectBaneNorRailContext } from "../src/index.js";

function repositoryStub() {
  const sourceItems: SourceItemInput[] = [];
  const health: SourceHealth[] = [];
  return {
    sourceItems,
    health,
    repository: {
      upsertBaneNorSourceItems: vi.fn(async (items: SourceItemInput[]) => sourceItems.push(...items)),
      setHealth: vi.fn(async (item: SourceHealth) => health.push(item)),
    },
  };
}

describe("Bane NOR worker collection", () => {
  it("stores Bane NOR source items and writes ok source health", async () => {
    const { repository, sourceItems, health } = repositoryStub();
    const parserResult = {
      messages: [
        {
          id: "bane-nor:guid-1",
          source: "bane_nor" as const,
          guid: "guid-1",
          title: "Trondheim S-Hell",
          description: "Strekningen blir stengt for trafikk.",
          url: "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/",
          publishedAt: "2026-06-02T07:10:00.000Z",
          receivedAt: "2026-06-02T07:15:00.000Z",
          state: "planned" as const,
          matchedTerms: ["Hell", "Trondheim S"],
          promotion: "none" as const,
        },
      ],
      seenGuids: ["guid-1"],
      rawItemsByGuid: new Map<string, unknown>([["guid-1", { guid: "guid-1" }]]),
    };

    await collectBaneNorRailContext({
      repository: repository as never,
      nextPollAt: "2026-06-02T07:25:00.000Z",
      now: () => new Date("2026-06-02T07:15:00.000Z"),
      collector: async () => parserResult,
    });

    expect(sourceItems).toHaveLength(1);
    expect(sourceItems[0]).toMatchObject({ provider: "bane_nor", kind: "official_event" });
    expect(health[0]).toMatchObject({ source: "bane_nor", state: "ok" });
  });

  it("records degraded health when Bane NOR fetch fails", async () => {
    const { repository, health } = repositoryStub();

    await collectBaneNorRailContext({
      repository: repository as never,
      nextPollAt: "2026-06-02T07:25:00.000Z",
      now: () => new Date("2026-06-02T07:15:00.000Z"),
      collector: async () => {
        throw new Error("rss unavailable");
      },
    });

    expect(health[0]).toMatchObject({ source: "bane_nor", state: "degraded" });
    expect(health[0]?.detail).toContain("rss unavailable");
  });
});
