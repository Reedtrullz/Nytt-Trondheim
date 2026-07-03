import { describe, expect, it } from "vitest";
import type { Article, HomeSituationSummary, Situation } from "../src/index.js";
import {
  applyNotificationDeliveryStates,
  buildPublicNotificationSignalHighlights,
  buildNotificationTriggerPage,
  filterNotificationTriggerPageByDeliveryStates,
  notificationTriggerTraceState,
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

function homeSituation(overrides: Partial<HomeSituationSummary> = {}): HomeSituationSummary {
  return {
    id: "situation-one",
    title: "Steinsprang, vegen er stengt",
    summary: "Vegen er stengt ved Gangåsvegen, og omkjøring er skiltet.",
    status: "active",
    verificationStatus: "Offentlig bekreftet",
    updatedAt: "2026-07-02T08:55:00.000Z",
    createdAt: "2026-07-02T07:40:00.000Z",
    locationLabel: "Gangåsvegen",
    sourceConfidence: {
      level: "confirmed",
      label: "Bekreftet",
      score: 0.92,
      sourceCount: 2,
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
      publicSurface: {
        state: "visible",
        label: "Synlig på Bypuls",
        detail: "Sjekk rute nå · Oppdatert nå",
        reason: "Samme offentlige varselregel treffer City Pulse-datasettet.",
        attention: {
          label: "Sjekk rute nå",
          detail: "Hendelsen kan påvirke reisevei eller framkommelighet.",
          tone: "urgent",
        },
        recencyLabel: "Oppdatert nå",
        link: expect.objectContaining({ href: "/situasjoner/situation-one" }),
      },
      reasons: expect.arrayContaining([
        "Situasjonen er markert med høy operativ prioritet.",
        "Har offentlig kildegrunnlag.",
      ]),
    });
    expect(page.items[0]?.links[0]).toMatchObject({ href: "/situasjoner/situation-one" });
    expect(page.items[0]?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source_audit",
          href: "/command/kilder?sources=datex&detail=datex",
          sourceId: "datex",
        }),
      ]),
    );
  });

  it("links situation notification candidates to operator source evidence", () => {
    const page = buildNotificationTriggerPage({
      situations: [
        situation({
          timeline: [
            {
              id: "timeline-one",
              situationId: "situation-one",
              timestamp: "2026-07-02T08:58:00.000Z",
              kind: "source_update",
              title: "DATEX oppdatert",
              detail: "Vegen er fortsatt stengt.",
              sourceLabel: "Vegvesen DATEX",
              source: "datex",
              sourceUrl: "https://example.test/datex",
              official: true,
              provenance: "official",
              sourceItemIds: ["source:datex-one"],
            },
          ],
          provenanceSummary: [
            {
              provenance: "official",
              label: "Offisiell",
              sourceIds: ["datex"],
              confidence: { level: "confirmed", score: 0.9 },
              sourceItemIds: ["source:datex-one"],
            },
          ],
        }),
      ],
      articles: [],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source_audit",
          label: "Kildeaudit: Statens vegvesen DATEX",
          href: "/command/kilder?sources=datex&detail=datex",
          sourceId: "datex",
        }),
        expect.objectContaining({
          kind: "source_item",
          label: "Rådata: Statens vegvesen DATEX",
          href: "/command/radata?sourceItem=source%3Adatex-one",
          sourceId: "datex",
          sourceItemId: "source:datex-one",
        }),
      ]),
    );
    expect(page.items[0]?.links.filter((link) => link.kind === "source_item")).toHaveLength(1);
    expect(notificationTriggerTraceState(page.items[0]!)).toBe("raw_evidence");
  });

  it("builds public-safe signal highlights from home situation summaries", () => {
    const highlights = buildPublicNotificationSignalHighlights({
      situations: [homeSituation()],
      articles: [],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({
      id: "public-signal:situation:situation-one",
      kind: "traffic_disruption",
      severity: "critical",
      title: "Steinsprang, vegen er stengt",
      sourceLabels: ["Offentlig bekreftet"],
      attention: {
        label: "Sjekk rute nå",
        detail: "Hendelsen kan påvirke reisevei eller framkommelighet.",
        tone: "urgent",
      },
      confidence: expect.objectContaining({ level: "confirmed", label: "Bekreftet" }),
      recencyLabel: "Oppdatert nå",
      matchedKeywords: expect.arrayContaining(["stengt", "omkjøring"]),
      reasons: expect.arrayContaining([
        "Situasjonen er aktiv.",
        "Situasjonsrommet er offentlig bekreftet.",
      ]),
      link: expect.objectContaining({ href: "/situasjoner/situation-one" }),
    });
    expect(JSON.stringify(highlights[0])).not.toContain("deliveryState");
    expect(JSON.stringify(highlights[0])).not.toContain("subscription");
  });

  it("keeps private candidates when public City Pulse has no safe signal projection", () => {
    const page = buildNotificationTriggerPage({
      situations: [
        situation({
          id: "internal-followup",
          title: "Operativ oppfolging",
          summary: "Kommunen vurderer videre tiltak.",
          locationLabel: "Midtbyen",
          relatedArticleIds: [],
          evidence: [],
          timeline: [],
        }),
      ],
      articles: [],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.publicSurface).toMatchObject({
      state: "hidden",
      label: "Ikke vist på Bypuls",
      reason:
        "Situasjonen er under offentlig visningsterskel eller ikke aktiv/offentlig nok for City Pulse.",
    });
  });

  it("builds public-safe signal highlights from verified high-impact articles", () => {
    const highlights = buildPublicNotificationSignalHighlights({
      situations: [],
      articles: [
        article({
          id: "article-verified",
          source: "adressa",
          sourceLabel: "Adresseavisen",
          title: "Ung mann kritisk skadet etter voldshendelse på Lade",
          excerpt: "Politiet bekrefter at en mann er kritisk skadet.",
          publishedAt: "2026-07-02T07:20:00.000Z",
          category: "Krim",
          publicVerification: {
            status: "verified",
            label: "Verifisert",
            detail: "Bekreftet av Politiloggen og Adresseavisen.",
            officialSources: ["politiloggen"],
            reportingSources: ["adressa"],
            situationId: "lade-vold",
          },
          situationId: "lade-vold",
        }),
      ],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({
      id: "public-signal:article:article-verified",
      kind: "public_safety",
      severity: "critical",
      sourceLabels: ["Adresseavisen", "Politiloggen"],
      attention: expect.objectContaining({
        label: "Følg med nå",
        tone: "urgent",
      }),
      confidence: expect.objectContaining({ level: "confirmed", label: "Bekreftet" }),
      recencyLabel: "Oppdatert siste 2 t",
      link: expect.objectContaining({ href: "/situasjoner/lade-vold" }),
    });
  });

  it("keeps public signal highlights deduplicated and avoids sport false positives", () => {
    const highlights = buildPublicNotificationSignalHighlights({
      situations: [homeSituation({ id: "road-one" })],
      articles: [
        article({
          id: "article-road",
          title: "Ti meter stort ras kan bli stengt i flere uker",
          excerpt: "Veien er stengt ved Gangåsvegen.",
          category: "Transport",
          situationId: "road-one",
        }),
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

    expect(highlights.map((item) => item.id)).toEqual(["public-signal:situation:road-one"]);
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

  it("filters operation pages by delivery state after readiness is known", () => {
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
        article({
          id: "article-violence",
          title: "Én person kritisk skadet etter voldshendelse i Trondheim",
          excerpt: "Politiet opplyser at en ung mann er kritisk skadet etter hendelsen.",
          category: "Krim",
        }),
      ],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });
    const pageWithDeliveryState = applyNotificationDeliveryStates(page, {
      configured: true,
      subscriptions: [
        {
          enabled: true,
          minSeverity: "critical",
          kinds: ["traffic_disruption"],
        },
      ],
    });

    expect(pageWithDeliveryState.items.map((candidate) => candidate.deliveryState)).toEqual([
      "ready",
      "no_subscribers",
    ]);

    const blockedPage = filterNotificationTriggerPageByDeliveryStates(pageWithDeliveryState, [
      "no_subscribers",
    ]);

    expect(blockedPage.filters.deliveryStates).toEqual(["no_subscribers"]);
    expect(blockedPage.summary.total).toBe(1);
    expect(blockedPage.items).toHaveLength(1);
    expect(blockedPage.items[0]).toMatchObject({
      id: "notification:article:article-violence",
      deliveryState: "no_subscribers",
    });
    expect(blockedPage.pushStatus).toEqual(pageWithDeliveryState.pushStatus);
  });

  it("suppresses low-confidence watch candidates from automatic Web Push delivery", () => {
    const page = buildNotificationTriggerPage({
      situations: [
        situation({
          id: "watch-one",
          title: "Midlertidig observasjon",
          summary: "Situasjonen følges uten tydelig høy effekt.",
          status: "preliminary",
          verificationStatus: "Foreløpig fra rapportering",
          updatedAt: "2026-07-01T23:00:00.000Z",
          relatedArticleIds: [],
          activationBasis: {
            rule: "two_independent_sources",
            sourceIds: ["nrk", "adressa"],
            articleIds: [],
            activatedAt: "2026-07-02T08:55:00.000Z",
          },
          evidence: [],
          importance: "high",
          officialSource: undefined,
          sourceConfidence: {
            level: "uncertain",
            score: 0.58,
            sourceCount: 1,
            updatedAt: "2026-07-02T08:55:00.000Z",
          },
        }),
      ],
      articles: [],
      generatedAt: "2026-07-02T09:00:00.000Z",
    });

    expect(page.items[0]).toMatchObject({
      id: "notification:situation:watch-one",
      severity: "watch",
      confidence: expect.objectContaining({ level: "uncertain" }),
    });

    const pageWithDeliveryState = applyNotificationDeliveryStates(page, {
      configured: true,
      subscriptions: [{ enabled: true, minSeverity: "watch", kinds: [] }],
    });

    expect(pageWithDeliveryState.items[0]).toMatchObject({
      deliveryState: "suppressed",
      detail: expect.stringContaining("under terskelen"),
    });
    expect(pageWithDeliveryState.pushStatus).toMatchObject({
      label: "Klar",
      activeSubscriptions: 1,
      matchingCandidates: 1,
      readyCandidates: 0,
      blockedCandidates: 0,
    });
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
    expect(page.items[0]?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source_audit",
          href: "/command/kilder?sources=nrk&detail=nrk",
          sourceId: "nrk",
        }),
        expect.objectContaining({
          kind: "external",
          href: "https://example.test/article-one",
        }),
      ]),
    );
  });

  it("supports trace-state filters for command center views", () => {
    const situations = [
      situation({
        timeline: [
          {
            id: "timeline-one",
            situationId: "situation-one",
            timestamp: "2026-07-02T08:58:00.000Z",
            kind: "source_update",
            title: "DATEX oppdatert",
            detail: "Vegen er fortsatt stengt.",
            sourceLabel: "Vegvesen DATEX",
            source: "datex",
            sourceUrl: "https://example.test/datex",
            official: true,
            provenance: "official",
            sourceItemIds: ["source:datex-one"],
          },
        ],
      }),
    ];
    const articles = [
      article({
        id: "article-violence",
        title: "Én person kritisk skadet etter voldshendelse på Lade",
        excerpt: "Politiet bekrefter at en mann er kritisk skadet.",
        category: "Krim",
      }),
    ];

    const rawPage = buildNotificationTriggerPage({
      situations,
      articles,
      generatedAt: "2026-07-02T09:00:00.000Z",
      filters: { traceStates: ["raw_evidence"], limit: 10 },
    });
    const auditPage = buildNotificationTriggerPage({
      situations,
      articles,
      generatedAt: "2026-07-02T09:00:00.000Z",
      filters: { traceStates: ["source_audit"], limit: 10 },
    });

    expect(rawPage.items.map((item) => item.id)).toEqual(["notification:situation:situation-one"]);
    expect(rawPage.summary.total).toBe(1);
    expect(auditPage.items.map((item) => item.id)).toEqual([
      "notification:article:article-violence",
    ]);
    expect(auditPage.summary.total).toBe(1);
  });
});
