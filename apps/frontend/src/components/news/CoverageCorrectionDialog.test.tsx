import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CoverageCorrectionDialog,
  coverageCorrectionSplitInput,
} from "./CoverageCorrectionDialog.js";
import { clusteredHomeStoryCard } from "../../test-fixtures/homeStoryCards.js";

describe("CoverageCorrectionDialog", () => {
  it("renders anchor, selectable supporting stories, and a bounded optional reason", () => {
    const html = renderToStaticMarkup(
      <CoverageCorrectionDialog
        card={clusteredHomeStoryCard({ articleCount: 3, sourceCount: 3 })}
        pending={false}
        error={undefined}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Behold som hovedsak");
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Splitt nå");
  });

  it("disables all mutation controls while pending", () => {
    const html = renderToStaticMarkup(
      <CoverageCorrectionDialog
        card={clusteredHomeStoryCard({ articleCount: 2, sourceCount: 2 })}
        pending
        error={undefined}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain("Splitter…");
    expect(html).toContain("disabled");
  });

  it("renders an actionable error without closing the dialog", () => {
    const html = renderToStaticMarkup(
      <CoverageCorrectionDialog
        card={clusteredHomeStoryCard({ articleCount: 2, sourceCount: 2 })}
        pending={false}
        error="Kunne ikke splitte gruppen."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Kunne ikke splitte gruppen.");
  });

  it("carries the stable original target separately from the effective displayed bundle", () => {
    const card = clusteredHomeStoryCard({ articleCount: 3, sourceCount: 3 });
    card.group.bundle = {
      ...card.group.bundle!,
      id: "coverage:effective-derived",
      correctionTarget: {
        originalBundleId: "coverage:stable-original",
        projectionRevision: 4,
      },
    };
    const bundle = card.group.bundle;

    expect(coverageCorrectionSplitInput(card, ["cluster-article-2"], "Feil sted")).toEqual({
      expectedGeneratedAt: bundle.generatedAt,
      expectedProjectionRevision: 4,
      originalBundleId: "coverage:stable-original",
      anchorArticleId: card.primary.id,
      rejectedArticleIds: ["cluster-article-2"],
      reason: "Feil sted",
    });
    expect(bundle.id).toBe("coverage:effective-derived");
  });
});
