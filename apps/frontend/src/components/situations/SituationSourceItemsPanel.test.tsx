import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SourceItem } from "@nytt/shared";
import { SituationSourceItemsPanel } from "./SituationSourceItemsPanel.js";

function sourceItem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "source:nrk:one",
    provider: "nrk",
    kind: "article",
    title: "Røykutvikling ved Flatåsen",
    summary: "Nødetatene rykket ut etter melding om røyk.",
    originalUrl: "https://example.test/source",
    fetchedAt: "2026-07-02T10:00:00.000Z",
    captureHash: "capture-hash",
    reliabilityTier: "trusted_media",
    linkedSituationIds: [],
    ...overrides,
  };
}

describe("SituationSourceItemsPanel", () => {
  const noop = () => undefined;

  it("renders owner source item search, relationship selection, linking, and unlinking controls", () => {
    const html = renderToStaticMarkup(
      <SituationSourceItemsPanel
        sourceItems={[
          sourceItem({
            id: "linked",
            title: "Koblet politimelding",
            provider: "politiloggen",
            relationship: "supports",
            linkedSituationIds: ["situation-one"],
          }),
        ]}
        loading={false}
        canManage={true}
        search="Flatåsen"
        relationship="context"
        candidates={[
          sourceItem({
            id: "candidate",
            title: "Mulig kildeelement",
            relationship: undefined,
          }),
        ]}
        candidatesLoading={false}
        onRetry={noop}
        onSearchChange={noop}
        onRelationshipChange={noop}
        onLoadCandidates={noop}
        onLink={noop}
        onUnlink={noop}
      />,
    );

    expect(html).toContain("Søk i kildeelementer");
    expect(html).toContain("Kontekst");
    expect(html).toContain("Mulige kildeelementer");
    expect(html).toContain("Koble");
    expect(html).toContain("Koble fra");
    expect(html).toContain("Kontekst- og telemetrikilder");
  });

  it("keeps source item mutation controls hidden for read-only viewers", () => {
    const html = renderToStaticMarkup(
      <SituationSourceItemsPanel
        sourceItems={[
          sourceItem({ relationship: "context", linkedSituationIds: ["situation-one"] }),
        ]}
        loading={false}
        canManage={false}
        search=""
        relationship="supports"
        candidates={[]}
        candidatesLoading={false}
        onRetry={noop}
        onSearchChange={noop}
        onRelationshipChange={noop}
        onLoadCandidates={noop}
        onLink={noop}
        onUnlink={noop}
      />,
    );

    expect(html).toContain("Røykutvikling ved Flatåsen");
    expect(html).toContain("Kontekst");
    expect(html).not.toContain("Søk i kildeelementer");
    expect(html).not.toContain("Koble fra");
  });

  it("shows loading and error states without exposing raw payloads", () => {
    const html = renderToStaticMarkup(
      <SituationSourceItemsPanel
        sourceItems={[]}
        loading={false}
        error="Nettverksfeil"
        canManage={true}
        search=""
        relationship="supports"
        candidates={[]}
        candidatesLoading={false}
        candidatesError="Søk feilet"
        onRetry={vi.fn()}
        onSearchChange={noop}
        onRelationshipChange={noop}
        onLoadCandidates={noop}
        onLink={noop}
        onUnlink={noop}
      />,
    );

    expect(html).toContain("Kunne ikke søke kildeelementer");
    expect(html).toContain("Kunne ikke hente kildegrunnlag");
    expect(html).not.toContain("rawPayload");
    expect(html).not.toContain("normalizedPayload");
  });
});
