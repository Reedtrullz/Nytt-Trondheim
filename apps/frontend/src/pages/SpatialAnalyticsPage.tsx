import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  sourceMixConfidenceSummary,
  type CommandCenterSpatialAnalyticsPayload,
  type CommandCenterSpatialAnalyticsQueryInput,
  type CommandCenterTelemetryHistorySummary,
  type SourceConfidenceSummary,
  type SpatialHeatmapCell,
  type SpatialInvestigationQueueItem,
  type SpatialRawDataRef,
  type TelemetryHistoryPattern,
  type UnexplainedDelayCandidate,
} from "@nytt/shared";
import { api } from "../api.js";
import { DashboardGrid, type DashboardWidgetDefinition } from "../components/DashboardGrid.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

type SpatialAnalyticsFilters = CommandCenterSpatialAnalyticsQueryInput;
type SpatialAnalyticsTimeWindow = "all" | "2h" | "24h" | "7d";

const trondheimCenter: [number, number] = [63.4305, 10.3951];
const tiles = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";

const spatialTimeWindowLabels: Record<SpatialAnalyticsTimeWindow, string> = {
  all: "Alt i datasettet",
  "2h": "Siste 2 timer",
  "24h": "Siste døgn",
  "7d": "Siste 7 dager",
};

const spatialTimeWindowHours: Record<Exclude<SpatialAnalyticsTimeWindow, "all">, number> = {
  "2h": 2,
  "24h": 24,
  "7d": 24 * 7,
};

const confidenceLabels: Record<UnexplainedDelayCandidate["confidence"], string> = {
  watch: "Følg med",
  warning: "Varsel",
  critical: "Kritisk",
};

const delayExplanationLabels: Record<UnexplainedDelayCandidate["explanationStatus"], string> = {
  no_news_match: "Ingen nyhetsforklaring",
  unlinked_news_match: "Nyhet omtaler trafikk, men er ikke koblet",
};

type HotspotPriority = "watch" | "high" | "critical";
type InvestigationPriority = SpatialInvestigationQueueItem["priority"];

const hotspotPriorityLabels: Record<HotspotPriority, string> = {
  watch: "Følg med",
  high: "Høy prioritet",
  critical: "Kritisk varmepunkt",
};

const investigationPriorityLabels: Record<InvestigationPriority, string> = {
  watch: "Følg med",
  high: "Høy prioritet",
  critical: "Kritisk",
};

const investigationKindLabels: Record<SpatialInvestigationQueueItem["kind"], string> = {
  unexplained_delay: "Uforklart forsinkelse",
  hotspot: "Varmepunkt",
  traffic_counter_anomaly: "Trafikkdata-avvik",
};

const liveStatusLabels: Record<CommandCenterSpatialAnalyticsPayload["live"]["status"], string> = {
  live: "Live",
  stale: "Treg",
  empty: "Tomt vindu",
};

const severityLabels: Record<NonNullable<SpatialHeatmapCell["maxSeverity"]>, string> = {
  low: "lav",
  medium: "middels",
  high: "høy",
  critical: "kritisk",
};

const hotspotPriorityRank: Record<HotspotPriority, number> = {
  watch: 0,
  high: 1,
  critical: 2,
};

const delayPriorityRank: Record<UnexplainedDelayCandidate["confidence"], number> = {
  watch: 0,
  warning: 1,
  critical: 2,
};

const investigationPriorityRank: Record<InvestigationPriority, number> = {
  watch: 0,
  high: 1,
  critical: 2,
};

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Oslo",
  }).format(new Date(value));
}

