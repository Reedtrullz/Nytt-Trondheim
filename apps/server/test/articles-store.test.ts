import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Article, OfficialEvent, Situation } from "@nytt/shared";
import { MemoryStore, PgStore } from "../src/store.js";

describe("article store", () => {
  it("filters in-memory articles by published time window like production", async () => {
    const store = new MemoryStore();

    const page = await store.listArticles({
      from: "2026-05-26T09:00:00.000Z",
      to: "2026-05-26T10:00:00.000Z",
      limit: 10,
    });

    expect(page.items.map((article) => article.id)).toEqual(["a-sluppen", "a-road"]);
  });

  it("searches production articles by place metadata, source label, and category", async () => {
    const article: Article = {
      id: "flatåsen-smoke",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Rykka ut etter røykutvikling",
      excerpt: "Nødetatene undersøker røyk fra en bygning.",
      url: "https://example.test/flatåsen-smoke",
      publishedAt: "2026-06-18T10:50:00.000Z",
      scope: "trondheim",
      category: "Hendelser",
      places: ["Flatåsen", "Trondheim"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["flatåsen-smoke"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("FROM articles a");
      expect(normalized).toContain("a.payload->>'title' ILIKE $2");
      expect(normalized).toContain("a.payload->>'excerpt' ILIKE $2");
      expect(normalized).toContain("a.payload->>'sourceLabel' ILIKE $2");
      expect(normalized).toContain("a.category ILIKE $2");
      expect(normalized).toContain("jsonb_array_elements_text");
      expect(params).toEqual(["Reedtrullz", "%Flatåsen%", 41]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ q: "Flatåsen" }, "Reedtrullz");

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(page.nextCursor).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("filters production articles by Rosenborg topic without requiring a category migration", async () => {
    const article: Article = {
      id: "rosenborg-trener",
      source: "vg",
      sourceLabel: "VG",
      title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
      excerpt: "Han er presentert som Rosenborgs nye trener.",
      url: "https://example.test/rosenborg",
      publishedAt: "2026-06-18T09:34:00.000Z",
      scope: "trondheim",
      category: "Sport",
      topics: ["rosenborg"],
      places: ["Rosenborg"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["rosenborg-trener"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("COALESCE(a.payload->'topics', '[]'::jsonb) ? $3");
      expect(normalized).toContain("NOT (a.payload ? 'topics')");
      expect(normalized).toContain("a.category = 'Sport'");
      expect(normalized).toContain("a.payload->>'title' ILIKE '%rbk%'");
      expect(params).toEqual(["Reedtrullz", "Sport", "rosenborg", 41]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ category: "Sport", topic: "rosenborg" }, "Reedtrullz");

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("filters production articles by published time window before pagination", async () => {
    const article: Article = {
      id: "recent-crash",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      title: "Trafikkuhell på E6",
      excerpt: "Et trafikkuhell skaper kø på E6.",
      url: "https://example.test/recent-crash",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["recent-crash"]]);
        return { rows: [] };
      }
      const normalized = sql.replace(/\s+/g, " ").trim();
      expect(normalized).toContain("a.published_at >= $2");
      expect(normalized).toContain("a.published_at <= $3");
      expect(normalized).toContain("ORDER BY a.published_at DESC, a.id DESC LIMIT $4");
      expect(params).toEqual([
        "Reedtrullz",
        "2026-07-02T07:00:00.000Z",
        "2026-07-02T10:00:00.000Z",
        11,
      ]);
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles(
      {
        from: "2026-07-02T07:00:00.000Z",
        to: "2026-07-02T10:00:00.000Z",
        limit: 10,
      },
      "Reedtrullz",
    );

    expect(page.items).toEqual([{ ...article, saved: false }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("adds DATEX public verification and situation links to related production articles", async () => {
    const article: Article = {
      id: "article-road",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6",
      excerpt: "En kollisjon gjør at E6 er stengt.",
      url: "https://example.test/e6",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const situation: Situation = {
      id: "datex-e6",
      type: "traffic",
      title: "Kollisjon på E6",
      summary: "DATEX melder om stengt veg.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      updatedAt: "2026-07-02T09:40:00.000Z",
      createdAt: "2026-07-02T09:20:00.000Z",
      locationLabel: "E6",
      officialSource: "datex",
      officialEventId: "datex-e6",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: "2026-07-02T09:20:00.000Z",
      },
      relatedArticleIds: ["article-road"],
      evidence: [
        {
          id: "datex-evidence",
          situationId: "datex-e6",
          source: "datex",
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: "https://example.test/datex",
          supportingSnippet: "Stengt veg",
          claim: "E6 er stengt",
          claimType: "official_traffic_status",
          provenance: "official",
          confidence: 1,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:20:00.000Z",
        },
        {
          id: "article-evidence",
          situationId: "datex-e6",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/e6",
          supportingSnippet: "En kollisjon gjør at E6 er stengt.",
          claim: "Kollisjon stenger E6",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:34:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["article-road"]]);
        return { rows: [{ payload: situation }] };
      }
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road",
      saved: false,
      situationId: "datex-e6",
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
        officialSources: ["datex"],
        reportingSources: ["adressa"],
        situationId: "datex-e6",
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("adds Politiloggen public verification and situation links to related production articles", async () => {
    const article: Article = {
      id: "article-lade-violence",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Ung mann kritisk skadd på Lade",
      excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
      url: "https://example.test/lade-vold",
      publishedAt: "2026-07-02T18:59:00.000Z",
      scope: "trondheim",
      category: "Krim",
      places: ["Lade", "Trondheim"],
    };
    const situation: Situation = {
      id: "politiloggen-lade-vold",
      type: "other",
      title: "Voldshendelse på Lade",
      summary: "Politiloggen omtaler en voldshendelse på Lade.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "normal",
      updatedAt: "2026-07-02T19:05:00.000Z",
      createdAt: "2026-07-02T18:34:00.000Z",
      locationLabel: "Lade",
      officialSource: "politiloggen",
      officialEventId: "lade-vold",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["politiloggen"],
        articleIds: ["politiloggen-lade-vold"],
        activatedAt: "2026-07-02T18:34:00.000Z",
      },
      relatedArticleIds: ["politiloggen-lade-vold", "article-lade-violence"],
      evidence: [
        {
          id: "politiloggen-evidence",
          situationId: "politiloggen-lade-vold",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          sourceUrl: "https://example.test/politiloggen/lade-vold",
          supportingSnippet: "Voldshendelse: Trondheim, Lade",
          claim: "Politiet undersøker voldshendelse på Lade",
          claimType: "official_police_log",
          provenance: "official",
          confidence: 1,
          extractedAt: "2026-07-02T19:05:00.000Z",
          publishedAt: "2026-07-02T18:34:00.000Z",
        },
        {
          id: "article-lade-evidence",
          situationId: "politiloggen-lade-vold",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/lade-vold",
          supportingSnippet: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
          claim: "Ung mann kritisk skadd på Lade",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T19:05:00.000Z",
          publishedAt: "2026-07-02T18:59:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (query.mock.calls.length > 1) {
        expect(sql).toContain("FROM situations");
        expect(params).toEqual([["article-lade-violence"]]);
        return { rows: [{ payload: situation }] };
      }
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-lade-violence",
      saved: false,
      situationId: "politiloggen-lade-vold",
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Politiloggen og Adresseavisen.",
        officialSources: ["politiloggen"],
        reportingSources: ["adressa"],
        situationId: "politiloggen-lade-vold",
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("adds DATEX public verification to matching traffic articles without requiring a situation link", async () => {
    const article: Article = {
      id: "article-road-official-match",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6 ved Sluppen",
      excerpt: "En kollisjon gjør at E6 er stengt ved Sluppen.",
      url: "https://example.test/e6-sluppen",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6", "Sluppen"],
      location: { lat: 63.3978, lng: 10.3995, label: "Sluppen" },
    };
    const geometry: OfficialEvent["geometry"] = {
      type: "Point",
      coordinates: [10.3995, 63.3978],
    };
    const officialEvent: OfficialEvent = {
      id: "datex-e6-sluppen",
      source: "datex",
      eventType: "traffic",
      title: "Kollisjon på E6 ved Sluppen",
      detail: "E6 er stengt etter trafikkulykke.",
      sourceUrl: "https://example.test/datex/e6-sluppen",
      areaLabel: "Sluppen",
      state: "active",
      severity: "high",
      publishedAt: "2026-07-02T09:30:00.000Z",
      validFrom: "2026-07-02T09:20:00.000Z",
      validTo: "2026-07-02T12:00:00.000Z",
      geometry,
      raw: {
        datex: {
          recordKind: "Accident",
          roadName: "E6",
        },
      },
    };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM situations")) {
        expect(params).toEqual([["article-road-official-match"]]);
        return { rows: [] };
      }
      if (sql.includes("FROM official_events")) {
        expect(params).toEqual(["datex", 500]);
        return { rows: [{ payload: officialEvent, state: "active", geometry }] };
      }
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road-official-match",
      saved: false,
      publicVerification: {
        status: "verified",
        label: "Verifisert",
        detail: "Bekreftet av Statens vegvesen DATEX og Adresseavisen.",
        officialSources: ["datex"],
        reportingSources: ["adressa"],
      },
    });
    expect(page.items[0]?.situationId).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not add a public verification badge without official DATEX evidence", async () => {
    const article: Article = {
      id: "article-road-unverified",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6",
      excerpt: "En kollisjon gjør at E6 er stengt.",
      url: "https://example.test/e6",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const situation: Situation = {
      id: "datex-e6-unverified",
      type: "traffic",
      title: "Kollisjon på E6",
      summary: "DATEX melder om stengt veg.",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      importance: "high",
      updatedAt: "2026-07-02T09:40:00.000Z",
      createdAt: "2026-07-02T09:20:00.000Z",
      locationLabel: "E6",
      officialSource: "datex",
      officialEventId: "datex-e6-unverified",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: "2026-07-02T09:20:00.000Z",
      },
      relatedArticleIds: ["article-road-unverified"],
      evidence: [
        {
          id: "article-evidence",
          situationId: "datex-e6-unverified",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/e6",
          supportingSnippet: "En kollisjon gjør at E6 er stengt.",
          claim: "Kollisjon stenger E6",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:34:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async () => {
      if (query.mock.calls.length > 1) return { rows: [{ payload: situation }] };
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road-unverified",
      situationId: "datex-e6-unverified",
    });
    expect(page.items[0]?.publicVerification).toBeUndefined();
  });

  it("does not add a public verification badge before the linked situation is officially verified", async () => {
    const article: Article = {
      id: "article-road-preliminary",
      source: "adressa",
      sourceLabel: "Adresseavisen",
      title: "Kollisjon stenger E6",
      excerpt: "En kollisjon gjør at E6 er stengt.",
      url: "https://example.test/e6",
      publishedAt: "2026-07-02T09:34:00.000Z",
      scope: "trondheim",
      category: "Transport",
      places: ["E6"],
    };
    const situation: Situation = {
      id: "datex-e6-preliminary",
      type: "traffic",
      title: "Kollisjon på E6",
      summary: "DATEX melder om stengt veg.",
      status: "preliminary",
      verificationStatus: "Foreløpig fra rapportering",
      importance: "medium",
      updatedAt: "2026-07-02T09:40:00.000Z",
      createdAt: "2026-07-02T09:20:00.000Z",
      locationLabel: "E6",
      officialSource: "datex",
      officialEventId: "datex-e6-preliminary",
      activationBasis: {
        rule: "official_source",
        sourceIds: ["datex"],
        articleIds: [],
        activatedAt: "2026-07-02T09:20:00.000Z",
      },
      relatedArticleIds: ["article-road-preliminary"],
      evidence: [
        {
          id: "datex-evidence",
          situationId: "datex-e6-preliminary",
          source: "datex",
          sourceLabel: "Statens vegvesen DATEX",
          sourceUrl: "https://example.test/datex",
          supportingSnippet: "Stengt veg",
          claim: "E6 er stengt",
          claimType: "official_traffic_status",
          provenance: "official",
          confidence: 1,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:20:00.000Z",
        },
        {
          id: "article-evidence",
          situationId: "datex-e6-preliminary",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          sourceUrl: "https://example.test/e6",
          supportingSnippet: "En kollisjon gjør at E6 er stengt.",
          claim: "Kollisjon stenger E6",
          claimType: "reporting_match",
          provenance: "reporting_estimate",
          confidence: 0.72,
          extractedAt: "2026-07-02T09:40:00.000Z",
          publishedAt: "2026-07-02T09:34:00.000Z",
        },
      ],
      features: [],
      timeline: [],
    };
    const query = vi.fn(async () => {
      if (query.mock.calls.length > 1) return { rows: [{ payload: situation }] };
      return { rows: [{ payload: article, saved: false }] };
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listArticles({ limit: 10 }, "Reedtrullz");

    expect(page.items[0]).toMatchObject({
      id: "article-road-preliminary",
      situationId: "datex-e6-preliminary",
    });
    expect(page.items[0]?.publicVerification).toBeUndefined();
  });
});
