import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CoverageBundlePage } from "@nytt/shared";
import { CoverageCorrectionConflictError } from "../api.js";
import {
  CoverageBundlesDashboard,
  coverageQueryFromFilters,
  coverageReviewFilteredItems,
  coverageWorkspaceFilters,
  coverageWorkspaceSearch,
  groupedCoverageReviewCandidates,
  splitCoverageBundleAndRefresh,
  undoCoverageCorrectionAndRefresh,
} from "./CoverageBundlesPage.js";

const page: CoverageBundlePage = {
  correctionsEnabled: true,
  summary: {
    recentBundleCount: 1,
    byKind: { incident: 1, topic: 0, update: 0 },
    byConfidence: { high: 1, medium: 0 },
    latestGeneratedAt: "2026-06-18T10:55:00.000Z",
    activeBundleCount: 1,
    byMatchTier: { strong: 1, moderate: 0 },
    reviewCandidateCount: 1,
    activeCorrectionCount: 1,
    integrityErrorCount: 0,
    matcherVersion: "v2",
    projectionState: "shadow",
    generation: {
      id: "coverage-generation-shadow-1",
      matcherVersion: "v2",
      mode: "shadow",
      status: "completed",
      startedAt: "2026-06-18T10:54:00.000Z",
      completedAt: "2026-06-18T10:55:00.000Z",
      articleCount: 3,
      bundleCount: 1,
      edgeCount: 2,
      correctionConflictCount: 0,
    },
  },
  items: [
    {
      id: "coverage:flatåsen-smoke",
      kind: "incident",
      confidence: "high",
      reason: "Samme hendelse på tvers av kilder",
      generatedAt: "2026-06-18T10:55:00.000Z",
      matcherVersion: "v2",
      matchConfidence: {
        tier: "strong",
        score: 0.91,
        rationale: "Alle støttesakene har et sterkt direkte treff med hovedsaken.",
      },
      lastSeenAt: "2026-06-18T10:55:00.000Z",
      updatedAt: "2026-06-18T10:55:30.000Z",
      primaryArticleId: "nrk-flatåsen-smoke",
      memberArticleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
      sourceIds: ["nrk", "politiloggen"],
      sourceLabels: ["NRK Trøndelag", "Politiloggen"],
      memberArticles: [
        {
          id: "nrk-flatåsen-smoke",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          title: "Rykka til Flatåsen etter røykutvikling",
          excerpt: "Nødetatene har rykka til Flatåsen.",
          url: "https://example.test/nrk-flatåsen-smoke",
          publishedAt: "2026-06-18T10:50:00.000Z",
          category: "Hendelser",
          places: ["Flatåsen", "Trondheim"],
        },
        {
          id: "politiloggen-flatåsen-smoke",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Brann: Trondheim",
          excerpt: "Nødetatene rykker til Øvre Flatåsveg.",
          url: "https://example.test/politiloggen-flatåsen-smoke",
          publishedAt: "2026-06-18T10:48:00.000Z",
          category: "Hendelser",
          places: ["Flatåsen", "Trondheim"],
        },
      ],
      signals: [
        {
          kind: "generic_place_incident",
          articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
          detail: "brann",
          overlap: 4,
          score: 0.42,
        },
      ],
      nearMisses: [
        {
          articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
          reason: "conflicting_specific_places",
          overlap: 3,
          score: 0.24,
        },
      ],
      nearMissArticles: [
        {
          id: "adressa-other-smoke",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Røykmelding ved Heimdal",
          excerpt: "Nødetatene undersøker røyk ved Heimdal.",
          url: "https://example.test/adressa-other-smoke",
          publishedAt: "2026-06-18T10:49:00.000Z",
          category: "Hendelser",
          places: ["Heimdal", "Trondheim"],
        },
      ],
      generation: {
        id: "coverage-generation-shadow-1",
        matcherVersion: "v2",
        mode: "shadow",
        status: "completed",
        startedAt: "2026-06-18T10:54:00.000Z",
        completedAt: "2026-06-18T10:55:00.000Z",
        articleCount: 3,
        bundleCount: 1,
        edgeCount: 2,
        correctionConflictCount: 0,
      },
      state: "shadow",
      edges: [
        {
          articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
          tier: "strong",
          score: 0.91,
          kind: "incident",
          positiveIncidentEvidence: ["same_situation_id", "shared_specific_place"],
          signals: [
            {
              kind: "situation_id",
              articleIds: ["nrk-flatåsen-smoke", "politiloggen-flatåsen-smoke"],
            },
          ],
          conflicts: [],
          evidenceFingerprint: "v2:accepted-flatåsen",
          reviewable: false,
          correctionConflict: false,
        },
      ],
      reviewCandidates: [
        {
          articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
          tier: "weak",
          score: 0.24,
          kind: "incident",
          positiveIncidentEvidence: [],
          signals: [
            {
              kind: "generic_place_incident",
              articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
              overlap: 3,
            },
          ],
          conflicts: [
            {
              kind: "specific_place",
              articleIds: ["nrk-flatåsen-smoke", "adressa-other-smoke"],
              detail: "Flatåsen og Heimdal",
            },
          ],
          evidenceFingerprint: "v2:review-flatåsen-heimdal",
          reviewable: true,
          correctionConflict: false,
        },
      ],
      corrections: [
        {
          id: "correction-flatåsen-1",
          anchorArticleId: "nrk-flatåsen-smoke",
          rejectedArticleId: "politiloggen-flatåsen-smoke",
          status: "active",
          createdAt: "2026-06-18T10:56:00.000Z",
        },
      ],
      integrityErrors: [],
    },
  ],
  parity: {
    legacyBundleCount: 1,
    normalizedBundleCount: 1,
    membershipMismatchCount: 0,
    primaryMismatchCount: 0,
    clean: true,
  },
};

