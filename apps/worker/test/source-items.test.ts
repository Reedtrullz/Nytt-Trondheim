import type { Article, OfficialEvent, TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { articleSourceItemInput, officialEventSourceItemInput } from "../src/repository.js";
import { trafficInfoSourceItemInput } from "../src/vegvesenTrafficInfo.js";

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

  it("maps TrafficInfo map events into official source item inputs", () => {
    const event: TrafficMapEvent = {
      id: "vegvesen-traffic-info:NPRA_HBT_1",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_1",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Fv. 6650 Vestre Kystad",
      description: "Lysregulering.",
      locationName: "Fv. 6650 Vestre Kystad, Trondheim",
      roadName: "Fv. 6650",
      validFrom: "2026-04-21T05:00:00.000Z",
      validTo: "2026-06-26T14:00:00.000Z",
      updatedAt: "2026-05-07T04:59:25.000Z",
      sourceUrl: "https://www.vegvesen.no/trafikk/hvaskjer?lat=63.38945&lng=10.345405&zoom=14",
      geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
      rawType: "roadworks",
      confidence: 1,
    };
    const rawMessage = { id: "NPRA_HBT_1", publicCommentDescription: "Lysregulering." };

    const item = trafficInfoSourceItemInput(event, {
      fetchedAt: "2026-05-29T11:15:00.000Z",
      rawMessage,
    });

    expect(item).toMatchObject({
      provider: "vegvesen_traffic_info",
      kind: "official_event",
      externalId: "NPRA_HBT_1",
      originalUrl: event.sourceUrl,
      title: event.title,
      summary: event.description,
      publishedAt: event.updatedAt,
      fetchedAt: "2026-05-29T11:15:00.000Z",
      rawPayload: rawMessage,
      normalizedPayload: event,
      geoHint: event.geometry,
      reliabilityTier: "official",
    });
    expect(item.id).toMatch(/^source:/);
    expect(item.captureHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
