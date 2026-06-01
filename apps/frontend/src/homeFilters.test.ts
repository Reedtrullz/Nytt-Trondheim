import { describe, expect, it } from "vitest";
import {
  articleCategories,
  buildHomeSearch,
  parseHomeFilters,
  searchSummary,
} from "./homeFilters.js";

describe("home filter query params", () => {
  it("parses q, scope and category from a URL search string", () => {
    expect(parseHomeFilters("?q=bru&scope=trondelag&category=V%C3%A6r")).toEqual({
      q: "bru",
      scope: "trondelag",
      category: "Vær",
    });
  });

  it("falls back to safe defaults for unknown params", () => {
    expect(parseHomeFilters("?scope=bergen&category=Sport&q=%20%20")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Alle",
    });
  });

  it("builds canonical search params without empty defaults", () => {
    expect(buildHomeSearch({ q: " bru ", scope: "trondheim", category: "Alle" })).toBe("?q=bru");
    expect(buildHomeSearch({ q: "", scope: "trondelag", category: "Transport" })).toBe(
      "?scope=trondelag&category=Transport",
    );
  });

  it("includes the Vær category", () => {
    expect(articleCategories).toContain("Vær");
  });

  it("summarizes active filters for empty states", () => {
    expect(searchSummary({ q: "bru", scope: "trondheim", category: "Alle" })).toBe(
      '"bru" i Trondheim',
    );
    expect(searchSummary({ q: "", scope: "trondelag", category: "Vær" })).toBe("Vær i Trøndelag");
  });
});
