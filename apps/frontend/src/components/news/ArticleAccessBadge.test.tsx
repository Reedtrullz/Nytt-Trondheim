import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleAccessBadge } from "./ArticleAccessBadge.js";

describe("ArticleAccessBadge", () => {
  it("marks positively identified paid stories clearly", () => {
    const html = renderToStaticMarkup(<ArticleAccessBadge access="paid" />);

    expect(html).toContain("Pluss");
    expect(html).toContain("Krever abonnement hos kilden");
    expect(html).toContain("story-badge-paid");
  });

  it("stays silent when access is unknown", () => {
    expect(renderToStaticMarkup(<ArticleAccessBadge />)).toBe("");
  });
});
