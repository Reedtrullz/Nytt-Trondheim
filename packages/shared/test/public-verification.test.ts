import { describe, expect, it } from "vitest";
import type { Article, HomeArticleGroup } from "../src/index.js";
import {
  derivePublicVerificationForArticleGroup,
  isNewsroomPublicVerificationSource,
  isOfficialPublicVerificationSource,
} from "../src/index.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-1",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Ung mann kritisk skadd på Lade",
    excerpt: "Politiet leter etter flere personer etter en voldshendelse på Lade.",
    url: "https://example.test/lade",
    publishedAt: "2026-07-02T18:59:00.000Z",
    scope: "trondheim",
    category: "Krim",
    places: ["Lade", "Trondheim"],
    ...overrides,
  };
}

function group(articles: Article[], bundleKind: "incident" | "topic" | "update" = "incident") {
  return {
    id: `coverage:${bundleKind}:lade`,
    primary: articles[0]!,
    articles,
    sourceLabels: [...new Set(articles.map((item) => item.sourceLabel))],
    bundle: {
      id: `coverage:${bundleKind}:lade`,
      kind: bundleKind,
      confidence: "high",
      reason: bundleKind === "topic" ? "Samme tema over tid" : "Samme hendelse på tvers av kilder",
      generatedAt: "2026-07-02T19:00:00.000Z",
    },
  } satisfies HomeArticleGroup;
}

describe("public verification", () => {
  it("derives verification only from a direct strong official-to-newsroom incident edge", () => {
    const articles = [
      article({ id: "news", source: "adressa", sourceLabel: "Adresseavisen" }),
      article({
        id: "official",
        source: "politiloggen",
        sourceLabel: "Politiloggen",
        situationId: "incident-1",
      }),
    ];
    const verification = derivePublicVerificationForArticleGroup({
      ...group(articles),
      acceptedEdges: [
        {
          articleIds: ["news", "official"],
          tier: "strong",
          score: 0.95,
          kind: "incident",
          positiveIncidentEvidence: ["same_situation_id"],
          signals: [],
          conflicts: [],
          evidenceFingerprint: "v2:direct",
          reviewable: false,
          correctionConflict: false,
        },
      ],
    });
    expect(verification?.label).toBe("Verifisert");
  });

  it("does not verify official and newsroom co-members connected only through another article", () => {
    const articles = [
      article({ id: "news", source: "adressa", sourceLabel: "Adresseavisen" }),
      article({ id: "bridge", source: "nrk", sourceLabel: "NRK Trøndelag" }),
      article({ id: "official", source: "politiloggen", sourceLabel: "Politiloggen" }),
    ];
    const verification = derivePublicVerificationForArticleGroup({
      ...group(articles),
      acceptedEdges: [
        {
          articleIds: ["news", "bridge"],
          tier: "strong",
          score: 0.9,
          kind: "incident",
          positiveIncidentEvidence: [],
          signals: [],
          conflicts: [],
          evidenceFingerprint: "v2:bridge",
          reviewable: false,
          correctionConflict: false,
        },
      ],
    });
    expect(verification).toBeUndefined();
  });

  it("does not treat topical official-plus-news bundles as verified incidents", () => {
    const verification = derivePublicVerificationForArticleGroup(
      group(
        [
          article({ id: "nrk-topic", source: "nrk", sourceLabel: "NRK Trøndelag" }),
          article({
            id: "politiloggen-topic",
            source: "politiloggen",
            sourceLabel: "Politiloggen",
            title: "Oppsummering: Trondheim",
          }),
        ],
        "topic",
      ),
    );

    expect(verification).toBeUndefined();
  });

  it("keeps public verification source classes narrower than confidence tiers", () => {
    expect(isOfficialPublicVerificationSource("politiloggen")).toBe(true);
    expect(isOfficialPublicVerificationSource("met")).toBe(false);
    expect(isNewsroomPublicVerificationSource("adressa")).toBe(true);
    expect(isNewsroomPublicVerificationSource("deepseek")).toBe(false);
  });
});
