import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalUrl,
  collectMunicipality,
  collectRss,
  probeOfficialSources,
} from "../src/collectors.js";
import { articleDedupeKey } from "../src/repository.js";

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Brann i Bymarka i Trondheim</title><description>Nødetatene er varslet.</description>
<link>https://example.test/trondheim</link><pubDate>Tue, 26 May 2026 12:00:00 GMT</pubDate></item>
<item><title>Nyheter fra Oslo</title><description>Ikke lokalt.</description>
<link>https://example.test/oslo</link><pubDate>Tue, 26 May 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;

const originalDatexEnv = {
  DATEX_ENDPOINT: process.env.DATEX_ENDPOINT,
  DATEX_USERNAME: process.env.DATEX_USERNAME,
  DATEX_PASSWORD: process.env.DATEX_PASSWORD,
};

beforeEach(() => {
  delete process.env.DATEX_ENDPOINT;
  delete process.env.DATEX_USERNAME;
  delete process.env.DATEX_PASSWORD;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalDatexEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

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

  it("keeps Trondheim sentrum as a specific RSS place for grouping and geocoding", async () => {
    const sentrumRss = `<?xml version="1.0"?><rss><channel>
      <item><title>Tyveri i Trondheim sentrum</title><description>Politiet undersøker saken.</description>
      <link>https://example.test/sentrum</link><pubDate>Thu, 18 Jun 2026 05:34:00 GMT</pubDate></item>
    </channel></rss>`;

    const articles = await collectRss(
      { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss" },
      async () => new Response(sentrumRss, { status: 200 }),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      scope: "trondheim",
      category: "Hendelser",
      places: ["Sentrum", "Trondheim"],
    });
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

  it("rejects non-http article URLs from feeds", async () => {
    const unsafeRss = `<?xml version="1.0"?><rss><channel>
      <item><title>Brann i Trondheim sentrum</title><description>Nødetatene er varslet.</description>
      <link>javascript:alert(1)</link><pubDate>Tue, 26 May 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`;

    const articles = await collectRss(
      { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss" },
      async () => new Response(unsafeRss, { status: 200 }),
    );

    expect(articles).toEqual([]);
  });

  it("degrades malformed successful RSS responses instead of reporting an empty healthy feed", async () => {
    await expect(
      collectRss(
        { id: "vg", label: "VG", url: "https://example.test/rss" },
        async () => new Response("<html>ikke rss</html>", { status: 200 }),
      ),
    ).rejects.toThrow(/RSS-format/);
  });

  it("resolves relative feed links and tolerates invalid publication dates per item", async () => {
    let requestInit: RequestInit | undefined;
    const relativeRss = `<?xml version="1.0"?><rss><channel>
      <item><title>Brann i Trondheim sentrum</title><description>Nødetatene er varslet.</description>
      <link>/nyheter/brann</link><pubDate>ikke en dato</pubDate></item>
    </channel></rss>`;

    const articles = await collectRss(
      { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss/feed.xml" },
      async (_url, init) => {
        requestInit = init;
        return new Response(relativeRss, { status: 200 });
      },
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://example.test/nyheter/brann");
    expect(Number.isNaN(Date.parse(articles[0]?.publishedAt ?? ""))).toBe(false);
    expect(requestInit?.signal).toBeTruthy();
    expect(new Headers(requestInit?.headers).get("User-Agent")).toContain("NyttTrondheim");
  });

  it("canonicalUrl allows only http and https schemes", () => {
    expect(canonicalUrl("https://example.test/news?utm_source=rss&id=3#top")).toBe(
      "https://example.test/news?id=3",
    );
    expect(() => canonicalUrl("javascript:alert(1)")).toThrow(/http or https/);
    expect(() => canonicalUrl("data:text/html,hello")).toThrow(/http or https/);
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

  it("skips unsafe municipal cards instead of failing the whole collection", async () => {
    const listing = `
      <article class="card"><a href="javascript:alert(1)">Ugyldig lenke</a></article>
      <article class="card"><a href="/aktuelt/trygg/">Brann i Trondheim sentrum</a></article>
    `;
    const detail = '<meta property="article:published_time" content="26.05.2026 13:15:00">';
    const articles = await collectMunicipality(
      async (url) =>
        new Response(String(url).includes("/aktuelt/trygg/") ? detail : listing, { status: 200 }),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://www.trondheim.kommune.no/aktuelt/trygg/");
  });

  it("degrades municipal listing shape changes instead of reporting an empty healthy listing", async () => {
    await expect(
      collectMunicipality(async () => new Response("<main>Ingen artikkelkort</main>")),
    ).rejects.toThrow(/artikkelkort/);
  });
});

describe("DATEX official source probe", () => {
  it("waits for Basic Auth credentials when DATEX username and password are missing", async () => {
    const requestInits: RequestInit[] = [];
    const statuses = await probeOfficialSources(async (_url, init) => {
      requestInits.push(init ?? {});
      return new Response("ok", { status: 200 });
    });

    const datex = statuses.find((status) => status.source === "datex");

    expect(requestInits.length).toBeGreaterThanOrEqual(3);
    for (const init of requestInits) {
      expect(init.signal).toBeTruthy();
      expect(new Headers(init.headers).get("User-Agent")).toContain("NyttTrondheim");
    }
    expect(datex).toMatchObject({
      label: "Vegvesen DATEX",
      state: "awaiting_access",
      detail: "Venter på DATEX Basic Auth-brukernavn og passord",
    });
  });

  it("checks the DATEX endpoint with Basic Auth when username and password are configured", async () => {
    process.env.DATEX_ENDPOINT =
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata?srti=false&foo=bar";
    process.env.DATEX_USERNAME = "svv-user";
    process.env.DATEX_PASSWORD = "svv-pass";
    let datexUrl: string | undefined;
    let datexAuthorization: string | undefined;
    let datexSignal: AbortSignal | undefined;

    const statuses = await probeOfficialSources(async (url, init) => {
      if (String(url).includes("GetSituation")) {
        datexUrl = String(url);
        const headers = new Headers(init?.headers);
        datexAuthorization = headers.get("Authorization") ?? undefined;
        datexSignal = init?.signal ?? undefined;
      }
      return new Response("ok", { status: 200 });
    });

    const datex = statuses.find((status) => status.source === "datex");

    expect(new URL(datexUrl!).searchParams.get("srti")).toBe("True");
    expect(new URL(datexUrl!).searchParams.get("foo")).toBe("bar");
    expect(datexAuthorization).toBe("Basic c3Z2LXVzZXI6c3Z2LXBhc3M=");
    expect(datexSignal).toBeTruthy();
    expect(datex).toMatchObject({
      label: "Vegvesen DATEX",
      state: "ok",
      detail: "Tilgang konfigurert og testet mot DATEX GetSituation",
    });
  });

  it("does not probe disallowed DATEX endpoints with Basic Auth", async () => {
    process.env.DATEX_ENDPOINT =
      "https://attacker.example.test/datexapi/GetSituation/pullsnapshotdata";
    process.env.DATEX_USERNAME = "svv-user";
    process.env.DATEX_PASSWORD = "svv-pass";
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));

    const statuses = await probeOfficialSources(fetcher);

    const datex = statuses.find((status) => status.source === "datex");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("attacker.example.test"))).toBe(
      false,
    );
    expect(datex).toMatchObject({
      label: "Vegvesen DATEX",
      state: "degraded",
    });
    expect(datex?.detail).toContain("allowed Vegvesen host");
  });
});
