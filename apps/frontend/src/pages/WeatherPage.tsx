import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type {
  WeatherMapLayer,
  WeatherPreparednessPayload,
  WeatherRiskItem,
  WeatherRiskLevel,
} from "@nytt/shared";
import { fetchWeatherPreparedness } from "../api/weatherPreparedness.js";
import { ArrowIcon } from "../components/Icons.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

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

function layerStatus(layer: WeatherMapLayer): string {
  if (layer.status === "available") return "Aktiv i Nytt";
  if (layer.status === "context") return "Kontekst";
  return "Neste lag";
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
    const sources = payload.sources.map((source) => source.label).slice(0, 4);
    return sources.length
      ? `Kilder: ${sources.join(", ")}`
      : "Kilder: MET, NVE/Varsom, Statens vegvesen DATEX, DSB";
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
            Weather preparedness desk · Oppdatert {formatTime(payload.generatedAt)} · {sourceLine}
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

        <article className="weather-map-panel">
          <div className="weather-panel-heading">
            <div>
              <h2>Varsel- og konsekvenskart</h2>
              <p>Offisielle varselområder og lokale konsekvenslag</p>
            </div>
          </div>
          <div className="weather-map-visual" aria-label="Kart med farevarsler og lokale målinger">
            <MapContainer
              center={[63.4305, 10.3951]}
              zoom={10}
              className="weather-leaflet-map"
              zoomControl={false}
              scrollWheelZoom={false}
              dragging={false}
              attributionControl={false}
            >
              <TileLayer attribution="© Kartverket" url={tiles} />
            </MapContainer>
            <div className="weather-map-label weather-map-label-trondheim">Trondheim</div>
            <div className="weather-map-label weather-map-label-orkanger">Orkanger</div>
            <div className="weather-map-label weather-map-label-malvik">Malvik</div>
            <div className="weather-map-road weather-map-road-main" />
            <div className="weather-map-road weather-map-road-secondary" />
            <div className="rain-band rain-band-heavy" />
            <div className="rain-band rain-band-light" />
            <span className="station station-green station-one" />
            <span className="station station-yellow station-two" />
            <span className="station station-green station-three" />
            <span className="station station-blue station-four" />
          </div>
          <div className="weather-layer-list">
            {payload.mapLayers.map((layer) => (
              <article key={layer.id}>
                <strong>{layer.title}</strong>
                <span>{layerStatus(layer)}</span>
                <p>{layer.detail}</p>
                <small>Kilde: {layer.source}</small>
              </article>
            ))}
          </div>
        </article>

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
