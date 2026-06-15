import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { GeoJsonObject } from "geojson";
import type { PathOptions } from "leaflet";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type {
  WeatherMapLayer,
  WeatherPreparednessPayload,
  WeatherRiskItem,
  WeatherRiskLevel,
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
  return value.trim() || undefined;
}

export function weatherPreparednessSourceLine(payload: WeatherPreparednessPayload): string {
  const labels = new Set<string>();
  const add = (value: string | undefined) => {
    const label = compactWeatherSourceLabel(value);
    if (label) labels.add(label);
  };

  add(payload.current.summary);
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
    add(source.label);
    add(source.source);
  });

  const ordered = [
    ...preferredWeatherSources.filter((source) => labels.has(source)),
    ...[...labels].filter((source) => !preferredWeatherSources.includes(source)),
  ].slice(0, 4);

  return ordered.length
    ? `Kilder: ${ordered.join(", ")}`
    : "Kilder: MET, NVE/Varsom, Statens vegvesen DATEX, DSB";
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
  const mapBounds = useMemo(
    () =>
      weatherMapBounds({
        warnings: visible.warnings ? warningGeometries : [],
        roadWeather: visible.roadWeather ? stations.map((station) => station.observation) : [],
      }),
    [stations, visible.roadWeather, visible.warnings, warningGeometries],
  );
  const impacts = useMemo(
    () => visibleWeatherImpacts(payload.impactGroups),
    [payload.impactGroups],
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
          </MapContainer>
          {visible.roadWeather && stations.length === 0 ? (
            <p className="weather-map-empty">
              Ingen vegværstasjoner med gyldig posisjon akkurat nå.
            </p>
          ) : null}
          <div className="weather-map-source-pill">Aktivt kartlag: DATEX vegvær · Kartverket</div>
        </div>
        <aside className="weather-map-inspector" aria-label="Varsler og konsekvenser i kartet">
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
        </aside>
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
      <div className="weather-layer-list">
        {[...layerGroups.available, ...layerGroups.context].map((layer) => (
          <article key={layer.id}>
            <strong>{layer.title}</strong>
            <span>{layerStatus(layer)}</span>
            <p>{layer.detail}</p>
            <small>Kilde: {layer.source}</small>
          </article>
        ))}
      </div>
    </article>
  );
}

export function WeatherPage() {
  const [payload, setPayload] = useState<WeatherPreparednessPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

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

  return (
    <main className="weather-page">
      <header className="weather-hero">
        <div>
          <h1>Vær</h1>
          <p>
            Værberedskap · Oppdatert {formatTime(payload.generatedAt)} · {sourceLine}
          </p>
        </div>
      </header>

      <section className="weather-impact-grid" aria-label="Værberedskap">
        <article className="weather-current-panel">
          <div className="weather-panel-heading">
            <div>
              <h2>Hva betyr været nå?</h2>
              <p>Trondheim · kilde-merket vurdering, ikke nødvarsel</p>
            </div>
          </div>
          <div className="weather-now">
            <WeatherIcon name="cloudRain" />
            <strong>{formatNumber(payload.current.airTemperatureC, "°")}</strong>
            <div>
              <h3>{payload.current.summary}</h3>
              <p>
                Nedbør neste time {formatNumber(payload.current.precipitationNextHourMm, " mm")} ·
                Vind {formatNumber(payload.current.windSpeedMps, " m/s")}
              </p>
            </div>
          </div>
          <dl className="weather-metrics">
            <div>
              <WeatherIcon name="drop" />
              <dt>Nedbør</dt>
              <dd>{formatNumber(payload.current.precipitationNextHourMm, " mm")}</dd>
              <small>MET Locationforecast</small>
            </div>
            <div>
              <WeatherIcon name="wind" />
              <dt>Vind</dt>
              <dd>{formatNumber(payload.current.windSpeedMps, " m/s")}</dd>
              <small>MET Locationforecast</small>
            </div>
            <div>
              <WeatherIcon name="thermometer" />
              <dt>Lufttemperatur</dt>
              <dd>{formatNumber(payload.current.airTemperatureC, "°")}</dd>
              <small>MET Locationforecast</small>
            </div>
          </dl>
          <section className="weather-risk-strip" aria-label="Risikostrip">
            {payload.risks.map((risk) => (
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
                    {risk.confidence} · {risk.nextChange}
                  </small>
                </footer>
              </article>
            ))}
          </section>
        </article>

        <WeatherPreparednessMap payload={payload} />

        <aside className="weather-impact-panel" aria-label="Tiltak og myndigheter">
          <h2>Tiltak nå</h2>
          <div className="impact-list">
            {payload.actions.map((action) => (
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
        </aside>
      </section>

      <section className="weather-bottom-grid">
        <article className="weather-events-panel">
          <h2>Hvem påvirkes?</h2>
          <div className="impact-list">
            {payload.impactGroups.map((group) => (
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

        <article className="weather-warning-panel">
          <h2>Offisielle varsler og kilder</h2>
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
          <div className="source-health-list">
            {payload.sources.map((source) => (
              <article key={source.source}>
                <strong>{source.label}</strong>
                <span>{source.state}</span>
                <p>{source.detail}</p>
              </article>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
