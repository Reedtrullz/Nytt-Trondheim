import { describe, expect, it } from "vitest";
import type { Article, Situation } from "../src/index.js";
import {
  applyNotificationDeliveryStates,
  buildNotificationTriggerPage,
  notificationSubscriptionMatchesCandidate,
  publicNotificationTriggerGuidance,
} from "../src/index.js";

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "article-one",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Én person kritisk skadet etter voldshendelse i Trondheim",
    excerpt: "Politiet opplyser at en ung mann er kritisk skadet etter hendelsen.",
    url: "https://example.test/article-one",
    publishedAt: "2026-07-02T08:50:00.000Z",
    scope: "trondheim",
    category: "Krim",
    places: ["Trondheim"],
    ...overrides,
  };
}

function situation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: "situation-one",
    type: "traffic",
    title: "Steinsprang, vegen er stengt",
    summary: "Vegen er stengt ved Gangåsvegen, og omkjøring er skiltet.",
    status: "active",
    verificationStatus: "Offentlig bekreftet",
    importance: "high",
    updatedAt: "2026-07-02T08:55:00.000Z",
    createdAt: "2026-07-02T07:40:00.000Z",
    locationLabel: "Gangåsvegen",
    officialSource: "datex",
    officialEventId: "datex-one",
    activationBasis: {
      rule: "official_source",
      sourceIds: ["datex"],
      articleIds: ["article-road"],
      activatedAt: "2026-07-02T07:40:00.000Z",
    },
    relatedArticleIds: ["article-road"],
    evidence: [
      {
        id: "evidence-one",
        situationId: "situation-one",
        source: "datex",
        sourceLabel: "Vegvesen DATEX",
        sourceUrl: "https://example.test/datex",
        supportingSnippet: "Vegen er stengt.",
        claim: "Steinsprang har stengt vegen.",
        claimType: "traffic_closure",
        provenance: "official",
        confidence: 0.9,
        extractedAt: "2026-07-02T08:45:00.000Z",
        publishedAt: "2026-07-02T08:40:00.000Z",
      },
    ],
    features: [],
    timeline: [],
    sourceConfidence: {
      level: "confirmed",
      score: 0.92,
      sourceCount: 1,
      updatedAt: "2026-07-02T08:55:00.000Z",
    },
    ...overrides,
  };
}

