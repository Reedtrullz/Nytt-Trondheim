import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { baneNorSourceItemInput, parseBaneNorRss } from "../src/baneNor.js";

const fixturePath = new URL("./fixtures/bane-nor-rss.xml", import.meta.url);

describe("Bane NOR RSS", () => {
  it("keeps Trondheim/Trøndelag rail messages and filters unrelated routes", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseBaneNorRss(payload, {
      receivedAt: "2026-06-02T07:15:00.000Z",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.seenGuids).toEqual([
      "04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      "bb195bf8-cf29-405a-a7b0-c012c1a08a12",
    ]);
    const message = result.messages[0]!;
    expect(message).toMatchObject({
      id: "bane-nor:04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      source: "bane_nor",
      guid: "04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      title: "Trondheim S-Hell",
      matchedTerms: ["Hell", "Trondheim S"],
      state: "planned",
      validFrom: "2026-06-20T02:20:00.000Z",
      validTo: "2026-06-22T04:00:00.000Z",
      promotion: "none",
    });
    expect(result.rawItemsByGuid.get(message.guid)).toEqual({
      title: "Trondheim S-Hell",
      link: "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/",
      guid: "04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      pubDate: "Tue, 02 Jun 2026 09:10:00 +0200",
      description:
        "Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell. Strekningen blir stengt for trafikk.",
    });
  });

  it("mirrors rail messages to source_items without promotion metadata", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseBaneNorRss(payload, {
      receivedAt: "2026-06-02T07:15:00.000Z",
    });
    const message = result.messages[0]!;
    const rawItem = result.rawItemsByGuid.get(message.guid)!;

    const item = baneNorSourceItemInput(message, {
      fetchedAt: "2026-06-02T07:15:00.000Z",
      rawItem,
    });

    expect(item).toMatchObject({
      provider: "bane_nor",
      kind: "official_event",
      externalId: message.guid,
      originalUrl: message.url,
      title: "Trondheim S-Hell",
      reliabilityTier: "official",
    });
    expect(item.rawPayload).toEqual(rawItem);
    expect(item.normalizedPayload).toMatchObject({
      id: "bane-nor:04ef7d8f-f6cf-40b8-915c-e14c1fad3708",
      promotion: "none",
    });
    expect(item.normalizedPayload).not.toHaveProperty("geoHint");
    expect(item).not.toHaveProperty("geoHint");
    expect(item.captureHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
