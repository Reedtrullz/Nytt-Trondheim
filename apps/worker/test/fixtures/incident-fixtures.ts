import type { Article, OfficialEvent, Situation } from "@nytt/shared";

export function incidentArticle(
  id: string,
  source: Article["source"],
  publishedAt: string,
  overrides: Partial<Article> = {},
): Article {
  return {
    id,
    source,
    sourceLabel: source === "adressa" ? "Adresseavisen" : source === "nrk" ? "NRK" : source,
    title: "Brann i Bymarka",
    excerpt: "Røyk er observert i Bymarka.",
    url: `https://example.test/${id}`,
    publishedAt,
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka"],
    ...overrides,
  };
}

export function warningEvent(id: string, overrides: Partial<OfficialEvent> = {}): OfficialEvent {
  return {
    id,
    source: "met",
    eventType: "fire",
    state: "active",
    title: "Skogbrannfare i Trøndelag",
    detail: "MET varsler skogbrannfare som kontekst, ikke hendelsesbekreftelse.",
    areaLabel: "Trøndelag",
    sourceUrl: `https://example.test/warning/${id}`,
    publishedAt: "2026-06-02T08:00:00Z",
    validFrom: "2026-06-02T08:00:00Z",
    validTo: "2099-06-03T08:00:00Z",
    severity: "yellow",
    geometry: undefined,
    raw: { fixture: true },
    ...overrides,
  };
}

export function promotableDatexEvent(
  id: string,
  overrides: Partial<OfficialEvent> = {},
): OfficialEvent {
  return {
    id,
    source: "datex",
    eventType: "traffic",
    state: "active",
    title: "E6 stengt ved Sluppen",
    detail: "Offisiell trafikkhendelse fra Statens vegvesen.",
    areaLabel: "Sluppen",
    sourceUrl: `https://example.test/datex/${id}`,
    publishedAt: "2026-06-02T09:00:00Z",
    validFrom: "2026-06-02T09:00:00Z",
    validTo: "2026-06-02T12:00:00Z",
    geometry: { type: "Point", coordinates: [10.395, 63.397] },
    raw: {
      datex: {
        situationId: id,
        recordKind: "Accident",
        impact: "high",
        promoteToSituation: true,
      },
    },
    ...overrides,
  };
}

export function dismissedSituation(situation: Situation): Situation {
  return {
    ...situation,
    status: "dismissed",
    dismissalReason: "false_positive",
  };
}