describe("CoverageBundlesDashboard", () => {
  it("reflects the server-selected projection when the route omitted it", () => {
    const activePage = {
      ...page,
      selectedProjection: "active" as const,
      summary: { ...page.summary, projectionState: "active" as const },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={activePage}
          filters={{ projection: "shadow", projectionDefaulted: true }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('<option value="active" selected="">Aktiv v2-visning</option>');
    expect(html).toContain('<p class="label">Aktiv v2-visning</p>');
  });

  it("renders bundle summary, rows and detail drawer", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={page}
          filters={{ projection: "shadow" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Dekningsgrupper");
    expect(html).toContain("Samme hendelse på tvers av kilder");
    expect(html).toContain("NRK Trøndelag");
    expect(html).toContain("Politiloggen");
    expect(html).toContain("Generisk steds-hendelse");
    expect(html).toContain("Konflikt i spesifikt sted");
    expect(html).toContain("3 treff");
    expect(html).toContain("24 %");
    expect(html).toContain("NRK Trøndelag: Rykka til Flatåsen etter røykutvikling");
    expect(html).toContain("Adresseavisen: Røykmelding ved Heimdal");
    expect(html).toContain("Rykka til Flatåsen etter røykutvikling");
    expect(html).toContain("/command/tidslinje");
    expect(html).toContain("/command/kilder");
    expect(html).toContain("Aktive grupper");
    expect(html).toContain("Sterke treff");
    expect(html).toContain("Moderate treff");
    expect(html).toContain("Til vurdering");
    expect(html).toContain("Aktive korrigeringer");
    expect(html).toContain("Dataintegritet");
    expect(html).toContain("Lagringskontroll bestått");
    expect(html).toContain("Svakeste godkjente treff");
    expect(html).toContain("Vis 1 nesten-treff");
    expect(html).toContain("Splitt gruppe");
    expect(html).toContain("Feil samling");
    expect(html).toContain("Manglende samling");
    expect(html).toContain("Gjennomgå og anonymiser eksportene før de legges i testkorpuset.");
    expect(html).toContain("Angre");
    expect(html).toContain('data-generation-id="coverage-generation-shadow-1"');
    expect(html).toContain('data-primary-article-id="nrk-flatåsen-smoke"');
    expect(html).toContain('data-article-id="nrk-flatåsen-smoke"');
    expect(html).toContain('data-article-id="politiloggen-flatåsen-smoke"');
    expect(html).toContain("Gjennomgang i serverens kanoniske utvalg");
    expect(html).toContain("Svake kandidater");
    expect(html).toContain("Mangler positivt stedsbevis");
    expect(html).toContain("Mangler positivt entitetsbevis");
    expect(html).toContain("Mangler sterk offisiell verifisering");
  });

  it("marks retained rows busy and locks decisions while a refresh is pending", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={page}
          filters={{ projection: "shadow" }}
          dataState="refreshing"
          onFiltersChange={vi.fn()}
          onSplit={vi.fn()}
          onUndo={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Oppdaterer dekningsgrupper");
    expect(html).toContain("Beholdte data vises mens den nye visningen hentes");
    expect(html).toMatch(/data-coverage-bundle-row[^>]*disabled/);
    expect(html).toMatch(/class="coverage-bundle-mutation"[^>]*disabled/);
    expect(html).toMatch(/disabled=""[^>]*>Angre<\/button>/);
  });

  it("labels retained rows stale, locks decisions and offers a retry after refresh failure", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={page}
          filters={{ projection: "shadow" }}
          dataState="stale"
          visibleError="Tjenesten svarte ikke."
          onRetry={vi.fn()}
          onFiltersChange={vi.fn()}
          onSplit={vi.fn()}
          onUndo={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Viser sist hentede data");
    expect(html).toContain("Handlinger er låst til nye data er hentet");
    expect(html).toContain("Tjenesten svarte ikke.");
    expect(html).toContain("Prøv igjen");
    expect(html).toMatch(/data-coverage-bundle-row[^>]*disabled/);
    expect(html).toMatch(/class="coverage-bundle-mutation"[^>]*disabled/);
  });

  it("offers one honest superseded generation projection without mutation controls", () => {
    const supersededPage: CoverageBundlePage = {
      ...page,
      selectedProjection: "superseded",
      correctionsEnabled: true,
      summary: { ...page.summary, projectionState: "superseded" },
      items: [{ ...page.items[0]!, state: "superseded" }],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={supersededPage}
          filters={{ projection: "superseded" }}
          onFiltersChange={vi.fn()}
          onSplit={vi.fn()}
          onUndo={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Historisk generering");
    expect(html).toContain("Viser valgt tidligere generering");
    expect(html).toContain("Valgt generering");
    expect(html).toContain("Grupper i genereringen");
    expect(html).toContain("Grupper i valgt generering");
    expect(html).toContain("coverage-generation-shadow-1");
    expect(html).not.toContain("siste vellykkede generering");
    expect(html).not.toContain("Aktive grupper");
    expect(html).not.toContain("Grupper til gjennomgang");
    expect(html).not.toContain("Splitt gruppe");
    expect(html).not.toContain(">Angre<");
  });

  it("treats history and review results as canonical server-owned pages", () => {
    const historicalPage: CoverageBundlePage = {
      ...page,
      selectedProjection: "superseded",
      selectedGenerationId: "11111111-1111-4111-8111-111111111111",
      historyNextCursor: "older-generation-cursor",
      summary: { ...page.summary, projectionState: "superseded" },
      items: [{ ...page.items[0]!, state: "superseded" }],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={historicalPage}
          filters={{ projection: "superseded", review: ["missing_place"] }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Samme hendelse på tvers av kilder");
    expect(html).toContain("Gjennomgang i serverens kanoniske utvalg");
    expect(html).not.toContain("bare gruppene som er lastet på denne siden");
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
    expect(html).toContain("Eldre generering");
  });

  it("warns about integrity and parity failures without promotion-ready copy", () => {
    const errorPage: CoverageBundlePage = {
      ...page,
      summary: { ...page.summary, integrityErrorCount: 1 },
      items: [
        {
          ...page.items[0]!,
          integrityErrors: ["missing_article:missing-article-id"],
        },
      ],
      parity: {
        legacyBundleCount: 1,
        normalizedBundleCount: 1,
        membershipMismatchCount: 1,
        primaryMismatchCount: 0,
        clean: false,
      },
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={errorPage}
          filters={{ projection: "shadow" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Lagringskontrollen fant avvik mellom de to representasjonene");
    expect(html).toContain("missing-article-id");
    expect(html).not.toContain("Lagringskontroll bestått");
  });

  it("keeps correction history read-only when corrections are disabled", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={{ ...page, correctionsEnabled: false }}
          filters={{ projection: "shadow" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Korrigeringshistorikk");
    expect(html).toContain("Aktiv korrigering");
    expect(html).not.toContain("Splitt gruppe");
    expect(html).not.toContain("Angre");
  });

  it("keeps legacy bundle history read-only when corrections are enabled", () => {
    const legacyPage: CoverageBundlePage = {
      ...page,
      correctionsEnabled: true,
      summary: {
        ...page.summary,
        matcherVersion: "v1",
        projectionState: "legacy",
        generation: undefined,
      },
      items: [
        {
          ...page.items[0]!,
          matcherVersion: "v1",
          matchConfidence: undefined,
          generation: undefined,
          state: "legacy",
        },
      ],
      parity: undefined,
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={legacyPage}
          filters={{ projection: "legacy", confidence: "high" }}
          onFiltersChange={vi.fn()}
          onSplit={vi.fn()}
          onUndo={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Korrigeringshistorikk");
    expect(html).toContain("Aktiv korrigering");
    expect(html).not.toContain("Splitt gruppe");
    expect(html).not.toContain("Angre");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={{
            summary: {
              recentBundleCount: 0,
              byKind: { incident: 0, topic: 0, update: 0 },
              byConfidence: { high: 0, medium: 0 },
              activeBundleCount: 0,
              byMatchTier: { strong: 0, moderate: 0 },
              reviewCandidateCount: 0,
              activeCorrectionCount: 0,
              integrityErrorCount: 0,
              matcherVersion: "v1",
              projectionState: "legacy",
            },
            items: [],
          }}
          filters={{ projection: "legacy", confidence: "high" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen dekningsgrupper matcher filteret.");
    expect(html).toContain("Ingen gruppe valgt");
  });

  it("does not link unsafe persisted article URLs", () => {
    const unsafePage: CoverageBundlePage = {
      ...page,
      items: [
        {
          ...page.items[0]!,
          memberArticles: [
            {
              ...page.items[0]!.memberArticles[0]!,
              title: "Utrygg lenke",
              url: "javascript:alert(1)",
            },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoverageBundlesDashboard
          page={unsafePage}
          filters={{ projection: "shadow" }}
          onFiltersChange={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Utrygg lenke");
    expect(html).toContain("coverage-bundle-member-linkless");
    expect(html).not.toContain("javascript:alert");
  });
});

describe("coverage workspace helpers", () => {
  it("marks an omitted projection for server-side default selection", () => {
    const filters = coverageWorkspaceFilters("");
    expect(filters).toEqual({
      projection: "shadow",
      projectionDefaulted: true,
    });
    expect(coverageQueryFromFilters(filters)).toEqual({ limit: 30 });
    expect(coverageWorkspaceSearch(filters)).toBe("");
  });

  it("keeps an explicit projection in the operations request", () => {
    const filters = coverageWorkspaceFilters("?projection=active");
    expect(coverageQueryFromFilters(filters)).toEqual({ projection: "active", limit: 30 });
  });

  it("round-trips all filters while changing one value", () => {
    const filters = coverageWorkspaceFilters(
      "?projection=active&matchTier=strong&corrected=yes&integrity=error&review=weak%2Cmissing_place&q=Flat%C3%A5sen&cursor=next&bundle=coverage%3Aone",
    );
    const search = coverageWorkspaceSearch({ ...filters, matchTier: "moderate" });

    expect(coverageWorkspaceFilters(search)).toEqual({
      projection: "active",
      matchTier: "moderate",
      corrected: "yes",
      integrity: "error",
      review: ["weak", "missing_place"],
      query: "Flatåsen",
      cursor: "next",
      bundleId: "coverage:one",
    });
  });

  it("parses the superseded projection and composes review-quality filters", () => {
    const filters = coverageWorkspaceFilters(
      "?projection=superseded&review=reviewable%2Ccorrection_conflict%2Cmissing_entity%2Cmissing_official%2Cgeneration_change&generationId=11111111-1111-4111-8111-111111111111&historyCursor=history-next",
    );

    expect(filters).toEqual({
      projection: "superseded",
      review: [
        "reviewable",
        "correction_conflict",
        "missing_entity",
        "missing_official",
        "generation_change",
      ],
      generationId: "11111111-1111-4111-8111-111111111111",
      historyCursor: "history-next",
    });
    expect(coverageQueryFromFilters(filters)).toEqual({
      projection: "superseded",
      review: [
        "reviewable",
        "correction_conflict",
        "missing_entity",
        "missing_official",
        "generation_change",
      ],
      generationId: "11111111-1111-4111-8111-111111111111",
      historyCursor: "history-next",
      limit: 30,
    });
    expect(coverageWorkspaceSearch(filters)).toBe(
      "projection=superseded&review=reviewable%2Ccorrection_conflict%2Cmissing_entity%2Cmissing_official%2Cgeneration_change&generationId=11111111-1111-4111-8111-111111111111&historyCursor=history-next",
    );
  });

  it("applies review-quality filters together to the loaded page", () => {
    const weak = page.items[0]!;
    const correctionConflict = {
      ...weak,
      id: "coverage:conflict",
      reviewCandidates: [
        {
          ...weak.reviewCandidates[0]!,
          correctionConflict: true,
        },
      ],
    };
    const noPlaceOrOfficial = {
      ...weak,
      id: "coverage:no-place-or-official",
      sourceIds: ["nrk", "adressa"] satisfies CoverageBundlePage["items"][number]["sourceIds"],
      sourceLabels: ["NRK Trøndelag", "Adresseavisen"],
      memberArticles: weak.memberArticles.map((article, index) =>
        index === 0
          ? article
          : {
              ...article,
              source: "adressa" as const,
              sourceLabel: "Adresseavisen",
            },
      ),
      signals: [],
      edges: weak.edges.map((edge) => ({
        ...edge,
        positiveIncidentEvidence: [],
        signals: edge.signals.filter(
          ({ kind }) => kind !== "shared_place" && kind !== "generic_place_incident",
        ),
      })),
      reviewCandidates: [],
    };

    expect(
      coverageReviewFilteredItems(
        [weak, correctionConflict, noPlaceOrOfficial],
        ["missing_place", "missing_entity", "missing_official"],
      ).map(({ id }) => id),
    ).toEqual(["coverage:no-place-or-official"]);
    expect(
      coverageReviewFilteredItems([weak, correctionConflict], ["weak", "correction_conflict"]).map(
        ({ id }) => id,
      ),
    ).toEqual(["coverage:conflict"]);
  });

  it("keeps confidence only for the legacy projection", () => {
    expect(coverageWorkspaceFilters("?projection=legacy&confidence=high")).toMatchObject({
      projection: "legacy",
      confidence: "high",
    });
    expect(coverageWorkspaceFilters("?projection=shadow&confidence=high")).toEqual({
      projection: "shadow",
    });
    expect(coverageWorkspaceFilters("?projection=legacy&review=weak%2Cmissing_entity")).toEqual({
      projection: "legacy",
    });
    expect(
      coverageWorkspaceSearch({
        projection: "legacy",
        review: ["weak", "missing_entity"],
      }),
    ).toBe("projection=legacy");
  });

  it("groups review candidates by reason and bounds initial rows to five", () => {
    const candidate = page.items[0]!.reviewCandidates[0]!;
    const bundle = {
      ...page.items[0]!,
      reviewCandidates: [
        ...Array.from({ length: 6 }, (_, index) => ({
          ...candidate,
          articleIds: [`left-${index}`, `right-${index}`] as [string, string],
          score: 0.1 + index / 10,
        })),
        {
          ...candidate,
          articleIds: ["conflict-left", "conflict-right"] as [string, string],
          score: 0.99,
          correctionConflict: true,
        },
      ],
    };

    const grouped = groupedCoverageReviewCandidates(bundle);

    expect(grouped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "specific_place",
          total: 6,
          visible: expect.arrayContaining([expect.objectContaining({ score: 0.6 })]),
        }),
        expect.objectContaining({ reason: "correction_conflict", total: 1 }),
      ]),
    );
    expect(grouped.find(({ reason }) => reason === "specific_place")?.visible).toHaveLength(5);
  });

  it("reloads the workspace after a successful split", async () => {
    const split = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(true);

    await expect(
      splitCoverageBundleAndRefresh(
        "coverage:one",
        {
          expectedGeneratedAt: "2026-06-18T10:55:00.000Z",
          anchorArticleId: "anchor",
          rejectedArticleIds: ["rejected"],
        },
        reload,
        split,
      ),
    ).resolves.toBe("updated");
    expect(split).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads stale split state instead of claiming success", async () => {
    const split = vi.fn().mockRejectedValue(new CoverageCorrectionConflictError([]));
    const reload = vi.fn().mockResolvedValue(true);

    await expect(
      splitCoverageBundleAndRefresh(
        "coverage:one",
        {
          expectedGeneratedAt: "2026-06-18T10:55:00.000Z",
          anchorArticleId: "anchor",
          rejectedArticleIds: ["rejected"],
        },
        reload,
        split,
      ),
    ).resolves.toBe("conflict");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads the workspace after undo", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(true);

    await undoCoverageCorrectionAndRefresh("correction:one", reload, undo);

    expect(undo).toHaveBeenCalledWith("correction:one");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reports a failed refresh after a successful split", async () => {
    const split = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(false);

    await expect(
      splitCoverageBundleAndRefresh(
        "coverage:one",
        {
          expectedGeneratedAt: "2026-06-18T10:55:00.000Z",
          anchorArticleId: "anchor",
          rejectedArticleIds: ["rejected"],
        },
        reload,
        split,
      ),
    ).resolves.toBe("reload_failed");
  });

  it("reports a failed refresh after a stale split conflict", async () => {
    const split = vi.fn().mockRejectedValue(new CoverageCorrectionConflictError([]));
    const reload = vi.fn().mockResolvedValue(false);

    await expect(
      splitCoverageBundleAndRefresh(
        "coverage:one",
        {
          expectedGeneratedAt: "2026-06-18T10:55:00.000Z",
          anchorArticleId: "anchor",
          rejectedArticleIds: ["rejected"],
        },
        reload,
        split,
      ),
    ).resolves.toBe("conflict_reload_failed");
  });

  it("reports a failed refresh after undo", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(false);

    await expect(undoCoverageCorrectionAndRefresh("correction:one", reload, undo)).resolves.toBe(
      false,
    );
  });
});
