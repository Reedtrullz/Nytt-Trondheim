import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { Article } from "@nytt/shared";
import { PgStore } from "../src/store.js";

describe("article store", () => {
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
  });
});