describe("notification trigger candidates", () => {
  it("exposes public guidance for the high-impact trigger categories", () => {
    expect(publicNotificationTriggerGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "public_safety",
          severity: "critical",
          title: "Liv og helse",
        }),
        expect.objectContaining({
          kind: "traffic_disruption",
          severity: "critical",
          title: "Stengte hovedårer",
        }),
        expect.objectContaining({
          kind: "weather_hazard",
          severity: "warning",
          title: "Vær og naturfare",
        }),
        expect.objectContaining({
          kind: "service_disruption",
          severity: "warning",
          title: "Viktige bortfall",
        }),
      ]),
    );
  });

  it("creates explainable candidates for active high-impact situations", () => {
    const page = buildNotificationTriggerPage({
      situations: [situation()],
      articles: [
        article({
          id: "article-road",
          title: "Ti meter stort ras kan bli stengt i flere uker",
          excerpt: "Veien er stengt ved Gangåsvegen.",
          category: "Transport",
          situationId: "situation-one",
        }),
      ],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(page.summary.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      kind: "traffic_disruption",
      severity: "critical",
      deliveryState: "candidate_only",
      situationId: "situation-one",
      sourceIds: ["datex"],
      matchedKeywords: expect.arrayContaining(["stengt"]),
      reasons: expect.arrayContaining([
        "Situasjonen er markert med høy operativ prioritet.",
        "Har offentlig kildegrunnlag.",
      ]),
    });
    expect(page.items[0]?.links[0]).toMatchObject({ href: "/situasjoner/situation-one" });
  });

  it("annotates candidates with Web Push readiness and delivery history", () => {
    const page = buildNotificationTriggerPage({
      situations: [situation()],
      articles: [
        article({
          id: "article-road",
          title: "Ti meter stort ras kan bli stengt i flere uker",
          excerpt: "Veien er stengt ved Gangåsvegen.",
          category: "Transport",
          situationId: "situation-one",
        }),
      ],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    const disabledPage = applyNotificationDeliveryStates(page, { configured: false });
    expect(disabledPage.items[0]).toMatchObject({
      deliveryState: "not_configured",
      detail: expect.stringContaining("Web Push er ikke konfigurert"),
    });
    expect(disabledPage.pushStatus).toMatchObject({
      configured: false,
      label: "Ikke konfigurert",
      blockedCandidates: 1,
    });

    expect(applyNotificationDeliveryStates(page, { configured: true }).items[0]).toMatchObject({
      deliveryState: "ready",
      detail: expect.stringContaining("Klar for Web Push"),
    });

    const noSubscriberPage = applyNotificationDeliveryStates(page, {
      configured: true,
      subscriptions: [],
    });
    expect(noSubscriberPage.items[0]).toMatchObject({
      deliveryState: "no_subscribers",
      detail: expect.stringContaining("Ingen aktive push-abonnement"),
    });
    expect(noSubscriberPage.pushStatus).toMatchObject({
      label: "Mangler match",
      activeSubscriptions: 0,
      matchingCandidates: 0,
      blockedCandidates: 1,
    });

    const readyPage = applyNotificationDeliveryStates(page, {
      configured: true,
      subscriptions: [{ enabled: true, minSeverity: "warning", kinds: ["traffic_disruption"] }],
      sourceHealth: [
        {
          source: "web_push",
          label: "Web Push",
          state: "ok",
          lastCheckedAt: "2026-07-02T09:00:00.000Z",
          detail: "1 kandidat vurdert, 1 sendt",
        },
      ],
    });
    expect(readyPage.items[0]).toMatchObject({
      deliveryState: "ready",
      detail: expect.stringContaining("Klar for Web Push"),
    });
    expect(readyPage.pushStatus).toMatchObject({
      label: "Klar",
      activeSubscriptions: 1,
      matchingCandidates: 1,
      readyCandidates: 1,
      health: expect.objectContaining({ source: "web_push", state: "ok" }),
    });

    const sentPage = applyNotificationDeliveryStates(page, {
      configured: true,
      deliveries: [{ triggerId: "notification:situation:situation-one", status: "sent" }],
    });
    expect(sentPage.items[0]).toMatchObject({
      deliveryState: "sent",
      detail: expect.stringContaining("Push-varsel er sendt"),
    });
    expect(sentPage.pushStatus?.deliveryCounts).toMatchObject({ total: 1, sent: 1 });
  });

  it("uses the same subscription matching rule as worker dispatch", () => {
    const page = buildNotificationTriggerPage({
      situations: [situation()],
      articles: [],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });
    const candidate = page.items[0]!;

    expect(
      notificationSubscriptionMatchesCandidate(
        { enabled: true, minSeverity: "warning", kinds: [] },
        candidate,
      ),
    ).toBe(true);
    expect(
      notificationSubscriptionMatchesCandidate(
        { enabled: true, minSeverity: "critical", kinds: ["weather_hazard"] },
        candidate,
      ),
    ).toBe(false);
    expect(
      notificationSubscriptionMatchesCandidate(
        { enabled: false, minSeverity: "watch", kinds: [] },
        candidate,
      ),
    ).toBe(false);
  });

  it("keeps sport stories about Brann out of public-safety triggers", () => {
    const page = buildNotificationTriggerPage({
      situations: [],
      articles: [
        article({
          id: "sport-one",
          title: "Freyr Alexandersson ferdig i Brann",
          excerpt: "Rosenborg vurderer trenerkandidater.",
          category: "Sport",
          topics: ["rosenborg"],
        }),
      ],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(page.items).toEqual([]);
    expect(page.summary.total).toBe(0);
  });

  it("supports severity and text filters for command center views", () => {
    const page = buildNotificationTriggerPage({
      situations: [situation()],
      articles: [
        article({
          coverageBundle: {
            id: "coverage:violence",
            kind: "incident",
            confidence: "high",
            reason: "Samme hendelse på tvers av kilder",
            generatedAt: "2026-07-02T08:55:00.000Z",
          },
        }),
      ],
      generatedAt: "2026-07-02T09:00:00.000Z",
      filters: { severities: ["critical"], q: "kritisk", limit: 10 },
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: "notification:article:article-one",
      kind: "public_safety",
      severity: "critical",
    });
  });
});
