import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalUrl,
  collectFrontpage,
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
      category: "Krim",
      places: ["Sentrum", "Trondheim"],
    });
  });

  it("enriches sparse Adresseavisen Nyhetsstudio items with public article text", async () => {
    const adressaRss = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Ti meter stort ras - kan bli stengt i flere uker</title>
        <link>https://www.adressa.no/nyhetsstudio/i/k00ejA/ti-meter-stort-ras-kan-bli-stengt-i-flere-uker</link>
        <pubDate>Sat, 28 Mar 2026 20:28:47 GMT</pubDate>
        <category>Nyhetsstudio</category>
      </item>
    </channel></rss>`;
    const detail = `
      <html><body>
        <p>Onsdag kveld gikk det et ras med steiner og løsmasser på Gangåsveien i Orkland.</p>
        <p>Nå er en strekning på cirka 100 meter stengt.</p>
      </body></html>
    `;
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/nyhetsstudio/")
        ? new Response(detail)
        : new Response(adressaRss, { status: 200 }),
    );

    const articles = await collectRss(
      { id: "adressa", label: "Adresseavisen", url: "https://www.adressa.no/rss/nyheter" },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      scope: "trondelag",
      places: ["Gangåsvegen", "Orkland"],
    });
    expect(articles[0]?.excerpt).toContain("Gangåsveien");
  });

  it("uses Avisa Sør-Trøndelag RSS categories as regional place hints", async () => {
    const avisaStRss = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Trøbbel i tunnel - vei åpnet igjen</title>
        <description>Trafikken går som normalt etter berging.</description>
        <link>https://www.avisa-st.no/nyheter/n/ArGWMr/troebbel-i-tunnel-vei-stengt</link>
        <pubDate>Sat, 27 Jun 2026 14:00:00 GMT</pubDate>
        <category>Nyheter</category>
        <category>Orkanger</category>
      </item>
    </channel></rss>`;

    const articles = await collectRss(
      { id: "avisa_st", label: "Avisa Sør-Trøndelag", url: "https://www.avisa-st.no/rss" },
      async () => new Response(avisaStRss, { status: 200 }),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      source: "avisa_st",
      sourceLabel: "Avisa Sør-Trøndelag",
      scope: "trondelag",
      places: ["Orkanger"],
      category: "Transport",
    });
  });

  it("parses regional Atom feeds", async () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Vannlekkasje i Namsos sentrum</title>
        <summary>Kommunen ber folk i området følge med.</summary>
        <link href="https://www.ytringen.no/vannlekkasje-i-namsos-sentrum" rel="alternate" />
        <updated>2026-06-28T12:30:00+02:00</updated>
        <category term="Nyheter" />
      </entry>
    </feed>`;

    const articles = await collectRss(
      {
        id: "ytringen",
        label: "Ytringen",
        url: "https://ytringen.no/atom.xml",
        format: "atom",
        retainRegionalUnmatched: true,
      },
      async () => new Response(atom, { status: 200 }),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      source: "ytringen",
      sourceLabel: "Ytringen",
      title: "Vannlekkasje i Namsos sentrum",
      publishedAt: "2026-06-28T10:30:00.000Z",
      scope: "trondelag",
      places: ["Namsos"],
    });
  });

  it("collects Amedia public frontpage teasers with embedded stable timestamps", async () => {
    const html = `
      <html><body>
        <a href="/en-person-mottar-helsehjelp-etter-voldshendelse/s/30-113-18203">
          Artikkelen er for abonnenter Mann (19) kritisk skadet:
          Nyhetsvarsel Fire siktet for grov kroppsskade i Trondheim
        </a>
        <script type="application/json">
          {"type":"story","id":"30-113-18203","articleLastModified":"2026-06-28T18:45:00.000+0200"}
        </script>
      </body></html>
    `;
    const fetcher = vi.fn(async () => new Response(html, { status: 200 }));

    const articles = await collectFrontpage(
      {
        id: "nidaros",
        label: "Nidaros",
        url: "https://www.nidaros.no/",
        retainRegionalUnmatched: true,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      source: "nidaros",
      sourceLabel: "Nidaros",
      publishedAt: "2026-06-28T16:45:00.000Z",
      scope: "trondheim",
      category: "Nyheter",
    });
    expect(articles[0]?.title).toContain("Fire siktet");
  });

  it("collects public JSON-LD frontpage teasers with article-page date metadata", async () => {
    const frontpage = `<html><head>
      <script type="application/ld+json">
        [{"@context":"https://schema.org","@type":"WebPage","mainEntity":{"@type":"ItemList","itemListElement":[
          {"@type":"ListItem","position":1,"item":{"@type":"NewsArticle","headline":"Kokevarselet i Tydal er opphevet","url":"/kokevarselet-i-tydal-er-opphevet/295674"}}
        ]}}]
      </script>
    </head><body></body></html>`;
    const detail = `<html><head>
      <meta property="og:title" content="Kokevarselet i Tydal er opphevet">
      <meta property="og:description" content="Kommunen opplyser at vannet kan brukes som normalt igjen.">
      <meta property="article:published_time" content="2026-06-28T09:15:00.000Z">
      <meta property="article:tag" content="Tydal">
    </head></html>`;
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/kokevarselet")
        ? new Response(detail, { status: 200 })
        : new Response(frontpage, { status: 200 }),
    );

    const articles = await collectFrontpage(
      {
        id: "selbyggen",
        label: "Selbyggen",
        url: "https://www.selbyggen.no/",
        detailFetchLimit: 1,
        retainRegionalUnmatched: true,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      source: "selbyggen",
      sourceLabel: "Selbyggen",
      title: "Kokevarselet i Tydal er opphevet",
      publishedAt: "2026-06-28T09:15:00.000Z",
      scope: "trondelag",
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
      <item><title>Vannlekkasje i Trondheim sentrum</title><description>Kommunen arbeider på stedet.</description>
      <link>https://example.test/trygg</link><pubDate>Tue, 26 May 2026 12:15:00 GMT</pubDate></item>
    </channel></rss>`;

    const articles = await collectRss(
      { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss" },
      async () => new Response(unsafeRss, { status: 200 }),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://example.test/trygg");
  });

  it("degrades malformed successful RSS responses instead of reporting an empty healthy feed", async () => {
    await expect(
      collectRss(
        { id: "vg", label: "VG", url: "https://example.test/rss" },
        async () => new Response("<html>ikke rss</html>", { status: 200 }),
      ),
    ).rejects.toThrow(/RSS-format/);
  });

  it("degrades empty successful RSS responses instead of reporting a healthy empty feed", async () => {
    await expect(
      collectRss(
        { id: "vg", label: "VG", url: "https://example.test/rss" },
        async () =>
          new Response("<rss><channel><title>VG</title></channel></rss>", { status: 200 }),
      ),
    ).rejects.toThrow(/ingen oppføringer/i);
  });

  it("skips an invalid publication timestamp while retaining valid feed items", async () => {
    let requestInit: RequestInit | undefined;
    const relativeRss = `<?xml version="1.0"?><rss><channel>
      <item><title>Brann i Trondheim sentrum</title><description>Nødetatene er varslet.</description>
      <link>/nyheter/brann</link><pubDate>ikke en dato</pubDate></item>
      <item><title>Vannlekkasje i Trondheim sentrum</title><description>Kommunen arbeider på stedet.</description>
      <link>/nyheter/vannlekkasje</link><pubDate>Tue, 26 May 2026 12:15:00 GMT</pubDate></item>
    </channel></rss>`;

    const articles = await collectRss(
      { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss/feed.xml" },
      async (_url, init) => {
        requestInit = init;
        return new Response(relativeRss, { status: 200 });
      },
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://example.test/nyheter/vannlekkasje");
    expect(articles[0]?.publishedAt).toBe("2026-05-26T12:15:00.000Z");
    expect(requestInit?.signal).toBeTruthy();
    expect(new Headers(requestInit?.headers).get("User-Agent")).toContain("NyttTrondheim");
  });

  it("degrades a feed when every candidate has an unusable timestamp", async () => {
    const invalidTimestampRss = `<?xml version="1.0"?><rss><channel>
      <item><title>Brann i Trondheim sentrum</title><description>Nødetatene er varslet.</description>
      <link>/nyheter/brann</link><pubDate>ikke en dato</pubDate></item>
    </channel></rss>`;

    await expect(
      collectRss(
        { id: "nrk", label: "NRK Trøndelag", url: "https://example.test/rss/feed.xml" },
        async () => new Response(invalidTimestampRss, { status: 200 }),
      ),
    ).rejects.toThrow(/ingen brukbare tidsstempler/i);
  });

  it("degrades empty frontpages and frontpages with only untimestamped candidates", async () => {
    const source = {
      id: "nidaros" as const,
      label: "Nidaros",
      url: "https://www.nidaros.no/",
      detailFetchLimit: 0,
      retainRegionalUnmatched: true,
    };

    await expect(
      collectFrontpage(source, async () => new Response("<html><main>Tom forside</main></html>")),
    ).rejects.toThrow(/ingen artikkelkandidater/i);

    await expect(
      collectFrontpage(
        source,
        async () =>
          new Response(
            '<a href="/hendelse/s/30-113-99999">Dette er en lang nok tittel om Trondheim</a>',
          ),
      ),
    ).rejects.toThrow(/ingen brukbare tidsstempler/i);
  });

  it("skips an untimestamped frontpage candidate while retaining a timestamped one", async () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@type":"NewsArticle","headline":"Brann i Trondheim sentrum","url":"/uten-tid"},
        {"@type":"NewsArticle","headline":"Vannlekkasje i Trondheim sentrum","url":"/med-tid","datePublished":"2026-05-26T12:15:00Z"}
      ]</script>
    </head></html>`;
    const articles = await collectFrontpage(
      {
        id: "nidaros",
        label: "Nidaros",
        url: "https://www.nidaros.no/",
        detailFetchLimit: 0,
        retainRegionalUnmatched: true,
      },
      async () => new Response(html),
    );

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://www.nidaros.no/med-tid");
    expect(articles[0]?.publishedAt).toBe("2026-05-26T12:15:00.000Z");
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

  it("does not invent municipal publication time when detail metadata is unusable", async () => {
    const listing = `
      <article class="card"><a href="/aktuelt/uten-tid/">Brann i Trondheim sentrum</a></article>
    `;

    await expect(
      collectMunicipality(
        async (url) =>
          new Response(String(url).includes("/uten-tid/") ? "<html>Ingen dato</html>" : listing),
      ),
    ).rejects.toThrow(/ingen brukbare tidsstempler/i);
  });

  it("skips an untimestamped municipal card while retaining a timestamped card", async () => {
    const listing = `
      <article class="card"><a href="/aktuelt/uten-tid/">Brann i Trondheim sentrum</a></article>
      <article class="card"><a href="/aktuelt/med-tid/">Vannlekkasje i Trondheim sentrum</a></article>
    `;
    const validDetail = '<meta property="article:published_time" content="26.05.2026 13:15:00">';
    const articles = await collectMunicipality(async (url) => {
      const value = String(url);
      if (value.includes("/med-tid/")) return new Response(validDetail);
      if (value.includes("/uten-tid/")) return new Response("<html>Ingen dato</html>");
      return new Response(listing);
    });

    expect(articles).toHaveLength(1);
    expect(articles[0]?.url).toBe("https://www.trondheim.kommune.no/aktuelt/med-tid/");
    expect(articles[0]?.publishedAt).toBe("2026-05-26T11:15:00.000Z");
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
