import { describe, expect, it } from "vitest";
import {
  articleCategories,
  articleCategoryLabels,
  articleTopicLabels,
  buildHomeSearch,
  parseHomeFilters,
  searchSummary,
} from "./homeFilters.js";

describe("home filter query params", () => {
  it("parses q, scope and category from a URL search string", () => {
    expect(parseHomeFilters("?q=bru&scope=trondelag&category=Transport")).toEqual({
      q: "bru",
      scope: "trondelag",
      category: "Transport",
    });
  });

  it("falls back to safe defaults for unknown params", () => {
    expect(parseHomeFilters("?scope=bergen&category=Mat&q=%20%20")).toEqual({
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
    expect(buildHomeSearch({ q: "", scope: "trondheim", category: "Krim" })).toBe("?category=Krim");
    expect(buildHomeSearch({ q: "", scope: "trondheim", category: "Sport" })).toBe(
      "?category=Sport",
    );
    expect(
      buildHomeSearch({
        q: "",
        scope: "trondheim",
        category: "Sport",
        topic: "rosenborg",
      }),
    ).toBe("?category=Sport&topic=rosenborg");
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
    expect(articleTopicLabels.rosenborg).toBe("Rosenborg");
    expect(parseHomeFilters("?category=Transport").category).toBe("Transport");
  });

  it("parses Rosenborg as a Sport subcategory only", () => {
    expect(parseHomeFilters("?category=Sport&topic=rosenborg")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Sport",
      topic: "rosenborg",
    });
    expect(parseHomeFilters("?category=Sport&topic=unknown")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Sport",
    });
    expect(parseHomeFilters("?category=Nyheter&topic=rosenborg")).toEqual({
      q: "",
      scope: "trondheim",
      category: "Nyheter",
    });
  });

  it("keeps Vær out of article category filters because it has its own page", () => {
    expect(articleCategories).not.toContain("Vær");
    expect(parseHomeFilters("?q=bru&scope=trondelag&category=V%C3%A6r")).toEqual({
      q: "bru",
      scope: "trondelag",
      category: "Alle",
    });
  });

  it("summarizes active filters for empty states", () => {
    expect(searchSummary({ q: "bru", scope: "trondheim", category: "Alle" })).toBe(
      '"bru" i Trondheim',
    );
    expect(searchSummary({ q: "", scope: "trondelag", category: "Transport" })).toBe(
      "Trafikk i Trøndelag",
    );
    expect(searchSummary({ q: "", scope: "trondheim", category: "Krim" })).toBe("Krim i Trondheim");
    expect(searchSummary({ q: "RBK", scope: "trondheim", category: "Sport" })).toBe(
      '"RBK" Sport i Trondheim',
    );
    expect(
      searchSummary({ q: "", scope: "trondheim", category: "Sport", topic: "rosenborg" }),
    ).toBe("Rosenborg Sport i Trondheim");
  });
});
