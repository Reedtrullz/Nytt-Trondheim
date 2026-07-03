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
  it("derives verification for official-plus-news incident groups", () => {
    const verification = derivePublicVerificationForArticleGroup(
      group([
        article({ id: "adressa-lade", source: "adressa", sourceLabel: "Adresseavisen" }),
        article({
          id: "politiloggen-lade",
          source: "politiloggen",
          sourceLabel: "Politiloggen",
          title: "Voldshendelse: Trondheim, Lade",
          situationId: "politiloggen-lade-vold",
        }),
      ]),
    );

    expect(verification).toEqual({
      status: "verified",
      label: "Verifisert",
      detail: "Bekreftet av Politiloggen og Adresseavisen.",
      officialSources: ["politiloggen"],
      reportingSources: ["adressa"],
      situationId: "politiloggen-lade-vold",
    });
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
