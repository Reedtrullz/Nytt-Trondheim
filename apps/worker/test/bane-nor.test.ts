import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  baneNorRssEndpoint,
  baneNorSourceItemInput,
  fetchBaneNorRailMessages,
  parseBaneNorRss,
} from "../src/baneNor.js";

const fixturePath = new URL("./fixtures/bane-nor-rss.xml", import.meta.url);

interface TestRssItem {
  guid: string;
  title?: string;
  link?: string;
  pubDate?: string;
  description: string;
}

function rssPayload(items: TestRssItem[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    ${items
      .map(
        (item) => `<item>
      <title>${item.title ?? "Trondheim S-Hell"}</title>
      <link>${item.link ?? "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/"}</link>
      <guid>${item.guid}</guid>
      <pubDate>${item.pubDate ?? "Tue, 02 Jun 2026 09:10:00 +0200"}</pubDate>
      <description><![CDATA[${item.description}]]></description>
    </item>`,
      )
      .join("\n")}
  </channel>
</rss>`;
}

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

  it("fetches Bane NOR RSS with source identity and timeout signal", async () => {
    const payload = await readFile(fixturePath, "utf8");
    let requestInit: RequestInit | undefined;
    const result = await fetchBaneNorRailMessages({
      endpoint: baneNorRssEndpoint,
      receivedAt: "2026-06-02T07:15:00.000Z",
      fetcher: async (_url, init) => {
        requestInit = init;
        return new Response(payload, { status: 200 });
      },
    });

    expect(requestInit?.signal).toBeTruthy();
    expect(new Headers(requestInit?.headers).get("User-Agent")).toContain("NyttTrondheim");
    expect(result.messages).toHaveLength(1);
  });

  it("parses same-day validity phrases with fra kl./til kl. as future planned work", () => {
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "same-day",
          description:
            "Fra fredag 4. september fra kl. 09:20 til kl. 13:45 utfører vi arbeid ved Trondheim S. Strekningen blir stengt for trafikk.",
        },
      ]),
      { receivedAt: "2026-09-03T10:00:00.000Z" },
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      guid: "same-day",
      state: "planned",
      validFrom: "2026-09-04T07:20:00.000Z",
      validTo: "2026-09-04T11:45:00.000Z",
    });
  });

  it("does not mark closure terms active when a detected validity phrase cannot be parsed", () => {
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "unparsed-validity",
          description:
            "Fra fredag 4. notamonth fra kl. 09:20 til kl. 13:45 utfører vi arbeid ved Trondheim S. Strekningen blir stengt for trafikk.",
        },
      ]),
      { receivedAt: "2026-09-04T08:00:00.000Z" },
    );

    expect(result.messages[0]).toMatchObject({
      guid: "unparsed-validity",
      state: "unknown",
      validFrom: undefined,
      validTo: undefined,
    });
  });

  it("infers January validity as next year for December future planning", () => {
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "future-january",
          description:
            "Fra fredag 2. januar kl. 01:00 til søndag 4. januar kl. 03:30 utfører vi arbeid mellom Trondheim S og Hell. Strekningen blir stengt for trafikk.",
        },
      ]),
      { receivedAt: "2026-12-15T12:00:00.000Z" },
    );

    expect(result.messages[0]).toMatchObject({
      guid: "future-january",
      state: "planned",
      validFrom: "2027-01-02T00:00:00.000Z",
      validTo: "2027-01-04T02:30:00.000Z",
    });
  });

  it("infers current December-January intervals as active around New Year", () => {
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "current-new-year",
          description:
            "Fra onsdag 31. desember kl. 22:00 til torsdag 1. januar kl. 14:00 utfører vi arbeid mellom Trondheim S og Hell. Strekningen blir stengt for trafikk.",
        },
      ]),
      { receivedAt: "2026-01-01T12:00:00.000Z" },
    );

    expect(result.messages[0]).toMatchObject({
      guid: "current-new-year",
      state: "active",
      validFrom: "2025-12-31T21:00:00.000Z",
      validTo: "2026-01-01T13:00:00.000Z",
    });
  });

  it("falls back to receivedAt when pubDate is invalid", () => {
    const receivedAt = "2026-06-02T07:15:00.000Z";
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "invalid-pubdate",
          pubDate: "not a date",
          description:
            "Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell.",
        },
      ]),
      { receivedAt },
    );

    expect(result.messages[0]!.publishedAt).toBe(receivedAt);
  });

  it("falls back to the safe endpoint for unsafe or invalid item URLs", () => {
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "javascript-url",
          link: "javascript:alert(1)",
          description:
            "Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell.",
        },
        {
          guid: "data-url",
          link: "data:text/html;base64,PGgxPkhlbGxvPC9oMT4=",
          description:
            "Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell.",
        },
        {
          guid: "invalid-url",
          link: "not a valid url",
          description:
            "Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell.",
        },
      ]),
      { receivedAt: "2026-06-02T07:15:00.000Z" },
    );

    expect(result.messages.map((message) => message.url)).toEqual([
      baneNorRssEndpoint,
      baneNorRssEndpoint,
      baneNorRssEndpoint,
    ]);
  });

  it("changes captureHash when versioned title or validity fields change", () => {
    const result = parseBaneNorRss(
      rssPayload([
        {
          guid: "capture-hash",
          title: "Trondheim S-Hell",
          description:
            "Fra lørdag 20. juni kl. 04:20 til mandag 22. juni kl. 06:00 utfører vi arbeid mellom Trondheim S og Hell.",
        },
      ]),
      { receivedAt: "2026-06-02T07:15:00.000Z" },
    );
    const message = result.messages[0]!;
    const baseHash = baneNorSourceItemInput(message, {
      fetchedAt: message.receivedAt,
      rawItem: {},
    }).captureHash;
    const titleHash = baneNorSourceItemInput(
      { ...message, title: "Trondheim S-Hell oppdatert" },
      { fetchedAt: message.receivedAt, rawItem: {} },
    ).captureHash;
    const validityHash = baneNorSourceItemInput(
      { ...message, validTo: "2026-06-22T05:00:00.000Z" },
      { fetchedAt: message.receivedAt, rawItem: {} },
    ).captureHash;

    expect(baseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(titleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(validityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(titleHash).not.toBe(baseHash);
    expect(validityHash).not.toBe(baseHash);
  });
});