export function spatialAnalyticsFiltersForTimeWindow(
  window: SpatialAnalyticsTimeWindow,
  base: Date = new Date(),
): Pick<SpatialAnalyticsFilters, "from" | "to"> {
  if (window === "all") return {};
  const hours = spatialTimeWindowHours[window];
  const to = new Date(base);
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export function spatialAnalyticsLiveFilters(
  filters: SpatialAnalyticsFilters,
  base: Date = new Date(),
): SpatialAnalyticsFilters {
  const window = spatialTimeWindowForFilters(filters);
  if (window === "all") return filters;
  return {
    ...filters,
    ...spatialAnalyticsFiltersForTimeWindow(window, base),
  };
}

function spatialTimeWindowForFilters(filters: SpatialAnalyticsFilters): SpatialAnalyticsTimeWindow {
  if (!filters.from || !filters.to) return "all";
  const durationMs = Date.parse(filters.to) - Date.parse(filters.from);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "all";
  const durationHours = Math.round(durationMs / (60 * 60 * 1000));
  if (durationHours <= 2) return "2h";
  if (durationHours <= 24) return "24h";
  if (durationHours <= 24 * 7) return "7d";
  return "all";
}

function delayText(delaySeconds?: number) {
  if (delaySeconds === undefined) return "Forsinkelse ukjent";
  return `${Math.max(1, Math.round(delaySeconds / 60))} min forsinkelse`;
}

function activeDaysLabel(activeDayCount: number) {
  return `${activeDayCount} ${activeDayCount === 1 ? "aktiv dag" : "aktive dager"}`;
}

function sourceLabel(source: SpatialHeatmapCell["sourceIds"][number]) {
  switch (source) {
    case "datex":
      return "DATEX";
    case "vegvesen_traffic_info":
      return "Vegvesen trafikk";
    case "news_article":
      return "Nyhetsestimat";
    case "nrk":
      return "NRK";
    case "adressa":
      return "Adresseavisen";
    case "politiloggen":
      return "Politiloggen";
    default:
      return source;
  }
}

function hotspotPriority(cell: SpatialHeatmapCell): HotspotPriority {
  if (cell.maxSeverity === "critical" || cell.trafficEventCount >= 3 || cell.count >= 10) {
    return "critical";
  }
  if (
    cell.maxSeverity === "high" ||
    cell.trafficEventCount > 0 ||
    cell.activeDayCount >= 3 ||
    cell.count >= 4 ||
    (cell.articleCount > 0 && cell.sourceItemCount > 0)
  ) {
    return "high";
  }
  return "watch";
}

function hotspotReason(cell: SpatialHeatmapCell) {
  const signals: string[] = [];
  if (cell.activeDayCount > 1) {
    signals.push(activeDaysLabel(cell.activeDayCount));
  }
  if (cell.maxSeverity) {
    signals.push(`${severityLabels[cell.maxSeverity]} alvorlighet`);
  }
  if (cell.trafficEventCount > 0) {
    signals.push(
      `${cell.trafficEventCount} trafikkhendelse${cell.trafficEventCount === 1 ? "" : "r"}`,
    );
  }
  if (cell.articleCount > 0) {
    signals.push(`${cell.articleCount} nyhetssak${cell.articleCount === 1 ? "" : "er"}`);
  }
  if (cell.sourceItemCount > 0) {
    signals.push(`${cell.sourceItemCount} kildeobservasjoner`);
  }
  if (cell.count >= 4) {
    signals.push(`${cell.count} samlede observasjoner`);
  }
  return signals.length > 0
    ? signals.join(" · ")
    : "Lav tetthet uten tydelig tids- eller tverrkilde-signal.";
}

function hotspotConfidence(cell: SpatialHeatmapCell): SourceConfidenceSummary {
  if (cell.sourceConfidence) return cell.sourceConfidence;
  const sources = new Set(cell.sourceIds);
  if (cell.articleCount > 0) sources.add("news_article");
  if (cell.trafficEventCount > 0) sources.add("vegvesen_traffic_info");
  return sourceMixConfidenceSummary([...sources], { updatedAt: cell.lastSeenAt });
}

function delayConfidence(candidate: UnexplainedDelayCandidate): SourceConfidenceSummary {
  if (candidate.sourceConfidence) return candidate.sourceConfidence;
  const sources = new Set<string>(["datex_travel_time"]);
  if (candidate.matchedArticleIds.length > 0) sources.add("news_article");
  if (candidate.affectedEventIds.length > 0) sources.add("vegvesen_traffic_info");
  return sourceMixConfidenceSummary([...sources], { updatedAt: candidate.updatedAt });
}

function confidenceScoreLabel(confidence: SourceConfidenceSummary) {
  return confidence.score !== undefined ? `${Math.round(confidence.score * 100)} %` : "Ukjent";
}

function trustedSignalCount(payload: CommandCenterSpatialAnalyticsPayload) {
  return payload.summary.bySourceConfidence.confirmed + payload.summary.bySourceConfidence.likely;
}

function telemetryHistoryWindow(summary: CommandCenterTelemetryHistorySummary["datexTravelTime"]) {
  if (!summary.firstObservedAt || !summary.lastObservedAt) return "Ingen historikk i vinduet";
  if (summary.firstObservedAt === summary.lastObservedAt)
    return `Observert ${time(summary.lastObservedAt)}`;
  return `${time(summary.firstObservedAt)} - ${time(summary.lastObservedAt)}`;
}

function telemetryPatternSourceLabel(source: TelemetryHistoryPattern["source"]) {
  return source === "datex_travel_time" ? "DATEX reisetid" : "Trafikkdata";
}

function telemetryPatternEvidence(pattern: TelemetryHistoryPattern) {
  const evidence = [
    `${pattern.notableObservationCount} tydelige signaler`,
    activeDaysLabel(pattern.activeDayCount),
    `${pattern.observationCount} observasjoner`,
  ];
  if (pattern.maxDelaySeconds !== undefined) {
    evidence.push(delayText(pattern.maxDelaySeconds));
  }
  if (pattern.maxAnomalyRatio !== undefined) {
    evidence.push(`${pattern.maxAnomalyRatio.toFixed(1)}x normal trafikk`);
  }
  return evidence;
}

function compareHeatmapCells(left: SpatialHeatmapCell, right: SpatialHeatmapCell) {
  const priorityDifference =
    hotspotPriorityRank[hotspotPriority(right)] - hotspotPriorityRank[hotspotPriority(left)];
  if (priorityDifference !== 0) return priorityDifference;

  const confidenceDifference =
    (hotspotConfidence(right).score ?? 0) - (hotspotConfidence(left).score ?? 0);
  if (confidenceDifference !== 0) return confidenceDifference;

  const countDifference = right.count - left.count;
  if (countDifference !== 0) return countDifference;

  const recencyDifference = Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
  if (recencyDifference !== 0 && Number.isFinite(recencyDifference)) return recencyDifference;

  return left.id.localeCompare(right.id);
}

function compareDelayCandidates(left: UnexplainedDelayCandidate, right: UnexplainedDelayCandidate) {
  const priorityDifference =
    delayPriorityRank[right.confidence] - delayPriorityRank[left.confidence];
  if (priorityDifference !== 0) return priorityDifference;

  const confidenceDifference =
    (delayConfidence(right).score ?? 0) - (delayConfidence(left).score ?? 0);
  if (confidenceDifference !== 0) return confidenceDifference;

  const delayDifference = (right.delaySeconds ?? 0) - (left.delaySeconds ?? 0);
  if (delayDifference !== 0) return delayDifference;

  const recencyDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (recencyDifference !== 0 && Number.isFinite(recencyDifference)) return recencyDifference;

  return left.id.localeCompare(right.id);
}

function compareInvestigationItems(
  left: SpatialInvestigationQueueItem,
  right: SpatialInvestigationQueueItem,
) {
  const priorityDifference =
    investigationPriorityRank[right.priority] - investigationPriorityRank[left.priority];
  if (priorityDifference !== 0) return priorityDifference;

  const confidenceDifference =
    (right.sourceConfidence?.score ?? 0) - (left.sourceConfidence?.score ?? 0);
  if (confidenceDifference !== 0) return confidenceDifference;

  const recencyDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (recencyDifference !== 0 && Number.isFinite(recencyDifference)) return recencyDifference;

  return left.id.localeCompare(right.id);
}

function parseFilters(search: string): SpatialAnalyticsFilters {
  const parameters = new URLSearchParams(search);
  const from = parameters.get("from") || undefined;
  const to = parameters.get("to") || undefined;
  const parsedMinDelaySeconds = Number(parameters.get("minDelaySeconds"));
  const parsedLimit = Number(parameters.get("limit"));
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    minDelaySeconds:
      Number.isFinite(parsedMinDelaySeconds) && parsedMinDelaySeconds >= 0
        ? parsedMinDelaySeconds
        : 180,
    limit: Number.isFinite(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 80,
  };
}

function buildSearch(filters: SpatialAnalyticsFilters) {
  const parameters = new URLSearchParams();
  if (filters.from) parameters.set("from", filters.from);
  if (filters.to) parameters.set("to", filters.to);
  parameters.set("minDelaySeconds", String(filters.minDelaySeconds));
  parameters.set("limit", String(filters.limit));
  return parameters;
}

function linePositions(candidate: UnexplainedDelayCandidate): [number, number][] {
  return candidate.geometry.coordinates
    .map(([lng, lat]) => [lat, lng] as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function heatmapRadius(cell: SpatialHeatmapCell) {
  return Math.min(34, Math.max(8, Math.sqrt(cell.count) * 4.5));
}

function heatmapColor(cell: SpatialHeatmapCell) {
  if (cell.maxSeverity === "critical") return "#b3311f";
  if (cell.maxSeverity === "high") return "#d05d2b";
  if (cell.trafficEventCount > 0) return "#175f9f";
  return "#0f6f4f";
}

function telemetryPatternPosition(pattern: TelemetryHistoryPattern): [number, number] | undefined {
  const coordinates = pattern.geometry?.coordinates;
  const lng = coordinates?.[0];
  const lat = coordinates?.[1];
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return undefined;
  }
  return [lat, lng];
}

function telemetryPatternRadius(pattern: TelemetryHistoryPattern) {
  return Math.min(28, Math.max(9, Math.sqrt(pattern.notableObservationCount + 1) * 4.8));
}

function telemetryPatternColor(pattern: TelemetryHistoryPattern) {
  if (pattern.notableObservationCount >= 8 || pattern.activeDayCount >= 4) return "#8d2f20";
  if (pattern.source === "trafikkdata") return "#1f6f7a";
  return "#7a5a18";
}

function rawSourceItemHref(sourceItemId: string) {
  return `/command/radata?sourceItem=${encodeURIComponent(sourceItemId)}`;
}

function rawTelemetryHref(ref: SpatialRawDataRef) {
  return `/command/radata?telemetrySource=${encodeURIComponent(ref.source)}&telemetryId=${encodeURIComponent(ref.id)}`;
}

function rawRefLabel(ref: SpatialRawDataRef) {
  if (ref.source === "datex_travel_time") return ref.label || "DATEX reisetid";
  return ref.label || "Trafikkdata";
}

function SourceItemLinks({ sourceItemIds }: { sourceItemIds?: string[] }) {
  const visibleIds = (sourceItemIds ?? []).slice(0, 3);
  if (visibleIds.length === 0) return null;
  const remaining = Math.max(0, (sourceItemIds?.length ?? 0) - visibleIds.length);
  return (
    <div className="spatial-source-links" aria-label="Rådata for varmepunkt">
      {visibleIds.map((sourceItemId, index) => (
        <Link key={sourceItemId} to={rawSourceItemHref(sourceItemId)}>
          Rådata {index + 1}
        </Link>
      ))}
      {remaining > 0 ? <span>+{remaining} flere</span> : null}
    </div>
  );
}

function HeatmapTimeProfile({ cell }: { cell: SpatialHeatmapCell }) {
  const buckets = (cell.timeBuckets ?? [])
    .filter((bucket) => Number.isFinite(bucket.count) && bucket.count > 0)
    .slice(-7);
  if (buckets.length === 0) return null;
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <div className="spatial-time-profile" aria-label="Tidsprofil for varmepunkt">
      <div className="spatial-time-profile-heading">
        <span>Tidsprofil</span>
        <small>{buckets.length} dager</small>
      </div>
      <div className="spatial-time-profile-bars">
        {buckets.map((bucket) => {
          const height = Math.max(16, Math.round((bucket.count / maxCount) * 100));
          const label = `${shortDate(bucket.bucketStart)}: ${bucket.count} observasjoner`;
          return (
            <div
              className="spatial-time-profile-bucket"
              aria-label={label}
              key={bucket.bucketStart}
            >
              <i aria-hidden="true" style={{ height: `${height}%` }} />
              <b>{bucket.count} obs</b>
              <small>{shortDate(bucket.bucketStart)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RawTelemetryLinks({ rawRefs }: { rawRefs?: SpatialRawDataRef[] }) {
  const visibleRefs = (rawRefs ?? []).slice(0, 3);
  if (visibleRefs.length === 0) return null;
  const remaining = Math.max(0, (rawRefs?.length ?? 0) - visibleRefs.length);
  return (
    <div className="spatial-source-links" aria-label="Råtelemetri">
      {visibleRefs.map((ref, index) => (
        <Link key={`${ref.source}:${ref.id}`} to={rawTelemetryHref(ref)}>
          {visibleRefs.length > 1 ? `${rawRefLabel(ref)} ${index + 1}` : rawRefLabel(ref)}
        </Link>
      ))}
      {remaining > 0 ? <span>+{remaining} flere</span> : null}
    </div>
  );
}

function itemHasRawEvidence(item: SpatialInvestigationQueueItem) {
  return item.sourceItemIds.length > 0 || (item.rawRefs?.length ?? 0) > 0;
}

function rawEvidenceCount(items: SpatialInvestigationQueueItem[]) {
  return items.reduce((total, item) => {
    return total + item.sourceItemIds.length + (item.rawRefs?.length ?? 0);
  }, 0);
}

function crossSourceInvestigationCount(items: SpatialInvestigationQueueItem[]) {
  return items.filter((item) => item.articleIds.length > 0 && itemHasRawEvidence(item)).length;
}

function prioritySummary(items: SpatialInvestigationQueueItem[]) {
  const critical = items.filter((item) => item.priority === "critical").length;
  const high = items.filter((item) => item.priority === "high").length;
  if (critical > 0) return `${critical} kritisk${critical === 1 ? "" : "e"}`;
  if (high > 0) return `${high} høyprioritert${high === 1 ? "" : "e"}`;
  return items.length > 0 ? `${items.length} følger med` : "Ingen prioritet";
}

function SpatialCorrelationBrief({ payload }: { payload: CommandCenterSpatialAnalyticsPayload }) {
  const rankedItems = [...payload.investigationQueue].sort(compareInvestigationItems);
  const topItems = rankedItems.slice(0, 3);
  const trustedCount = trustedSignalCount(payload);
  const uncertainCount =
    payload.summary.bySourceConfidence.uncertain + payload.summary.bySourceConfidence.speculative;

  return (
    <section className="spatial-correlation-brief" aria-labelledby="spatial-brief-heading">
      <div className="spatial-section-heading">
        <div>
          <p className="label">Korrelasjonsbrief</p>
          <h2 id="spatial-brief-heading">Hva krever oppfølging nå?</h2>
        </div>
        <span>{payload.investigationQueue.length} signaler</span>
      </div>
      <div className="spatial-correlation-metrics">
        <article>
          <span>Operatørprioritet</span>
          <strong>{prioritySummary(payload.investigationQueue)}</strong>
          <small>{payload.investigationQueue.length} signaler i køen</small>
        </article>
        <article>
          <span>Tverrkilde</span>
          <strong>{crossSourceInvestigationCount(payload.investigationQueue)}</strong>
          <small>nyhet + rådata/offisiell kontekst</small>
        </article>
        <article>
          <span>Råspor</span>
          <strong>{rawEvidenceCount(payload.investigationQueue)}</strong>
          <small>kilde- og telemetrispor</small>
        </article>
        <article>
          <span>Tillit</span>
          <strong>{trustedCount}</strong>
          <small>{uncertainCount} usikre signaler</small>
        </article>
      </div>
      {topItems.length === 0 ? (
        <p className="spatial-empty-state">
          Ingen romlige signaler krever operatøroppfølging i dette analysevinduet.
        </p>
      ) : (
        <ol className="spatial-correlation-list">
          {topItems.map((item) => (
            <li className={`priority-${item.priority}`} key={item.id}>
              <div>
                <p className={`spatial-hotspot-priority priority-${item.priority}`}>
                  {investigationPriorityLabels[item.priority]} ·{" "}
                  {investigationKindLabels[item.kind]}
                </p>
                <strong>{item.title}</strong>
                {item.sourceConfidence ? (
                  <span
                    className={`spatial-hotspot-confidence confidence-${item.sourceConfidence.level}`}
                  >
                    {item.sourceConfidence.label} tillit ·{" "}
                    {confidenceScoreLabel(item.sourceConfidence)}
                  </span>
                ) : null}
                <small>{item.reason}</small>
              </div>
              <div className="spatial-correlation-evidence">
                {item.evidence.slice(0, 3).map((evidence) => (
                  <span key={evidence}>{evidence}</span>
                ))}
              </div>
              <div className="spatial-investigation-actions">
                {item.articleIds.length > 0 ? (
                  <span>{item.articleIds.length} mulige saker</span>
                ) : null}
                <SourceItemLinks sourceItemIds={item.sourceItemIds} />
                <RawTelemetryLinks rawRefs={item.rawRefs} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SpatialAnalyticsMap({ payload }: { payload: CommandCenterSpatialAnalyticsPayload }) {
  return (
    <div className="spatial-analytics-map">
      <MapContainer center={trondheimCenter} zoom={11} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.kartverket.no/">Kartverket</a>'
          url={tiles}
        />
        {payload.heatmapCells.map((cell) => {
          const priority = hotspotPriority(cell);
          const confidence = hotspotConfidence(cell);
          return (
            <CircleMarker
              center={[cell.center.lat, cell.center.lng]}
              key={cell.id}
              pathOptions={{
                color: heatmapColor(cell),
                fillColor: heatmapColor(cell),
                fillOpacity: 0.34,
                opacity: 0.82,
                weight: 2,
              }}
              radius={heatmapRadius(cell)}
            >
              <Popup>
                <article className="spatial-map-popup">
                  <strong>{hotspotPriorityLabels[priority]}</strong>
                  <p>
                    {confidence.label} tillit · {confidenceScoreLabel(confidence)}
                  </p>
                  <p>{cell.count} observasjoner</p>
                  <p>
                    {cell.articleCount} saker · {cell.trafficEventCount} trafikkhendelser
                  </p>
                  <p>
                    Først sett {time(cell.firstSeenAt)} · {activeDaysLabel(cell.activeDayCount)}
                  </p>
                  <p>{hotspotReason(cell)}</p>
                  <HeatmapTimeProfile cell={cell} />
                  <p>{confidence.rationale}</p>
                  <p>{cell.sourceIds.map(sourceLabel).join(", ")}</p>
                  <SourceItemLinks sourceItemIds={cell.sourceItemIds} />
                  <small>Sist sett {time(cell.lastSeenAt)}</small>
                </article>
              </Popup>
            </CircleMarker>
          );
        })}
        {payload.unexplainedDelays.map((candidate) => {
          const confidence = delayConfidence(candidate);
          return (
            <Polyline
              key={candidate.id}
              pathOptions={{
                color: candidate.confidence === "critical" ? "#b3311f" : "#c07818",
                opacity: 0.9,
                weight: candidate.confidence === "critical" ? 6 : 4,
              }}
              positions={linePositions(candidate)}
            >
              <Popup>
                <article className="spatial-map-popup">
                  <strong>{candidate.corridorName}</strong>
                  <p>
                    {confidence.label} tillit · {confidenceScoreLabel(confidence)}
                  </p>
                  <p>{delayText(candidate.delaySeconds)}</p>
                  <p>{delayExplanationLabels[candidate.explanationStatus]}</p>
                  <p>{candidate.reason}</p>
                  <p>{confidence.rationale}</p>
                  <RawTelemetryLinks rawRefs={candidate.rawRefs} />
                </article>
              </Popup>
            </Polyline>
          );
        })}
        {payload.telemetryPatterns.flatMap((pattern) => {
          const position = telemetryPatternPosition(pattern);
          if (!position) return [];
          return [
            <CircleMarker
              center={position}
              key={pattern.id}
              pathOptions={{
                color: telemetryPatternColor(pattern),
                fillColor: telemetryPatternColor(pattern),
                fillOpacity: 0.22,
                opacity: 0.88,
                weight: 3,
              }}
              radius={telemetryPatternRadius(pattern)}
            >
              <Popup>
                <article className="spatial-map-popup">
                  <strong>{pattern.title}</strong>
                  <p>{telemetryPatternSourceLabel(pattern.source)}</p>
                  {pattern.sourceConfidence ? (
                    <p>
                      {pattern.sourceConfidence.label} tillit ·{" "}
                      {confidenceScoreLabel(pattern.sourceConfidence)}
                    </p>
                  ) : null}
                  <p>{pattern.description}</p>
                  <p>{telemetryPatternEvidence(pattern).join(" · ")}</p>
                  <small>Sist sett {time(pattern.lastObservedAt)}</small>
                </article>
              </Popup>
            </CircleMarker>,
          ];
        })}
      </MapContainer>
    </div>
  );
}

function DelayCandidateRow({ candidate }: { candidate: UnexplainedDelayCandidate }) {
  const sourceUrl = safeExternalUrl(candidate.sourceUrl);
  const confidence = delayConfidence(candidate);
  return (
    <article className={`spatial-delay-row ${candidate.confidence}`}>
      <div>
        <p className="label">{confidenceLabels[candidate.confidence]}</p>
        <h3>{candidate.corridorName}</h3>
        <p className={`spatial-delay-confidence confidence-${confidence.level}`}>
          {confidence.label} tillit · {confidenceScoreLabel(confidence)}
        </p>
        <p>{candidate.reason}</p>
        <p>{confidence.rationale}</p>
      </div>
      <dl>
        <div>
          <dt>Forsinkelse</dt>
          <dd>{delayText(candidate.delaySeconds)}</dd>
        </div>
        <div>
          <dt>Målt</dt>
          <dd>{time(candidate.updatedAt)}</dd>
        </div>
        <div>
          <dt>Forklaring</dt>
          <dd>{delayExplanationLabels[candidate.explanationStatus]}</dd>
        </div>
        <div>
          <dt>Mulige saker</dt>
          <dd>{candidate.matchedArticleIds.length}</dd>
        </div>
      </dl>
      {sourceUrl ? (
        <a href={sourceUrl} rel="noreferrer" target="_blank">
          Åpne kilde
        </a>
      ) : null}
      <RawTelemetryLinks rawRefs={candidate.rawRefs} />
    </article>
  );
}

function InvestigationQueueItemRow({ item }: { item: SpatialInvestigationQueueItem }) {
  const sourceUrl = safeExternalUrl(item.targetUrl);
  return (
    <article className={`spatial-investigation-row priority-${item.priority}`}>
      <div>
        <p className={`spatial-hotspot-priority priority-${item.priority}`}>
          {investigationPriorityLabels[item.priority]} · {investigationKindLabels[item.kind]}
        </p>
        <h3>{item.title}</h3>
        {item.sourceConfidence ? (
          <p className={`spatial-hotspot-confidence confidence-${item.sourceConfidence.level}`}>
            {item.sourceConfidence.label} tillit · {confidenceScoreLabel(item.sourceConfidence)}
          </p>
        ) : null}
        <p>{item.summary}</p>
        <small>{item.reason}</small>
      </div>
      <div className="spatial-investigation-evidence">
        {item.evidence.slice(0, 4).map((evidence) => (
          <span key={evidence}>{evidence}</span>
        ))}
      </div>
      <div className="spatial-investigation-actions">
        {item.articleIds.length > 0 ? <span>{item.articleIds.length} mulige saker</span> : null}
        <SourceItemLinks sourceItemIds={item.sourceItemIds} />
        <RawTelemetryLinks rawRefs={item.rawRefs} />
        {sourceUrl ? (
          <a href={sourceUrl} rel="noreferrer" target="_blank">
            Åpne kilde
          </a>
        ) : null}
      </div>
    </article>
  );
}

function TelemetryHistoryCard({
  label,
  summary,
  notableLabel,
}: {
  label: string;
  summary: CommandCenterTelemetryHistorySummary["datexTravelTime"];
  notableLabel: string;
}) {
  return (
    <article>
      <div>
        <h3>{label}</h3>
        <p>{telemetryHistoryWindow(summary)}</p>
      </div>
      <dl>
        <div>
          <dt>Observasjoner</dt>
          <dd>{summary.observations}</dd>
        </div>
        <div>
          <dt>Spor</dt>
          <dd>{summary.trackedEntities}</dd>
        </div>
        <div>
          <dt>Aktive dager</dt>
          <dd>{summary.activeDayCount}</dd>
        </div>
        <div>
          <dt>{notableLabel}</dt>
          <dd>{summary.notableObservations}</dd>
        </div>
      </dl>
    </article>
  );
}

function TelemetryPatternRow({ pattern }: { pattern: TelemetryHistoryPattern }) {
  return (
    <article className="spatial-telemetry-pattern">
      <div>
        <p className="label">{telemetryPatternSourceLabel(pattern.source)}</p>
        <h3>{pattern.title}</h3>
        {pattern.sourceConfidence ? (
          <p className={`spatial-hotspot-confidence confidence-${pattern.sourceConfidence.level}`}>
            {pattern.sourceConfidence.label} tillit ·{" "}
            {confidenceScoreLabel(pattern.sourceConfidence)}
          </p>
        ) : null}
        <p>{pattern.description}</p>
        <small>
          {pattern.firstObservedAt && pattern.lastObservedAt
            ? `${time(pattern.firstObservedAt)} - ${time(pattern.lastObservedAt)}`
            : "Historikk uten komplett tidsvindu"}
        </small>
      </div>
      <div className="spatial-investigation-evidence">
        {telemetryPatternEvidence(pattern).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </article>
  );
}

function SpatialFiltersPanel({
  activeTimeWindow,
  filters,
  onFiltersChange,
  payloadWindowLabel,
}: {
  activeTimeWindow: SpatialAnalyticsTimeWindow;
  filters: SpatialAnalyticsFilters;
  onFiltersChange: (filters: SpatialAnalyticsFilters) => void;
  payloadWindowLabel: string;
}) {
  function update(next: Partial<SpatialAnalyticsFilters>) {
    onFiltersChange({ ...filters, ...next });
  }

  function updateTimeWindow(window: SpatialAnalyticsTimeWindow) {
    onFiltersChange({
      ...filters,
      from: undefined,
      to: undefined,
      ...spatialAnalyticsFiltersForTimeWindow(window),
    });
  }

  return (
    <aside className="coverage-bundles-sidebar spatial-analytics-sidebar" aria-label="Filtre">
      <label>
        Tidsrom
        <select
          aria-label="Tidsrom for romlig analyse"
          value={activeTimeWindow}
          onChange={(event) => updateTimeWindow(event.target.value as SpatialAnalyticsTimeWindow)}
        >
          {Object.entries(spatialTimeWindowLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="spatial-filter-note">Analysevindu: {payloadWindowLabel}</p>
      <label>
        Min. forsinkelse
        <select
          value={filters.minDelaySeconds}
          onChange={(event) => update({ minDelaySeconds: Number(event.target.value) })}
        >
          <option value={60}>1 minutt</option>
          <option value={180}>3 minutter</option>
          <option value={300}>5 minutter</option>
          <option value={600}>10 minutter</option>
        </select>
      </label>
      <label>
        Maks celler
        <input
          min={10}
          max={200}
          type="number"
          value={filters.limit}
          onChange={(event) => update({ limit: Number(event.target.value) || 80 })}
        />
      </label>
    </aside>
  );
}

function TelemetryHistorySection({ payload }: { payload: CommandCenterSpatialAnalyticsPayload }) {
  return (
    <section className="spatial-telemetry-history" aria-labelledby="spatial-history-heading">
      <div>
        <p className="label">Tidsseriegrunnlag</p>
        <h2 id="spatial-history-heading">Historikk bak trafikkbildet</h2>
      </div>
      <TelemetryHistoryCard
        label="DATEX reisetid"
        notableLabel="Køsignaler"
        summary={payload.telemetryHistory.datexTravelTime}
      />
      <TelemetryHistoryCard
        label="Trafikkdata"
        notableLabel="Avvik"
        summary={payload.telemetryHistory.trafficCounters}
      />
    </section>
  );
}

function TelemetryPatternsSection({ payload }: { payload: CommandCenterSpatialAnalyticsPayload }) {
  return (
    <section className="spatial-telemetry-patterns" aria-labelledby="spatial-pattern-heading">
      <div className="spatial-section-heading">
        <div>
          <p className="label">Gjentakende signaler</p>
          <h2 id="spatial-pattern-heading">Mulige svarte punkter</h2>
        </div>
        <span>{payload.telemetryPatterns.length} mønstre</span>
      </div>
      {payload.telemetryPatterns.length === 0 ? (
        <p className="spatial-empty-state">
          Ingen gjentakende DATEX- eller Trafikkdata-signaler i analysevinduet ennå.
        </p>
      ) : (
        <div className="spatial-telemetry-pattern-list">
          {payload.telemetryPatterns.map((pattern) => (
            <TelemetryPatternRow key={pattern.id} pattern={pattern} />
          ))}
        </div>
      )}
    </section>
  );
}

function InvestigationQueueSection({ payload }: { payload: CommandCenterSpatialAnalyticsPayload }) {
  return (
    <section
      className="spatial-investigation-panel"
      aria-labelledby="spatial-investigation-heading"
    >
      <div className="spatial-section-heading">
        <div>
          <p className="label">Operatørkø</p>
          <h2 id="spatial-investigation-heading">Signaler å undersøke</h2>
        </div>
        <span>{payload.investigationQueue.length} signaler</span>
      </div>
      {payload.investigationQueue.length === 0 ? (
        <p className="spatial-empty-state">Ingen prioriterte romlige signaler i analysevinduet.</p>
      ) : (
        <div className="spatial-investigation-list">
          {payload.investigationQueue.map((item) => (
            <InvestigationQueueItemRow item={item} key={item.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function DelayCandidatesSection({ candidates }: { candidates: UnexplainedDelayCandidate[] }) {
  return (
    <section className="spatial-delay-panel" aria-labelledby="spatial-delay-heading">
      <div className="spatial-section-heading">
        <div>
          <p className="label">Trafikkpuls</p>
          <h2 id="spatial-delay-heading">Forsinkelser uten kjent årsak</h2>
        </div>
        <span>{candidates.length} kandidater</span>
      </div>
      {candidates.length === 0 ? (
        <p className="spatial-empty-state">
          Ingen store DATEX-forsinkelser uten koblet trafikkhendelse akkurat nå.
        </p>
      ) : (
        <div className="spatial-delay-list">
          {candidates.map((candidate) => (
            <DelayCandidateRow candidate={candidate} key={candidate.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function HeatmapCellsSection({ cells }: { cells: SpatialHeatmapCell[] }) {
  return (
    <section className="spatial-analytics-cells" aria-label="Romlige observasjoner">
      <div className="spatial-section-heading">
        <div>
          <p className="label">Observasjoner</p>
          <h2>Varmepunkter</h2>
        </div>
      </div>
      {cells.length === 0 ? (
        <p className="spatial-empty-state">Ingen stedfestede observasjoner i vinduet.</p>
      ) : (
        <div className="spatial-cell-list">
          {cells.map((cell) => {
            const priority = hotspotPriority(cell);
            const confidence = hotspotConfidence(cell);
            return (
              <article className={`spatial-cell-row priority-${priority}`} key={cell.id}>
                <p className={`spatial-hotspot-priority priority-${priority}`}>
                  {hotspotPriorityLabels[priority]}
                </p>
                <p className={`spatial-hotspot-confidence confidence-${confidence.level}`}>
                  {confidence.label} tillit · {confidenceScoreLabel(confidence)}
                </p>
                <strong>{cell.count} observasjoner</strong>
                <span>
                  {cell.articleCount} saker · {cell.trafficEventCount} trafikkhendelser · sist sett{" "}
                  {time(cell.lastSeenAt)}
                </span>
                <span>
                  Først sett {time(cell.firstSeenAt)} · {activeDaysLabel(cell.activeDayCount)}
                </span>
                <small>{hotspotReason(cell)}</small>
                <small>{confidence.rationale}</small>
                <small>{cell.sourceIds.map(sourceLabel).join(", ")}</small>
                <HeatmapTimeProfile cell={cell} />
                <SourceItemLinks sourceItemIds={cell.sourceItemIds} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SpatialLiveStatus({ payload }: { payload: CommandCenterSpatialAnalyticsPayload }) {
  const live = payload.live;
  const refreshMinutes = Math.max(1, Math.round(live.refreshIntervalSeconds / 60));
  return (
    <aside className={`spatial-live-status live-${live.status}`} aria-label="Live status">
      <span>{liveStatusLabels[live.status]}</span>
      <strong>{live.detail}</strong>
      <small>
        {live.dataUpdatedAt ? `Datagrunnlag ${time(live.dataUpdatedAt)}` : "Ingen siste signal"}
      </small>
      <small>
        Neste automatiske oppdatering {time(live.nextRefreshAt)} · hvert {refreshMinutes} min
      </small>
    </aside>
  );
}

export function SpatialAnalyticsDashboard({
  payload,
  filters,
  onFiltersChange,
  isRefreshing = false,
  onRefresh,
  showMap = true,
}: {
  payload: CommandCenterSpatialAnalyticsPayload;
  filters: SpatialAnalyticsFilters;
  onFiltersChange: (filters: SpatialAnalyticsFilters) => void;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  showMap?: boolean;
}) {
  const rankedHeatmapCells = useMemo(
    () => [...payload.heatmapCells].sort(compareHeatmapCells),
    [payload.heatmapCells],
  );
  const rankedDelayCandidates = useMemo(
    () => [...payload.unexplainedDelays].sort(compareDelayCandidates),
    [payload.unexplainedDelays],
  );

  const activeTimeWindow = spatialTimeWindowForFilters(filters);
  const payloadWindowLabel =
    payload.window.from || payload.window.to
      ? `${time(payload.window.from)} - ${time(payload.window.to)}`
      : "Hele tilgjengelige datasett";
  const widgets = useMemo(() => {
    const nextWidgets: DashboardWidgetDefinition[] = [
      {
        id: "filters",
        title: "Analysefilter",
        description: "Tidsvindu, forsinkelsesterskel og cellemengde.",
        defaultSize: "standard",
        resizable: false,
        children: (
          <SpatialFiltersPanel
            activeTimeWindow={activeTimeWindow}
            filters={filters}
            onFiltersChange={onFiltersChange}
            payloadWindowLabel={payloadWindowLabel}
          />
        ),
      },
      {
        id: "investigation-queue",
        title: "Signaler å undersøke",
        description: "Prioritert kø for operatøroppfølging.",
        defaultSize: "large",
        children: <InvestigationQueueSection payload={payload} />,
      },
      {
        id: "correlation-brief",
        title: "Korrelasjonsbrief",
        description: "Operatørprioritet, råspor og tverrkilde-signaler.",
        defaultSize: "large",
        children: <SpatialCorrelationBrief payload={payload} />,
      },
    ];
    if (showMap) {
      nextWidgets.push({
        id: "map",
        title: "Romlig varmekart",
        description: "Varmepunkter, DATEX-forsinkelser og telemetrimønstre.",
        defaultSize: "full",
        children: <SpatialAnalyticsMap payload={payload} />,
      });
    }
    nextWidgets.push(
      {
        id: "delays",
        title: "Uforklarte forsinkelser",
        description: "DATEX-korridorer uten kjent koblet årsak.",
        defaultSize: "large",
        children: <DelayCandidatesSection candidates={rankedDelayCandidates} />,
      },
      {
        id: "heatmap-cells",
        title: "Varmepunkter",
        description: "Stedfestede observasjoner rangert etter prioritet.",
        defaultSize: "large",
        children: <HeatmapCellsSection cells={rankedHeatmapCells} />,
      },
      {
        id: "telemetry-history",
        title: "Tidsseriegrunnlag",
        description: "Historikken bak trafikkbildet.",
        defaultSize: "wide",
        children: <TelemetryHistorySection payload={payload} />,
      },
      {
        id: "telemetry-patterns",
        title: "Mulige svarte punkter",
        description: "Gjentakende signaler fra DATEX og Trafikkdata.",
        defaultSize: "wide",
        children: <TelemetryPatternsSection payload={payload} />,
      },
    );
    return nextWidgets;
  }, [
    activeTimeWindow,
    filters,
    onFiltersChange,
    payload,
    payloadWindowLabel,
    rankedDelayCandidates,
    rankedHeatmapCells,
    showMap,
  ]);

  return (
    <main className="spatial-analytics-page">
      <header className="coverage-bundles-hero spatial-analytics-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Romlig analyse</h1>
          <p>Siste beregning {time(payload.generatedAt)}</p>
        </div>
        <SpatialLiveStatus payload={payload} />
        <div className="coverage-bundles-actions">
          {onRefresh ? (
            <button disabled={isRefreshing} onClick={onRefresh} type="button">
              {isRefreshing ? "Oppdaterer..." : "Oppdater nå"}
            </button>
          ) : null}
          <Link to="/command">Kommandosenter</Link>
          <Link to="/command/tidslinje">Tidslinje</Link>
          <Link to="/command/radata">Rådata</Link>
        </div>
      </header>
      <section className="coverage-bundles-summary spatial-analytics-summary">
        <article>
          <strong>{payload.summary.heatmapCells}</strong>
          <span>Romlige celler</span>
        </article>
        <article>
          <strong>{payload.summary.observations}</strong>
          <span>Observasjoner</span>
        </article>
        <article>
          <strong>{payload.summary.unexplainedDelays}</strong>
          <span>Uforklarte forsinkelser</span>
        </article>
        <article>
          <strong>{payload.summary.criticalDelays}</strong>
          <span>Kritiske køsignaler</span>
        </article>
        <article>
          <strong>{trustedSignalCount(payload)}</strong>
          <span>Bekreftet/sannsynlig</span>
        </article>
      </section>
      <DashboardGrid
        ariaLabel="Romlig analysemoduler"
        configMode="toggle"
        description="Dra og størrelsesjuster romlige analysemoduler for dagens operatørarbeid."
        label="Modulært kommandosenter"
        storageKey="nytt-spatial-analytics-dashboard-v1"
        title="Romlig arbeidsflate"
        widgets={widgets}
      />
    </main>
  );
}

export function SpatialAnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const filters = useMemo(() => parseFilters(search), [search]);
  const [payload, setPayload] = useState<CommandCenterSpatialAnalyticsPayload>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let ignore = false;
    setError(undefined);
    setRefreshing(true);
    api
      .spatialAnalytics(spatialAnalyticsLiveFilters(filters))
      .then((nextPayload) => {
        if (!ignore) setPayload(nextPayload);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      })
      .finally(() => {
        if (!ignore) setRefreshing(false);
      });
    return () => {
      ignore = true;
    };
  }, [attempt, filters]);

  useEffect(() => {
    if (!payload) return;
    const intervalSeconds = Math.max(15, payload.live.refreshIntervalSeconds);
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
    }, intervalSeconds * 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [payload?.generatedAt, payload?.live.refreshIntervalSeconds]);

  function updateFilters(nextFilters: SpatialAnalyticsFilters) {
    setSearchParams(buildSearch(nextFilters), { replace: true });
  }

  if (error) {
    return (
      <main className="fatal-error coverage-bundles-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igjen
        </button>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="loading">
        <h1>Romlig analyse</h1>
        <p>Henter signaler...</p>
      </main>
    );
  }

  return (
    <SpatialAnalyticsDashboard
      filters={filters}
      isRefreshing={refreshing}
      onRefresh={() => setAttempt((value) => value + 1)}
      onFiltersChange={updateFilters}
      payload={payload}
    />
  );
}
