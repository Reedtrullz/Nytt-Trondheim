import { describe, expect, it } from "vitest";
import { canonicalUrl, collectMunicipality, collectRss } from "../src/collectors.js";
import { articleDedupeKey } from "../src/repository.js";

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Brann i Bymarka i Trondheim</title><description>Nødetatene er varslet.</description>
<link>https://example.test/trondheim</link><pubDate>Tue, 26 May 2026 12:00:00 GMT</pubDate></item>
<item><title>Nyheter fra Oslo</title><description>Ikke lokalt.</description>
<link>https://example.test/oslo</link><pubDate>Tue, 26 May 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;

describe("RSS collection policy", () => {
  it("retains Trondheim-relevant national stories and drops unrelated national items", async () => {
    const articles = await collectRss(
      { id: "vg", label: "VG", url: "https://example.test/rss" },
      async () => new Response(rss, { status: 200 }),
    );
    expect(articles).toHaveLength(1);
    expect(articles[0]?.scope).toBe("trondheim");
    expect(articles[0]?.category).toBe("Hendelser");
  });

  it("deduplicates title/time variants consistently within a source", () => {
    const base = {
      id: "id",
      source: "nrk" as const,
      sourceLabel: "NRK Trøndelag",
      title: "Brann i Bymarka",
      excerpt: "",
      url: "https://example.test/1",
      publishedAt: "2026-05-26T12:10:00.000Z",
      scope: "trondheim" as const,
      category: "Hendelser" as const,
      places: ["Bymarka"],
    };
    expect(articleDedupeKey(base)).toBe(
      articleDedupeKey({ ...base, title: "BRANN i Bymarka", publishedAt: "2026-05-26T12:45:00Z" }),
    );
  });

  it("normalizes tracking parameters in article URLs", () => {
    expect(canonicalUrl("https://example.test/news?utm_source=rss&id=3#top")).toBe(
      "https://example.test/news?id=3",
    );
  });

  it("extracts publication times from municipal detail pages", async () => {
    const listing =
      '<article class="card"><a href="/aktuelt/sak/">Varsel om brann i Bymarka</a><div>Oppdatert informasjon.</div></article>';
    const detail = '<meta property="article:published_time" content="26.05.2026 13:15:00">';
    const articles = await collectMunicipality(
      async (url) =>
        new Response(String(url).includes("/aktuelt/sak/") ? detail : listing, { status: 200 }),
    );
    expect(articles[0]?.publishedAt).toBe("2026-05-26T11:15:00.000Z");
  });

  it("uses Oslo winter time for municipal publication timestamps", async () => {
    const listing =
      '<article class="card"><a href="/aktuelt/vinter/">Brann i Bymarka i Trondheim</a></article>';
    const detail = '<meta property="article:published_time" content="26.01.2026 13:15:00">';
    const articles = await collectMunicipality(
      async (url) =>
        new Response(String(url).includes("/aktuelt/vinter/") ? detail : listing, { status: 200 }),
    );
    expect(articles[0]?.publishedAt).toBe("2026-01-26T12:15:00.000Z");
  });
});
