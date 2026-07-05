import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { GeoJsonObject } from "geojson";
import type { PathOptions } from "leaflet";
import { Circle, GeoJSON, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type {
  SourceHealth,
  WeatherForecastLocation,
  WeatherForecastZone,
  WeatherDataStatus,
  WeatherHourlyPoint,
  WeatherImpactGroup,
  WeatherMapLayer,
  WeatherPreparednessPayload,
  WeatherRiskItem,
  WeatherRiskLevel,
  WeatherWarningSummary,
} from "@nytt/shared";
import { fetchWeatherPreparedness } from "../api/weatherPreparedness.js";
import { ArrowIcon } from "../components/Icons.js";
import { MapAccessibility } from "../components/map/MapAccessibility.js";
import { RoadContextLayer } from "../components/map/RoadContextLayer.js";
import type { LeafletBounds } from "../mapCoordinates.js";
import { safeExternalUrl } from "../safeExternalUrl.js";
import {
  groupWeatherMapLayers,
  visibleWeatherImpacts,
  visibleWeatherWarnings,
  weatherConsequenceZones,
  weatherMapBounds,
  weatherRoadStations,
} from "../weatherMapModel.js";

type WeatherIconName =
  | "bus"
  | "car"
  | "cloudRain"
  | "drop"
  | "sunCloud"
  | "thermometer"
  | "warning"
  | "water"
  | "wind";

const tiles = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";
const trondheimCenter: [number, number] = [63.4305, 10.3951];

interface WeatherMapVisibility {
  roadWeather: boolean;
  warnings: boolean;
  consequences: boolean;
  planned: boolean;
}

function WeatherIcon({ name }: { name: WeatherIconName }) {
  return (
    <svg className={`weather-icon weather-icon-${name}`} viewBox="0 0 48 48" aria-hidden="true">
      {name === "cloudRain" ? (
        <>
          <path d="M15.5 27.5h19.2a8.2 8.2 0 0 0 1.2-16.3A12.5 12.5 0 0 0 12.2 16a5.9 5.9 0 0 0 3.3 11.5Z" />
          <path d="m16 34-2 5M24 34l-2 5M32 34l-2 5" />
        </>
      ) : null}
      {name === "sunCloud" ? (
        <>
          <path d="M31 9v4M41 19h-4M37.7 12.3l-2.8 2.8M28 22a8 8 0 1 0 0-16" />
          <path d="M13.7 35h20.1a7 7 0 0 0 .9-13.9A10.5 10.5 0 0 0 15 25a5 5 0 0 0-1.3 10Z" />
        </>
      ) : null}
      {name === "wind" ? (
        <>
          <path d="M7 17h22a5 5 0 1 0-4.5-7" />
          <path d="M7 25h30a4.5 4.5 0 1 1-4.1 6.4" />
          <path d="M7 33h16" />
        </>
      ) : null}
      {name === "drop" ? <path d="M24 6s12 14 12 24a12 12 0 0 1-24 0C12 20 24 6 24 6Z" /> : null}
      {name === "thermometer" ? (
        <>
          <path d="M20 27.5V10a4 4 0 0 1 8 0v17.5a9 9 0 1 1-8 0Z" />
          <path d="M24 14v18" />
        </>
      ) : null}
      {name === "car" ? (
        <>
          <path d="M10 28h28l-3-11H13l-3 11Z" />
          <path d="M11 28v8h5l1.5-3h13L32 36h5v-8" />
          <path d="M16 28h1M31 28h1" />
        </>
      ) : null}
      {name === "bus" ? (
        <>
          <path d="M13 9h22a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V13a4 4 0 0 1 4-4Z" />
          <path d="M9 23h30M15 37l-2 4M35 37l-2 4M15 15h18" />
          <path d="M16 31h1M31 31h1" />
        </>
      ) : null}
      {name === "warning" ? (
        <>
          <path d="m24 7 18 33H6L24 7Z" />
          <path d="M24 18v10M24 34h.1" />
        </>
      ) : null}
      {name === "water" ? (
        <>
          <path d="M8 19c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3" />
          <path d="M8 28c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3" />
          <path d="M8 37c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3" />
        </>
      ) : null}
    </svg>
  );
}

function riskIcon(risk: WeatherRiskItem): WeatherIconName {
  switch (risk.key) {
    case "precipitation":
      return "cloudRain";
    case "wind":
      return "wind";
    case "floodLandslide":
      return "water";
    case "roadConditions":
      return "car";
    case "powerTelecom":
      return "warning";
    case "health":
      return "thermometer";
  }
}

function levelText(level: WeatherRiskLevel): string {
  switch (level) {
    case "normal":
      return "Normal";
    case "watch":
      return "Følg med";
    case "warning":
      return "Varsel";
    case "severe":
      return "Alvorlig";
  }
}

function formatNumber(value: number | undefined, suffix: string): string {
  return value === undefined ? "—" : `${Math.round(value * 10) / 10}${suffix}`;
}

function formatTime(value: string | undefined): string {
  if (!value) return "Ikke oppgitt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function formatClock(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function weatherDataStatusText(status: WeatherDataStatus | undefined): string {
  switch (status) {
    case "ok":
      return "Fersk";
    case "partial":
      return "Delvis";
    case "stale":
      return "Utdatert";
    case "unavailable":
      return "Utilgjengelig";
    default:
      return "Ikke bekreftet";
  }
}

function sourceHealthStateText(state: SourceHealth["state"]): string {
  switch (state) {
    case "ok":
      return "OK";
    case "degraded":
      return "Degradert";
    case "disabled":
      return "Av";
    case "awaiting_access":
      return "Venter på tilgang";
  }
}

export function displayWeatherConditionSummary(summary: string | undefined): string {
  const stripped =
    summary?.replace(
      /^MET(?:\s+(?:Locationforecast|Nowcast)(?:\s*\+\s*(?:Locationforecast|Nowcast))?)?:\s*/i,
      "",
    ) ?? "";
  if (!stripped.trim()) return "Prognose ikke bekreftet";
  return `${stripped.slice(0, 1).toLocaleUpperCase("nb")}${stripped.slice(1)}`;
}

function weatherIconForSymbol(symbolCode: string | undefined): WeatherIconName {
  const normalized = `${symbolCode ?? ""}`.toLocaleLowerCase("nb");
  if (normalized.includes("rain") || normalized.includes("snow") || normalized.includes("sleet")) {
    return "cloudRain";
  }
  if (normalized.includes("clear") || normalized.includes("sun")) return "sunCloud";
  if (normalized.includes("fog")) return "wind";
  return "sunCloud";
}

function fallbackLocation(): WeatherForecastLocation {
  return {
    id: "sentrum",
    label: "Sentrum",
    latitude: trondheimCenter[0],
    longitude: trondheimCenter[1],
    description: "Midtbyen og sentrale Trondheim.",
  };
}

function fallbackForecastZone(payload: WeatherPreparednessPayload): WeatherForecastZone {
  const location = payload.location ?? fallbackLocation();
  return {
    location,
    current: payload.current,
    hourly: payload.hourly,
    nowcast: [],
    metadata: [],
    dataStatus: payload.current.dataStatus ?? "partial",
    summary: payload.current.summary,
  };
}

function forecastZones(payload: WeatherPreparednessPayload): WeatherForecastZone[] {
  return payload.forecast?.zones?.length ? payload.forecast.zones : [fallbackForecastZone(payload)];
}

function maxPrecipitation(points: WeatherHourlyPoint[]): number {
  return Math.max(1, ...points.map((point) => point.precipitationMm ?? 0));
}

function dailyForecastSummary(points: WeatherHourlyPoint[]) {
  const nextDay = points.slice(0, 24);
  const temperatures = nextDay
    .map((point) => point.airTemperatureC)
    .filter((value): value is number => typeof value === "number");
  const precipitation = nextDay.reduce((sum, point) => sum + (point.precipitationMm ?? 0), 0);
  const maxWind = Math.max(0, ...nextDay.map((point) => point.windSpeedMps ?? 0));
  return {
    minTemperature: temperatures.length ? Math.min(...temperatures) : undefined,
    maxTemperature: temperatures.length ? Math.max(...temperatures) : undefined,
    precipitation,
    maxWind,
  };
}

function riskSortValue(item: { level: WeatherRiskLevel }): number {
  const rank: Record<WeatherRiskLevel, number> = {
    severe: 4,
    warning: 3,
    watch: 2,
    normal: 1,
  };
  return rank[item.level];
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safeHref = safeExternalUrl(href);
  return safeHref ? (
    <a href={safeHref} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : null;
}

const preferredWeatherSources = ["MET", "NVE/Varsom", "Statens vegvesen DATEX", "DSB"];

function compactWeatherSourceLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLocaleLowerCase("nb");
  if (normalized.includes("met")) return "MET";
  if (normalized.includes("nve") || normalized.includes("varsom")) return "NVE/Varsom";
  if (normalized.includes("vegvesen") || normalized.includes("datex"))
    return "Statens vegvesen DATEX";
  if (
    normalized.includes("dsb") ||
    normalized.includes("nødvarsel") ||
    normalized.includes("sivilforsvaret")
  ) {
    return "DSB";
  }
  if (normalized.includes("trondheim kommune")) return "Trondheim kommune";
  return undefined;
}

export function weatherPreparednessSourceLine(payload: WeatherPreparednessPayload): string {
  const labels = new Set<string>();
  const add = (value: string | undefined) => {
    const label = compactWeatherSourceLabel(value);
    if (label) labels.add(label);
  };

  if (payload.current.dataStatus !== "unavailable") {
    add(payload.current.summary);
    add(payload.current.sourceLabel);
  }
  payload.forecast?.zones.forEach((zone) => {
    if (zone.dataStatus !== "unavailable") {
      add(zone.current.sourceLabel);
      zone.metadata?.forEach((product) => {
        if (product.dataStatus !== "unavailable") add(`MET ${product.product}`);
      });
    }
  });
  payload.quality?.products.forEach((product) => {
    if (product.dataStatus !== "unavailable") add(`MET ${product.product}`);
  });
  payload.risks.forEach((risk) => add(risk.source));
  payload.actions.forEach((action) => add(action.source));
  payload.warnings.forEach((warning) => {
    add(warning.source);
    add(warning.sourceLabel);
  });
  payload.impactGroups.forEach((group) => add(group.source));
  payload.mapLayers.forEach((layer) => add(layer.source));
  payload.authority.links.forEach((link) => add(link.source));
  payload.sources.forEach((source) => {
    if (source.state === "ok" || source.state === "degraded") {
      add(source.label);
      add(source.source);
    }
  });

  const ordered = [
    ...preferredWeatherSources.filter((source) => labels.has(source)),
    ...[...labels].filter((source) => !preferredWeatherSources.includes(source)),
  ].slice(0, 4);

  return ordered.length ? `Kilder: ${ordered.join(", ")}` : "Kildegrunnlag ikke bekreftet ennå";
}

function layerStatus(layer: WeatherMapLayer): string {
  if (layer.status === "available") return "Aktiv i Nytt";
  if (layer.status === "context") return "Kontekst";
  return "Neste lag";
}

function warningLevelClass(level: string): string {
  const normalized = level.toLocaleLowerCase("nb");
  if (normalized.includes("rød")) return "severe";
  if (normalized.includes("oransje")) return "warning";
  if (normalized.includes("gult")) return "watch";
  return "normal";
}

function warningGeometryStyle(level: string): PathOptions {
  const tone = warningLevelClass(level);
  if (tone === "severe") {
    return {
      className: "weather-warning-area weather-warning-area-severe",
      color: "#b5281e",
      fillColor: "#dc3f31",
      fillOpacity: 0.24,
      weight: 2,
    };
  }
  if (tone === "warning") {
    return {
      className: "weather-warning-area weather-warning-area-warning",
      color: "#c65f22",
      fillColor: "#f2842b",
      fillOpacity: 0.2,
      weight: 2,
    };
  }
  if (tone === "watch") {
    return {
      className: "weather-warning-area weather-warning-area-watch",
      color: "#b98d20",
      fillColor: "#e0b431",
      fillOpacity: 0.18,
      weight: 2,
    };
  }
  return {
    className: "weather-warning-area weather-warning-area-normal",
    color: "#3b7f4c",
    fillColor: "#6ca85b",
    fillOpacity: 0.14,
    weight: 2,
  };
}

function consequenceZoneStyle(level: WeatherImpactGroup["level"]): PathOptions {
  if (level === "severe") {
    return {
      className: "weather-consequence-zone weather-consequence-zone-severe",
      color: "#9f1f18",
      fillColor: "#dc3f31",
      fillOpacity: 0.16,
      weight: 2,
      dashArray: "7 5",
    };
  }
  if (level === "warning") {
    return {
      className: "weather-consequence-zone weather-consequence-zone-warning",
      color: "#b45309",
      fillColor: "#f59e0b",
      fillOpacity: 0.14,
      weight: 2,
      dashArray: "7 5",
    };
  }
  if (level === "watch") {
    return {
      className: "weather-consequence-zone weather-consequence-zone-watch",
      color: "#9a7b17",
      fillColor: "#eab308",
      fillOpacity: 0.12,
      weight: 2,
      dashArray: "6 5",
    };
  }
  return {
    className: "weather-consequence-zone weather-consequence-zone-normal",
    color: "#2f7b4d",
    fillColor: "#6ca85b",
    fillOpacity: 0.1,
    weight: 2,
    dashArray: "6 5",
  };
}

function WeatherMapFit({ bounds }: { bounds?: LeafletBounds }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) {
      map.setView(trondheimCenter, 10, { animate: false });
      return;
    }
    if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
      map.setView(bounds[0], Math.max(map.getZoom(), 11), { animate: false });
      return;
    }
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 12, animate: false });
  }, [bounds?.[0][0], bounds?.[0][1], bounds?.[1][0], bounds?.[1][1], map]);

  return null;
}

