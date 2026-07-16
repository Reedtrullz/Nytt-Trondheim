import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageSourceCluster } from "./CoverageSourceCluster.js";
import { clusteredHomeStoryCard } from "../../test-fixtures/homeStoryCards.js";

describe("CoverageSourceCluster", () => {
  it("labels the supporting rows explicitly and only shows two by default", () => {
    const card = clusteredHomeStoryCard({ articleCount: 7, sourceCount: 5 });
    const html = renderToStaticMarkup(
      <CoverageSourceCluster card={card} canCorrect onCorrect={vi.fn()} />,
    );

    expect(html).toContain("6 andre saker fra 5 kilder");
    expect(html).toContain("Vis alle 6 andre saker fra 5 kilder");
    expect((html.match(/class="coverage-source-row/g) ?? []).length).toBe(2);
    expect(html).toContain('data-article-id="cluster-article-2"');
    expect(html).toContain('data-article-id="cluster-article-3"');
    expect(html).toContain("Felles tema og kamp");
    expect(html).toContain("Feil gruppering?");
  });

  it("does not expose the correction action without owner capability", () => {
    const html = renderToStaticMarkup(
      <CoverageSourceCluster
        card={clusteredHomeStoryCard({ articleCount: 3, sourceCount: 3 })}
        canCorrect={false}
        onCorrect={vi.fn()}
      />,
    );

    expect(html).toContain("2 andre saker fra 2 kilder");
    expect(html).not.toContain("Feil gruppering?");
  });

  it("does not render for a singleton story", () => {
    const html = renderToStaticMarkup(
      <CoverageSourceCluster
        card={clusteredHomeStoryCard({ articleCount: 1, sourceCount: 1 })}
        canCorrect
        onCorrect={vi.fn()}
      />,
    );

    expect(html).toBe("");
  });

  it("marks a paid supporting source without describing unknown rows as free", () => {
    const card = clusteredHomeStoryCard({ articleCount: 3, sourceCount: 3 });
    card.group.articles[1] = { ...card.group.articles[1]!, access: "paid" };
    const html = renderToStaticMarkup(
      <CoverageSourceCluster card={card} canCorrect={false} onCorrect={vi.fn()} />,
    );

    expect(html).toContain("Pluss");
    expect((html.match(/story-badge-paid/g) ?? []).length).toBe(1);
    expect(html).toContain("Krever abonnement hos kilden");
    expect(html).not.toContain("Gratis");
  });
});
