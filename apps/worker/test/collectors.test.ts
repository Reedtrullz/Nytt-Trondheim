import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("DATEX official source probe", () => {
  it("waits for Basic Auth credentials when DATEX username and password are missing", async () => {
    const statuses = await probeOfficialSources(async () => new Response("ok", { status: 200 }));

    const datex = statuses.find((status) => status.source === "datex");

    expect(datex).toMatchObject({
      label: "Vegvesen DATEX",
      state: "awaiting_access",
      detail: "Venter på DATEX Basic Auth-brukernavn og passord",
    });
  });

  it("checks the DATEX endpoint with Basic Auth when username and password are configured", async () => {
    process.env.DATEX_ENDPOINT =
      "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata";
    process.env.DATEX_USERNAME = "svv-user";
    process.env.DATEX_PASSWORD = "svv-pass";
    let datexAuthorization: string | undefined;

    const statuses = await probeOfficialSources(async (url, init) => {
      if (String(url).includes("GetSituation")) {
        const headers = new Headers(init?.headers);
        datexAuthorization = headers.get("Authorization") ?? undefined;
      }
      return new Response("ok", { status: 200 });
    });

    const datex = statuses.find((status) => status.source === "datex");

    expect(datexAuthorization).toBe("Basic c3Z2LXVzZXI6c3Z2LXBhc3M=");
    expect(datex).toMatchObject({
      label: "Vegvesen DATEX",
      state: "ok",
      detail: "Tilgang konfigurert og testet mot DATEX GetSituation",
    });
  });
});