function WeatherLayerToggle({
  checked,
  count,
  label,
  onChange,
}: {
  checked: boolean;
  count: number;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="weather-map-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
      <strong>{count}</strong>
    </label>
  );
}

function ForecastZoneSelector({
  selected,
  zones,
  onSelect,
}: {
  selected: string;
  zones: WeatherForecastZone[];
  onSelect: (locationId: string) => void;
}) {
  if (zones.length <= 1) return null;
  return (
    <div className="weather-zone-selector" aria-label="Lokale værsoner">
      {zones.map((zone) => {
        const selectedZone = zone.location.id === selected;
        const statusLine =
          zone.dataStatus === "ok" || zone.dataStatus === "partial"
            ? `${formatNumber(zone.current.airTemperatureC, "°")} · ${formatNumber(
                zone.current.precipitationNextHourMm,
                " mm",
              )}`
            : weatherDataStatusText(zone.dataStatus);
        return (
          <button
            type="button"
            aria-pressed={selectedZone}
            className={selectedZone ? "selected" : ""}
            key={zone.location.id}
            onClick={() => onSelect(zone.location.id)}
          >
            <strong>{zone.location.label}</strong>
            <span>
              {statusLine} · {weatherDataStatusText(zone.dataStatus)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ForecastTimeline({ points }: { points: WeatherHourlyPoint[] }) {
  const visiblePoints = points.slice(0, 6);
  const maxPrecip = maxPrecipitation(visiblePoints);

  if (!visiblePoints.length) {
    return (
      <section className="hourly-strip weather-forecast-empty" aria-label="Neste timer">
        <h3>Neste 6 timer</h3>
        <p>Timesvarsel er midlertidig utilgjengelig. Sjekk MET/Yr for full prognose.</p>
      </section>
    );
  }

  return (
    <section className="hourly-strip" aria-label="Neste timer">
      <div className="weather-section-heading">
        <div>
          <h3>Neste 6 timer</h3>
          <p>Nowcast brukes for nærmeste nedbør når MET leverer det.</p>
        </div>
      </div>
      <div className="hourly-grid weather-hourly-forecast">
        {visiblePoints.map((point, index) => (
          <article className={index < 6 ? "near-term" : ""} key={`${point.time}-${index}`}>
            <time dateTime={point.time}>{formatClock(point.time)}</time>
            <WeatherIcon name={weatherIconForSymbol(point.symbolCode)} />
            <strong>{formatNumber(point.airTemperatureC, "°")}</strong>
            <span
              aria-label={`Nedbør ${formatNumber(point.precipitationMm, " mm")}`}
              style={
                {
                  "--precipitation-height": `${Math.max(
                    8,
                    ((point.precipitationMm ?? 0) / maxPrecip) * 42,
                  )}px`,
                } as CSSProperties
              }
            >
              {formatNumber(point.precipitationMm, " mm")}
            </span>
            <small>Vind {formatNumber(point.windSpeedMps, " m/s")}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function DailyForecastSummary({ points }: { points: WeatherHourlyPoint[] }) {
  const summary = dailyForecastSummary(points);
  return (
    <section className="weather-day-summary" aria-label="Neste døgn">
      <h3>Neste døgn</h3>
      <dl>
        <div>
          <dt>Temperatur</dt>
          <dd>
            {formatNumber(summary.minTemperature, "°")} –{" "}
            {formatNumber(summary.maxTemperature, "°")}
          </dd>
        </div>
        <div>
          <dt>Nedbør</dt>
          <dd>{formatNumber(summary.precipitation, " mm")}</dd>
        </div>
        <div>
          <dt>Maks vind</dt>
          <dd>{formatNumber(summary.maxWind, " m/s")}</dd>
        </div>
      </dl>
    </section>
  );
}

function RiskStrip({ risks }: { risks: WeatherRiskItem[] }) {
  const orderedRisks = [...risks].sort((a, b) => riskSortValue(b) - riskSortValue(a));
  if (!orderedRisks.length) {
    return (
      <section className="weather-risk-strip" aria-label="Risikostrip">
        <article className="risk-card normal">
          <WeatherIcon name="sunCloud" />
          <header>
            <h3>Risiko</h3>
            <span>Normal</span>
          </header>
          <strong>Ingen forhøyet risiko i datagrunnlaget</strong>
          <p>Værprognosen mangler ingen særskilte faresignaler akkurat nå.</p>
          <footer>
            <span>Kilde: MET/NVE/DSB</span>
            <small>Lav · Oppdateres fortløpende</small>
          </footer>
        </article>
      </section>
    );
  }

  return (
    <section className="weather-risk-strip" aria-label="Risikostrip">
      {orderedRisks.map((risk) => (
        <article className={`risk-card ${risk.level}`} key={risk.key}>
          <WeatherIcon name={riskIcon(risk)} />
          <header>
            <h3>{risk.label}</h3>
            <span>{levelText(risk.level)}</span>
          </header>
          <strong>{risk.status}</strong>
          <p>{risk.detail}</p>
          <footer>
            <span>Kilde: {risk.source}</span>
            <small>
              {risk.confidence} · {risk.freshness ?? risk.nextChange}
            </small>
          </footer>
        </article>
      ))}
    </section>
  );
}

function ActionsPanel({ actions }: { actions: WeatherPreparednessPayload["actions"] }) {
  const orderedActions = [...actions].sort((a, b) => riskSortValue(b) - riskSortValue(a));
  const primaryActions = orderedActions.slice(0, 2);
  const rest = orderedActions.slice(2);

  return (
    <>
      <h2>Tiltak nå</h2>
      <div className="impact-list">
        {primaryActions.length ? (
          primaryActions.map((action) => (
            <article className={`impact-card ${action.level}`} key={action.id}>
              <div className="impact-icon">
                <WeatherIcon name={action.level === "severe" ? "warning" : "water"} />
              </div>
              <div>
                <header>
                  <h3>{action.title}</h3>
                  <strong>{levelText(action.level)}</strong>
                </header>
                <p>{action.detail}</p>
                <footer>
                  <span>Kilde: {action.source}</span>
                </footer>
              </div>
            </article>
          ))
        ) : (
          <article className="impact-card normal">
            <div className="impact-icon">
              <WeatherIcon name="sunCloud" />
            </div>
            <div>
              <header>
                <h3>Ingen særskilte tiltak akkurat nå</h3>
                <strong>Normal</strong>
              </header>
              <p>Sjekk MET, Varsom og trafikkart hvis du skal ut på utsatt ferdsel.</p>
              <footer>
                <span>Kilde: MET/NVE/DSB</span>
              </footer>
            </div>
          </article>
        )}
      </div>
      {rest.length ? (
        <details className="weather-action-disclosure">
          <summary>Alle tiltak</summary>
          <div className="impact-list">
            {rest.map((action) => (
              <article className={`impact-card ${action.level}`} key={action.id}>
                <div className="impact-icon">
                  <WeatherIcon name={action.level === "severe" ? "warning" : "water"} />
                </div>
                <div>
                  <header>
                    <h3>{action.title}</h3>
                    <strong>{levelText(action.level)}</strong>
                  </header>
                  <p>{action.detail}</p>
                  <footer>
                    <span>Kilde: {action.source}</span>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function WarningsAndImpacts({
  impactGroups,
  warnings,
}: {
  impactGroups: WeatherImpactGroup[];
  warnings: WeatherWarningSummary[];
}) {
  const activeImpacts = visibleWeatherImpacts(impactGroups);
  return (
    <article className="weather-events-panel">
      <h2>Varsler og konsekvenser</h2>
      <div className="weather-alert-summary">
        <div>
          <strong>{warnings.length}</strong>
          <span>offisielle varsler</span>
        </div>
        <div>
          <strong>{activeImpacts.filter((group) => group.level !== "normal").length}</strong>
          <span>lokale konsekvenser</span>
        </div>
      </div>
      <div className="impact-list weather-impact-list-compact">
        {activeImpacts.map((group) => (
          <article className={`impact-card ${group.level}`} key={group.group}>
            <div className="impact-icon">
              <WeatherIcon
                name={
                  group.group === "Transport"
                    ? "bus"
                    : group.group === "Helse"
                      ? "thermometer"
                      : "warning"
                }
              />
            </div>
            <div>
              <header>
                <h3>{group.group}</h3>
                <strong>{group.status}</strong>
              </header>
              <p>{group.detail}</p>
              <footer>
                <span>Kilde: {group.source}</span>
              </footer>
            </div>
          </article>
        ))}
      </div>
    </article>
  );
}

function SourceHealthList({ sources }: { sources: SourceHealth[] }) {
  return (
    <div className="source-health-list">
      {sources.map((source) => (
        <article key={source.source}>
          <strong>{source.label}</strong>
          <span>{sourceHealthStateText(source.state)}</span>
          <p>{source.freshness?.detail ?? source.detail}</p>
        </article>
      ))}
    </div>
  );
}

function WeatherSourceDisclosure({ payload }: { payload: WeatherPreparednessPayload }) {
  const products = payload.quality?.products ?? [];
  return (
    <article className="weather-warning-panel">
      <details className="weather-source-disclosure">
        <summary>
          <span>Kilder og datagrunnlag</span>
          <strong>{weatherDataStatusText(payload.quality?.dataStatus)}</strong>
        </summary>
        <p>{payload.quality?.detail ?? "Værdata er kilde-merket fra MET, NVE og Vegvesen."}</p>
        {products.length ? (
          <div className="weather-product-list">
            {products.map((product) => (
              <article key={`${product.locationId}-${product.product}`}>
                <strong>
                  MET {product.product === "nowcast" ? "Nowcast" : "Locationforecast"} ·{" "}
                  {product.locationId}
                </strong>
                <span>{weatherDataStatusText(product.dataStatus)}</span>
                <p>{product.detail}</p>
              </article>
            ))}
          </div>
        ) : null}
        {payload.warnings.length ? (
          <table>
            <thead>
              <tr>
                <th>Kilde</th>
                <th>Type</th>
                <th>Område</th>
                <th>Nivå</th>
                <th>Gyldig til</th>
              </tr>
            </thead>
            <tbody>
              {payload.warnings.map((warning) => (
                <tr key={warning.id}>
                  <td data-label="Kilde">{warning.sourceLabel}</td>
                  <td data-label="Type">
                    <ExternalLink href={warning.url}>{warning.title}</ExternalLink>
                  </td>
                  <td data-label="Område">{warning.area}</td>
                  <td data-label="Nivå">
                    <span
                      className={`warning-level level-${warning.level.toLocaleLowerCase("nb")}`}
                    >
                      {warning.level}
                    </span>
                  </td>
                  <td data-label="Gyldig til">{formatTime(warning.validUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Ingen aktive MET farevarsler eller NVE/Varsom-varsler i Nytt akkurat nå.</p>
        )}
        <SourceHealthList sources={payload.sources} />
        <section className="authority-card">
          <h3>Myndigheter og sivil beredskap</h3>
          <p>{payload.authority.emergencyAlertStatus}</p>
          <p>{payload.authority.civilDefenceDetail}</p>
          <div className="authority-links">
            {payload.authority.links.map((link) => (
              <ExternalLink href={link.url} key={link.url}>
                {link.label} <ArrowIcon />
              </ExternalLink>
            ))}
          </div>
        </section>
      </details>
    </article>
  );
}

export function WeatherPreparednessMap({ payload }: { payload: WeatherPreparednessPayload }) {
  const [visible, setVisible] = useState<WeatherMapVisibility>({
    roadWeather: true,
    warnings: true,
    consequences: true,
    planned: false,
  });
  const stations = useMemo(() => weatherRoadStations(payload.roadWeather), [payload.roadWeather]);
  const layerGroups = useMemo(() => groupWeatherMapLayers(payload.mapLayers), [payload.mapLayers]);
  const warnings = useMemo(() => visibleWeatherWarnings(payload.warnings), [payload.warnings]);
  const warningGeometries = useMemo(
    () => warnings.filter((warning) => warning.geometry),
    [warnings],
  );
  const impacts = useMemo(
    () => visibleWeatherImpacts(payload.impactGroups),
    [payload.impactGroups],
  );
  const consequenceZones = useMemo(
    () => weatherConsequenceZones(payload.impactGroups),
    [payload.impactGroups],
  );
  const activeLayerLabels = [
    visible.warnings && warnings.length ? "varsler" : undefined,
    visible.roadWeather && stations.length ? "vegvær" : undefined,
    visible.consequences && impacts.length ? "konsekvenser" : undefined,
    visible.planned && layerGroups.planned.length ? "planlagte lag" : undefined,
  ].filter((label): label is string => Boolean(label));
  const mapBounds = useMemo(
    () =>
      weatherMapBounds({
        warnings: visible.warnings ? warningGeometries : [],
        roadWeather: visible.roadWeather ? stations.map((station) => station.observation) : [],
        impactGroups: visible.consequences ? payload.impactGroups : [],
      }),
    [
      payload.impactGroups,
      stations,
      visible.consequences,
      visible.roadWeather,
      visible.warnings,
      warningGeometries,
    ],
  );

  return (
    <article className="weather-map-panel">
      <div className="weather-panel-heading">
        <div>
          <h2>Værkart for Trondheim</h2>
          <p>Sanntidsnære vegværstasjoner, offisielle varsler og konsekvenser med kildemerking</p>
        </div>
      </div>
      <div className="weather-map-toolbar" aria-label="Kartlag for værkart">
        <WeatherLayerToggle
          checked={visible.roadWeather}
          count={stations.length}
          label="Vegværstasjoner"
          onChange={(roadWeather) => setVisible((current) => ({ ...current, roadWeather }))}
        />
        <WeatherLayerToggle
          checked={visible.warnings}
          count={warnings.length}
          label="Offisielle varsler"
          onChange={(warningsVisible) =>
            setVisible((current) => ({ ...current, warnings: warningsVisible }))
          }
        />
        <WeatherLayerToggle
          checked={visible.consequences}
          count={impacts.length}
          label="Konsekvenser"
          onChange={(consequences) => setVisible((current) => ({ ...current, consequences }))}
        />
        <WeatherLayerToggle
          checked={visible.planned}
          count={layerGroups.planned.length}
          label="Planlagte kartlag"
          onChange={(planned) => setVisible((current) => ({ ...current, planned }))}
        />
      </div>
      <div className="weather-map-workspace">
        <div className="weather-map-visual" aria-label="Værkart med lokale målinger">
          <MapContainer
            center={trondheimCenter}
            zoom={10}
            className="weather-leaflet-map"
            scrollWheelZoom={false}
          >
            <TileLayer attribution="© Kartverket" url={tiles} />
            <MapAccessibility label="Værkart for Trondheim" />
            <WeatherMapFit bounds={mapBounds} />
            {visible.warnings
              ? warningGeometries.map((warning) => (
                  <GeoJSON
                    key={warning.id}
                    data={warning.geometry as GeoJsonObject}
                    style={() => warningGeometryStyle(warning.level)}
                  />
                ))
              : null}
            {visible.roadWeather ? (
              <RoadContextLayer weather={stations.map((station) => station.observation)} />
            ) : null}
            {visible.consequences
              ? consequenceZones.map((zone) => (
                  <Circle
                    key={zone.group.group}
                    center={zone.center}
                    radius={zone.radiusMeters}
                    pathOptions={consequenceZoneStyle(zone.group.level)}
                  >
                    <Popup>
                      <article className="weather-consequence-popup">
                        <strong>{zone.group.group}</strong>
                        <p>{zone.group.status}</p>
                        <small>{zone.note}</small>
                      </article>
                    </Popup>
                  </Circle>
                ))
              : null}
          </MapContainer>
          {visible.roadWeather && stations.length === 0 ? (
            <p className="weather-map-empty">
              Ingen vegværstasjoner med gyldig posisjon akkurat nå.
            </p>
          ) : null}
          <div className="weather-map-source-pill">
            {activeLayerLabels.length
              ? `Aktive lag: ${activeLayerLabels.join(", ")} · Kartverket`
              : "Ingen aktive kartlag valgt · Kartverket"}
          </div>
        </div>
        <div className="weather-map-inspector" aria-label="Varsler og konsekvenser i kartet">
          {visible.warnings ? (
            <section>
              <h3>Offisielle varsler</h3>
              {warnings.length ? (
                <ul className="weather-map-warning-list">
                  {warnings.map((warning) => (
                    <li key={warning.id}>
                      <strong>{warning.title}</strong>
                      <span>{warning.area}</span>
                      <small>
                        {warning.sourceLabel} · {warning.level} · til{" "}
                        {formatTime(warning.validUntil)}
                      </small>
                      <em>{warning.geometry ? "Tegnes i kart" : "Uten geometri i kilden"}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Ingen aktive MET- eller NVE-varsler i payloaden.</p>
              )}
            </section>
          ) : null}
          {visible.roadWeather ? (
            <section>
              <h3>Vegvær</h3>
              {stations.length ? (
                <ul className="weather-map-station-list">
                  {stations.map((station) => (
                    <li className={station.level} key={station.observation.id}>
                      <strong>{station.observation.stationName}</strong>
                      <span>{station.status}</span>
                      <small>
                        Vei {formatNumber(station.observation.roadSurfaceTemperatureC, "°")} ·
                        Nedbør {formatNumber(station.observation.precipitationMm, " mm")}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Venter på gyldige DATEX-posisjoner for vegvær.</p>
              )}
            </section>
          ) : null}
          {visible.consequences ? (
            <section>
              <h3>Konsekvenser</h3>
              <ul className="weather-map-impact-list">
                {impacts.map((group) => (
                  <li className={group.level} key={group.group}>
                    <strong>{group.group}</strong>
                    <span>{group.status}</span>
                    <small>{group.source}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {visible.planned ? (
            <section>
              <h3>Planlagte kartlag</h3>
              <ul className="weather-map-layer-status">
                {layerGroups.planned.map((layer) => (
                  <li key={layer.id}>
                    <strong>{layer.title}</strong>
                    <span>{layerStatus(layer)}</span>
                    <small>{layer.detail}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <div className="weather-map-legend">
        <span>
          <i className="normal" /> Normal
        </span>
        <span>
          <i className="watch" /> Følg med
        </span>
        <span>
          <i className="warning" /> Varsel
        </span>
        <span>
          <i className="severe" /> Alvorlig
        </span>
      </div>
    </article>
  );
}

export function WeatherPage() {
  const [payload, setPayload] = useState<WeatherPreparednessPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("sentrum");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    fetchWeatherPreparedness({ signal: controller.signal })
      .then(setPayload)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setPayload(undefined);
        setError(reason instanceof Error ? reason.message : "Kunne ikke hente værberedskap.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const sourceLine = useMemo(() => {
    if (!payload) return "Kilder: MET, NVE/Varsom, Statens vegvesen DATEX, DSB";
    return weatherPreparednessSourceLine(payload);
  }, [payload]);

  const zones = useMemo(() => (payload ? forecastZones(payload) : []), [payload]);
  const selectedZone = useMemo(() => {
    if (!payload) return undefined;
    return (
      zones.find((zone) => zone.location.id === selectedLocationId) ??
      zones.find((zone) => zone.location.id === payload.forecast?.primaryLocationId) ??
      zones[0]
    );
  }, [payload, selectedLocationId, zones]);

  useEffect(() => {
    if (!payload || !zones.length) return;
    if (!zones.some((zone) => zone.location.id === selectedLocationId)) {
      setSelectedLocationId(payload.forecast?.primaryLocationId ?? zones[0]!.location.id);
    }
  }, [payload, selectedLocationId, zones]);

  if (loading && !payload) {
    return <main className="weather-page loading">Henter værberedskap...</main>;
  }

  if (error && !payload) {
    return (
      <main className="weather-page fatal-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Prøv igjen
        </button>
      </main>
    );
  }

  if (!payload) return null;

  const current = selectedZone?.current ?? payload.current;
  const hourly = selectedZone?.hourly.length ? selectedZone.hourly : payload.hourly;
  const hasSevereWarningGeometry = payload.warnings.some(
    (warning) => warning.geometry && (warning.level === "Rødt" || warning.level === "Oransje"),
  );

  return (
    <main className={`weather-page ${hasSevereWarningGeometry ? "has-severe-warning" : ""}`}>
      <header className="weather-hero">
        <div>
          <h1>Vær</h1>
          <p>
            Lokal værprognose · Oppdatert {formatTime(payload.generatedAt)} · {sourceLine}
          </p>
        </div>
      </header>

      <section className="weather-impact-grid" aria-label="Værberedskap">
        <article className="weather-current-panel">
          <div className="weather-panel-heading">
            <div>
              <h2>Nå</h2>
              <p>
                {selectedZone?.location.label ?? "Trondheim"} ·{" "}
                {selectedZone?.location.description ?? "kilde-merket prognose"} ·{" "}
                {weatherDataStatusText(selectedZone?.dataStatus ?? current.dataStatus)}
              </p>
            </div>
          </div>
          <ForecastZoneSelector
            selected={selectedZone?.location.id ?? selectedLocationId}
            zones={zones}
            onSelect={setSelectedLocationId}
          />
          <div className="weather-now">
            <WeatherIcon name={weatherIconForSymbol(current.symbolCode)} />
            <strong>{formatNumber(current.airTemperatureC, "°")}</strong>
            <div>
              <h3>{displayWeatherConditionSummary(current.summary)}</h3>
              <p>
                Nedbør neste time {formatNumber(current.precipitationNextHourMm, " mm")} · Vind{" "}
                {formatNumber(current.windSpeedMps, " m/s")}
              </p>
            </div>
          </div>
          <dl className="weather-metrics">
            <div>
              <WeatherIcon name="drop" />
              <dt>Nedbør</dt>
              <dd>{formatNumber(current.precipitationNextHourMm, " mm")}</dd>
              <dd className="weather-metric-source">
                {current.sourceLabel ?? "MET Locationforecast"}
              </dd>
            </div>
            <div>
              <WeatherIcon name="wind" />
              <dt>Vind</dt>
              <dd>{formatNumber(current.windSpeedMps, " m/s")}</dd>
              <dd className="weather-metric-source">
                {current.sourceLabel ?? "MET Locationforecast"}
              </dd>
            </div>
            <div>
              <WeatherIcon name="thermometer" />
              <dt>Lufttemperatur</dt>
              <dd>{formatNumber(current.airTemperatureC, "°")}</dd>
              <dd className="weather-metric-source">
                {current.sourceLabel ?? "MET Locationforecast"}
              </dd>
            </div>
          </dl>
          <ForecastTimeline points={hourly} />
          <DailyForecastSummary points={hourly} />
          <RiskStrip risks={payload.risks} />
        </article>

        <div className="weather-impact-panel" aria-label="Tiltak og myndigheter">
          <ActionsPanel actions={payload.actions} />
        </div>

        <WeatherPreparednessMap payload={payload} />
      </section>

      <section className="weather-bottom-grid">
        <WarningsAndImpacts impactGroups={payload.impactGroups} warnings={payload.warnings} />
        <WeatherSourceDisclosure payload={payload} />
      </section>
    </main>
  );
}
