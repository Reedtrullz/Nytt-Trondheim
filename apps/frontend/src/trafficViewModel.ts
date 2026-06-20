import type {
  PublicTransportMapPayload,
  SourceHealth,
  TrafficCorridorImpact,
  TrafficEventSeverity,
  TrafficMapEvent,
  TrafficMapPayload,
  TrafficMapSourceStatus,
} from "@nytt/shared";
import type { TrafficTrustBadge } from "./trafficProvenance.js";
import { badgesForTrafficEvent } from "./trafficProvenance.js";
import { compactTrafficEventRow } from "./trafficEventRows.js";

export interface TrafficSummaryCardModel {
  id: "critical" | "delays" | "roadworks" | "publicTransport" | "updated";
  title: string;
  count: number;
  detail: string;
  badge?: TrafficTrustBadge;
  severity?: TrafficEventSeverity;
}

export interface RankedTrafficEventModel {
  id: string;
  event: TrafficMapEvent;
  title: string;
  meta: string;
  badges: TrafficTrustBadge[];
  score: number;
}

export type TrafficFreshnessSource = Pick<
  TrafficMapSourceStatus | SourceHealth,
  "source" | "label" | "state" | "detail" | "lastCheckedAt"
>;

export interface TrafficViewModel {
  summaryCards: TrafficSummaryCardModel[];
  rankedEvents: RankedTrafficEventModel[];
  delayCorridors: TrafficCorridorImpact[];
  sources: TrafficFreshnessSource[];
}

export interface TrafficViewLayerVisibility {
  incidents: boolean;
  roadworks: boolean;
  travelTime: boolean;
  estimatedNews?: boolean;
}

const defaultVisibleLayers: TrafficViewLayerVisibility = {
  incidents: true,
  roadworks: true,
  travelTime: true,
};

const severityRank: Record<TrafficEventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function formatClock(value?: string): string {
  if (!value) return "ukjent";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function minutes(seconds?: number): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function delaySummary(impact: TrafficCorridorImpact): string | undefined {
  const travelTime = impact.travelTime;
  if (!travelTime) return undefined;
  const now = minutes(travelTime.travelTimeSeconds);
  const normal = minutes(travelTime.freeFlowSeconds);
  const delay = minutes(travelTime.delaySeconds);
  if (normal && now && delay && (travelTime.delaySeconds ?? 0) > 0) {
    return `Normal: ${normal} · Nå: ${now} · +${delay}`;
  }
  if (now) return `Nå: ${now} · ${travelTime.state}`;
  return travelTime.state;
}

function validTime(value?: string): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : undefined;
}

function sourceFreshness(sources: TrafficFreshnessSource[]): string {
  const newest = sources
    .map((source) => validTime(source.lastCheckedAt))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const problemCount = sources.filter((source) => source.state !== "ok").length;
  const base = newest ? `Sist hentet ${formatClock(newest)}` : "Oppdatering ukjent";
  if (problemCount === 1) return `${base} · 1 kilde krever oppmerksomhet`;
  return problemCount > 1 ? `${base} · ${problemCount} kilder krever oppmerksomhet` : base;
}

function eventScore(event: TrafficMapEvent): number {
  const active = event.state === "active" ? 1000 : event.state === "planned" ? 500 : 0;
  const severity = severityRank[event.severity] * 100;
  const official = event.source === "datex" || event.source === "vegvesen_traffic_info" ? 25 : 0;
  const updatedAt = Date.parse(event.updatedAt);
  const freshness = Number.isFinite(updatedAt)
    ? Math.max(0, 50 - Math.max(0, Date.now() - updatedAt) / 60_000 / 10)
    : 0;
  return active + severity + official + freshness;
}

export function visibleByDefault(event: TrafficMapEvent): boolean {
  if (event.state === "expired" || event.state === "cancelled") return false;
  if (event.severity === "low" && event.category === "other") return false;
  return true;
}

export function visibleInTrafficLayers(
  event: TrafficMapEvent,
  layers: TrafficViewLayerVisibility = defaultVisibleLayers,
): boolean {
  if (event.source === "news_article") return layers.estimatedNews ?? true;
  if (event.category === "roadworks") return layers.roadworks;
  return layers.incidents;
}

export function buildTrafficViewModel({
  traffic,
  publicTransport,
  showAll,
  visibleLayers = defaultVisibleLayers,
}: {
  traffic?: TrafficMapPayload;
  publicTransport?: PublicTransportMapPayload;
  showAll: boolean;
  visibleLayers?: TrafficViewLayerVisibility;
}): TrafficViewModel {
  const events = traffic?.events ?? [];
  const visibleEvents = (showAll ? events : events.filter(visibleByDefault)).filter((event) =>
    visibleInTrafficLayers(event, visibleLayers),
  );
  const delayCorridors = (traffic?.corridorImpacts ?? [])
    .filter(() => visibleLayers.travelTime)
    .filter((impact) => (impact.travelTime?.delaySeconds ?? 0) > 0)
    .sort(
      (left, right) => (right.travelTime?.delaySeconds ?? 0) - (left.travelTime?.delaySeconds ?? 0),
    );
  const transitAlerts = publicTransport?.alerts.filter((alert) => alert.state === "active") ?? [];
  const allSources = [...(traffic?.sources ?? []), ...(publicTransport?.sources ?? [])];
  const rankedEvents = visibleEvents
    .map((event) => {
      const row = compactTrafficEventRow(event, delayCorridors);
      return {
        id: event.id,
        event,
        title: row.title,
        meta: row.meta,
        badges: badgesForTrafficEvent(event),
        score: eventScore(event),
      };
    })
    .sort((left, right) => right.score - left.score);
  const rankedVisibleEvents = rankedEvents.map((row) => row.event);
  const critical = rankedVisibleEvents.filter(
    (event) => event.severity === "critical" || event.severity === "high",
  );
  const roadworks = rankedVisibleEvents.filter((event) => event.category === "roadworks");

  return {
    summaryCards: [
      {
        id: "critical",
        title: critical.length ? "Kritisk" : "Rolig",
        count: critical.length,
        detail: critical[0]?.title ?? "Ingen alvorlige aktive hendelser i kartutsnittet.",
        badge: critical[0] ? badgesForTrafficEvent(critical[0])[0] : "OFFISIELL",
        severity: critical[0]?.severity ?? "low",
      },
      {
        id: "delays",
        title: "Forsinkelser",
        count: delayCorridors.length,
        detail: delayCorridors[0]
          ? `${delayCorridors[0].name}: ${delaySummary(delayCorridors[0])}`
          : "Ingen unormal reisetid i kjente korridorer.",
        badge: "REISETID",
        severity: delayCorridors[0]?.highestSeverity ?? "low",
      },
      {
        id: "roadworks",
        title: "Veiarbeid",
        count: roadworks.length,
        detail: roadworks[0]?.title ?? "Ingen større planlagte arbeider i valgt område.",
        badge: "OFFISIELL",
        severity: roadworks[0]?.severity ?? "low",
      },
      {
        id: "publicTransport",
        title: "Kollektiv",
        count: transitAlerts.length,
        detail: transitAlerts[0]?.summary ?? "Ingen aktive AtB/Entur-avvik i kartutsnittet.",
        badge: "KOLLEKTIV",
        severity: transitAlerts.length > 0 ? "medium" : "low",
      },
      {
        id: "updated",
        title: "Oppdatert",
        count: allSources.length,
        detail: sourceFreshness(allSources),
        severity: "low",
      },
    ],
    rankedEvents,
    delayCorridors,
    sources: allSources,
  };
}
