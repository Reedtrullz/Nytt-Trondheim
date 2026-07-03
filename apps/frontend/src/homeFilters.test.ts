import { describe, expect, it } from "vitest";
import {
  articleCategories,
  articleCategoryIcons,
  articleCategoryLabels,
  articleTopicLabels,
  buildHomeSearch,
  homeTimeWindowFrom,
  parseHomeFilters,
  searchSummary,
} from "./homeFilters.js";

describe("home filter query params", () => {
  it("parses q, scope and category from a URL search string", () => {
    expect(parseHomeFilters("?q=bru&scope=trondelag&category=Transport")).toEqual({
      q: "bru",
      scope: "trondelag",
      category: "Transport",
      timeWindow: "all",
    });
  });

  it("falls back to safe defaults for unknown params", () => {
    expect(parseHomeFilters("?scope=bergen&category=Mat&q=%20%20")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Alle",
      timeWindow: "all",
    });
  });

  it("builds canonical search params without empty defaults", () => {
    expect(
      buildHomeSearch({ q: " bru ", scope: "trondheim", category: "Alle", timeWindow: "all" }),
    ).toBe("?q=bru");
    expect(
      buildHomeSearch({ q: "", scope: "trondelag", category: "Transport", timeWindow: "all" }),
    ).toBe("?scope=trondelag&category=Transport");
    expect(
      buildHomeSearch({ q: "", scope: "trondheim", category: "Krim", timeWindow: "all" }),
    ).toBe("?category=Krim");
    expect(
      buildHomeSearch({ q: "", scope: "trondheim", category: "Sport", timeWindow: "all" }),
    ).toBe("?category=Sport");
    expect(
      buildHomeSearch({
        q: "",
        scope: "trondheim",
        category: "Sport",
        topic: "rosenborg",
        timeWindow: "all",
      }),
    ).toBe("?category=Sport&topic=rosenborg");
    expect(
      buildHomeSearch({
        q: "",
        scope: "trondheim",
        category: "Alle",
        timeWindow: "24h",
      }),
    ).toBe("?window=24h");
  });

  it("keeps API category values separate from home filter labels", () => {
    expect(articleCategories).toEqual([
      "Alle",
      "Hendelser",
      "Krim",
      "Transport",
      "Sport",
      "Politikk",
      "Byutvikling",
      "Kultur",
      "Nyheter",
    ]);
    expect(articleCategoryLabels.Transport).toBe("Trafikk");
    expect(articleCategoryLabels.Krim).toBe("Krim");
    expect(articleCategoryLabels.Vær).toBe("Vær");
    expect(articleCategoryIcons.Transport).toBe("→");
    expect(articleCategoryIcons.Hendelser).toBe("!");
    expect(articleTopicLabels.rosenborg).toBe("Rosenborg");
    expect(parseHomeFilters("?category=Transport").category).toBe("Transport");
    expect(parseHomeFilters("?window=2h").timeWindow).toBe("2h");
    expect(parseHomeFilters("?window=old").timeWindow).toBe("all");
  });

  it("parses Rosenborg as a Sport subcategory only", () => {
    expect(parseHomeFilters("?category=Sport&topic=rosenborg")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Sport",
      timeWindow: "all",
      topic: "rosenborg",
    });
    expect(parseHomeFilters("?category=Sport&topic=unknown")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Sport",
      timeWindow: "all",
    });
    expect(parseHomeFilters("?category=Nyheter&topic=rosenborg")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Nyheter",
      timeWindow: "all",
    });
  });

  it("keeps Vær out of article category filters because it has its own page", () => {
    expect(articleCategories).not.toContain("Vær");
    expect(parseHomeFilters("?q=bru&scope=trondelag&category=V%C3%A6r")).toEqual({
      q: "bru",
      scope: "trondelag",
      category: "Alle",
      timeWindow: "all",
    });
  });

  it("summarizes active filters for empty states", () => {
    expect(
      searchSummary({ q: "bru", scope: "trondheim", category: "Alle", timeWindow: "all" }),
    ).toBe('"bru" i Trondheim');
    expect(
      searchSummary({ q: "", scope: "trondelag", category: "Transport", timeWindow: "24h" }),
    ).toBe("Trafikk siste 24 timer i Trøndelag");
    expect(searchSummary({ q: "", scope: "trondheim", category: "Krim", timeWindow: "all" })).toBe(
      "Krim i Trondheim",
    );
    expect(
      searchSummary({ q: "RBK", scope: "trondheim", category: "Sport", timeWindow: "all" }),
    ).toBe('"RBK" Sport i Trondheim');
    expect(
      searchSummary({
        q: "",
        scope: "trondheim",
        category: "Sport",
        topic: "rosenborg",
        timeWindow: "all",
      }),
    ).toBe("Rosenborg Sport i Trondheim");
  });

  it("converts public time windows to stable API lower bounds", () => {
    const now = new Date("2026-07-02T10:00:00.000Z");

    expect(homeTimeWindowFrom("all", now)).toBeUndefined();
    expect(homeTimeWindowFrom("2h", now)).toBe("2026-07-02T08:00:00.000Z");
    expect(homeTimeWindowFrom("24h", now)).toBe("2026-07-01T10:00:00.000Z");
    expect(homeTimeWindowFrom("7d", now)).toBe("2026-06-25T10:00:00.000Z");
  });
});
