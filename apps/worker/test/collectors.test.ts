import { describe, expect, it } from "vitest";
import { collectRss } from "../src/collectors.js";
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
});
