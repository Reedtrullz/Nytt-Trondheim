import type {
  TrafficBrief,
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficMapEvent,
} from "@nytt/shared";

const severityRank: Record<TrafficEventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const categoryLabels: Record<TrafficEventCategory, string> = {
  roadworks: "veiarbeid",
  accident: "ulykke",
  closure: "stengt vei",
  congestion: "kø/forsinkelse",
  weather: "vær/føre",
  restriction: "restriksjon",
  obstruction: "hindring",
  other: "annen hendelse",
};

const STALE_AFTER_MS = 30 * 60 * 1000;

function trafficFreshness(events: TrafficMapEvent[]): TrafficBrief["freshness"] {
  const newestUpdate = events
    .map((event) => Date.parse(event.updatedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  if (!newestUpdate) return "unknown";
  return Date.now() - newestUpdate > STALE_AFTER_MS ? "stale" : "fresh";
}

export function buildTrafficBrief(events: TrafficMapEvent[]): TrafficBrief {
  const activeEvents = events.filter(
    (event) => event.state === "active" || event.state === "planned",
  );
  const byCategory: TrafficBrief["counts"]["byCategory"] = {};
  const bySeverity: TrafficBrief["counts"]["bySeverity"] = {};

  for (const event of activeEvents) {
    byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;
    bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
  }

  const important = [...activeEvents]
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity])
    .slice(0, 3);
  const maxSeverity = important[0]?.severity ?? "low";
  const categoryBits = Object.entries(byCategory)
    .filter(([, count]) => count > 0)
    .map(
      ([category, count]) =>
        `${count} ${categoryLabels[category as TrafficEventCategory]}`,
    );

  return {
    headline:
      activeEvents.length === 0
        ? "Ingen aktive trafikkhendelser registrert akkurat nå."
        : `${activeEvents.length} trafikkhendelser rundt Trondheim akkurat nå.`,
    severity: maxSeverity,
    freshness: trafficFreshness(activeEvents),
    generatedAt: new Date().toISOString(),
    bullets: [
      categoryBits.length > 0
        ? `Fordeling: ${categoryBits.join(", ")}.`
        : "Ingen kategoriserte hendelser.",
      ...important.map((event) => {
        const place = event.locationName ? ` ved ${event.locationName}` : "";
        return `${event.title}${place}`;
      }),
    ],
    primaryEventIds: important.map((event) => event.id),
    counts: {
      total: activeEvents.length,
      byCategory,
      bySeverity,
    },
  };
}
