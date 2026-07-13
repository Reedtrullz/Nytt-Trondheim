import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageSourceCluster } from "./CoverageSourceCluster.js";
import { clusteredHomeStoryCard } from "../../test-fixtures/homeStoryCards.js";

describe("CoverageSourceCluster", () => {
  it("shows explicit article/source counts and only two supporting rows by default", () => {
    const card = clusteredHomeStoryCard({ articleCount: 7, sourceCount: 5 });
    const html = renderToStaticMarkup(
      <CoverageSourceCluster card={card} canCorrect onCorrect={vi.fn()} />,
    );

    expect(html).toContain("7 saker fra 5 kilder");
    expect(html).toContain("Vis alle 7 saker fra 5 kilder");
    expect((html.match(/class="coverage-source-row/g) ?? []).length).toBe(2);
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
});
