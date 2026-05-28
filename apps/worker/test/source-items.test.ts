import type { Article, OfficialEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { articleSourceItemInput, officialEventSourceItemInput } from "../src/repository.js";

describe("worker source item mapping", () => {
  it("maps articles into trusted or official source item inputs", () => {
    const article: Article = {
      id: "article-one",
      source: "nrk",
      sourceLabel: "NRK",
      title: "Brann i Bymarka",
      excerpt: "Røyk observert ved Bymarka.",
      url: "https://example.test/one",
      publishedAt: "2026-05-28T10:00:00.000Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Bymarka"],
      location: { lat: 63.4, lng: 10.3, label: "Bymarka" },
    };

    const item = articleSourceItemInput(article, "2026-05-28T10:01:00.000Z");

    expect(item).toMatchObject({
      provider: "nrk",
      kind: "article",
      externalId: "article-one",
      originalUrl: "https://example.test/one",
      title: "Brann i Bymarka",
      summary: "Røyk observert ved Bymarka.",
      reliabilityTier: "trusted_media",
      geoHint: { type: "Point", coordinates: [10.3, 63.4] },
    });
    expect(item.id).toMatch(/^source:/);
    expect(item.captureHash).toMatch(/^[a-f0-9]{64}$/);

    const municipalityItem = articleSourceItemInput(
      { ...article, source: "trondheim_kommune", sourceLabel: "Trondheim kommune" },
      "2026-05-28T10:01:00.000Z",
    );

    expect(municipalityItem.reliabilityTier).toBe("official");
  });

  it("maps official events using raw payload and official reliability", () => {
    const event: OfficialEvent = {
      id: "datex-event-one",
      source: "datex",
      eventType: "traffic",
      title: "E6 stengt",
      detail: "E6 er stengt ved Sluppen.",
      sourceUrl: "https://datex.example.test/situation",
      areaLabel: "Sluppen",
      state: "active",
      publishedAt: "2026-05-28T10:00:00.000Z",
      validFrom: "2026-05-28T10:00:00.000Z",
      validTo: "2026-05-28T11:00:00.000Z",
      geometry: { type: "Point", coordinates: [10.39, 63.39] },
      raw: { upstream: "compact-datex" },
    };

    const item = officialEventSourceItemInput(event, "2026-05-28T10:01:00.000Z");

    expect(item).toMatchObject({
      provider: "datex",
      kind: "official_event",
      externalId: "datex-event-one",
      originalUrl: "https://datex.example.test/situation",
      title: "E6 stengt",
      summary: "E6 er stengt ved Sluppen.",
      rawPayload: { upstream: "compact-datex" },
      reliabilityTier: "official",
      geoHint: { type: "Point", coordinates: [10.39, 63.39] },
    });
    expect(item.normalizedPayload).not.toHaveProperty("raw");
  });
});
