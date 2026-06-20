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
});
