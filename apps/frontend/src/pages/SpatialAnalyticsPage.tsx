import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  sourceMixConfidenceSummary,
  type CommandCenterSpatialAnalyticsPayload,
  type CommandCenterSpatialAnalyticsQueryInput,
  type SourceConfidenceSummary,
  type SpatialHeatmapCell,
  type SpatialInvestigationQueueItem,
  type UnexplainedDelayCandidate,
} from "@nytt/shared";
import { api } from "../api.js";
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

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
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

function rawSourceItemHref(sourceItemId: string) {
  return `/command/radata?sourceItem=${encodeURIComponent(sourceItemId)}`;
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
                  <p>{candidate.reason}</p>
                  <p>{confidence.rationale}</p>
                </article>
              </Popup>
            </Polyline>
          );
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
          <dt>Mulige saker</dt>
          <dd>{candidate.matchedArticleIds.length}</dd>
        </div>
      </dl>
      {sourceUrl ? (
        <a href={sourceUrl} rel="noreferrer" target="_blank">
          Åpne kilde
        </a>
      ) : null}
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
        {sourceUrl ? (
          <a href={sourceUrl} rel="noreferrer" target="_blank">
            Åpne kilde
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function SpatialAnalyticsDashboard({
  payload,
  filters,
  onFiltersChange,
  showMap = true,
}: {
  payload: CommandCenterSpatialAnalyticsPayload;
  filters: SpatialAnalyticsFilters;
  onFiltersChange: (filters: SpatialAnalyticsFilters) => void;
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

  const activeTimeWindow = spatialTimeWindowForFilters(filters);
  const payloadWindowLabel =
    payload.window.from || payload.window.to
      ? `${time(payload.window.from)} - ${time(payload.window.to)}`
      : "Hele tilgjengelige datasett";

  return (
    <main className="spatial-analytics-page">
      <header className="coverage-bundles-hero spatial-analytics-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Romlig analyse</h1>
          <p>Siste beregning {time(payload.generatedAt)}</p>
        </div>
        <div className="coverage-bundles-actions">
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
      <section className="spatial-analytics-grid">
        <aside className="coverage-bundles-sidebar spatial-analytics-sidebar" aria-label="Filtre">
          <label>
            Tidsrom
            <select
              aria-label="Tidsrom for romlig analyse"
              value={activeTimeWindow}
              onChange={(event) =>
                updateTimeWindow(event.target.value as SpatialAnalyticsTimeWindow)
              }
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
        <div className="spatial-analytics-main">
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
              <p className="spatial-empty-state">
                Ingen prioriterte romlige signaler i analysevinduet.
              </p>
            ) : (
              <div className="spatial-investigation-list">
                {payload.investigationQueue.map((item) => (
                  <InvestigationQueueItemRow item={item} key={item.id} />
                ))}
              </div>
            )}
          </section>
          {showMap ? <SpatialAnalyticsMap payload={payload} /> : null}
          <section className="spatial-delay-panel" aria-labelledby="spatial-delay-heading">
            <div className="spatial-section-heading">
              <div>
                <p className="label">Trafikkpuls</p>
                <h2 id="spatial-delay-heading">Forsinkelser uten kjent årsak</h2>
              </div>
              <span>{payload.unexplainedDelays.length} kandidater</span>
            </div>
            {payload.unexplainedDelays.length === 0 ? (
              <p className="spatial-empty-state">
                Ingen store DATEX-forsinkelser uten koblet trafikkhendelse akkurat nå.
              </p>
            ) : (
              <div className="spatial-delay-list">
                {rankedDelayCandidates.map((candidate) => (
                  <DelayCandidateRow candidate={candidate} key={candidate.id} />
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="spatial-analytics-cells" aria-label="Romlige observasjoner">
          <div className="spatial-section-heading">
            <div>
              <p className="label">Observasjoner</p>
              <h2>Varmepunkter</h2>
            </div>
          </div>
          {payload.heatmapCells.length === 0 ? (
            <p className="spatial-empty-state">Ingen stedfestede observasjoner i vinduet.</p>
          ) : (
            <div className="spatial-cell-list">
              {rankedHeatmapCells.map((cell) => {
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
                      {cell.articleCount} saker · {cell.trafficEventCount} trafikkhendelser · sist
                      sett {time(cell.lastSeenAt)}
                    </span>
                    <span>
                      Først sett {time(cell.firstSeenAt)} · {activeDaysLabel(cell.activeDayCount)}
                    </span>
                    <small>{hotspotReason(cell)}</small>
                    <small>{confidence.rationale}</small>
                    <small>{cell.sourceIds.map(sourceLabel).join(", ")}</small>
                    <SourceItemLinks sourceItemIds={cell.sourceItemIds} />
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </section>
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

  useEffect(() => {
    let ignore = false;
    setError(undefined);
    api
      .spatialAnalytics(filters)
      .then((nextPayload) => {
        if (!ignore) setPayload(nextPayload);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });
    return () => {
      ignore = true;
    };
  }, [attempt, filters]);

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
      onFiltersChange={updateFilters}
      payload={payload}
    />
  );
}
