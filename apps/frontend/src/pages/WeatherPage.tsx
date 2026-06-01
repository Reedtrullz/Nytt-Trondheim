import { MapContainer, TileLayer } from "react-leaflet";
import { ArrowIcon } from "../components/Icons.js";

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

interface WeatherMetric {
  icon: WeatherIconName;
  label: string;
  value: string;
  detail: string;
}

interface HourlyForecast {
  time: string;
  icon: WeatherIconName;
  temp: string;
  precipitation: string;
}

interface ImpactItem {
  icon: WeatherIconName;
  title: string;
  status: string;
  severity: "low" | "medium" | "elevated";
  description: string;
  source: string;
  action: string;
}

interface EventItem {
  icon: WeatherIconName;
  title: string;
  description: string;
  time: string;
}

interface WarningRow {
  source: string;
  type: string;
  area: string;
  level: "Grønt" | "Gult" | "Oransje";
  validUntil: string;
}

const metrics: WeatherMetric[] = [
  { icon: "wind", label: "Vind", value: "4 m/s", detail: "Sørvest" },
  { icon: "drop", label: "Nedbør siste time", value: "1,1 mm", detail: "Lokale byger" },
  { icon: "thermometer", label: "Lufttemperatur", value: "7°", detail: "Føles som 5°" },
];

const hourlyForecast: HourlyForecast[] = [
  { time: "12:00", icon: "cloudRain", temp: "7°", precipitation: "1,1" },
  { time: "13:00", icon: "cloudRain", temp: "7°", precipitation: "0,9" },
  { time: "14:00", icon: "cloudRain", temp: "7°", precipitation: "0,7" },
  { time: "15:00", icon: "cloudRain", temp: "8°", precipitation: "0,6" },
  { time: "16:00", icon: "cloudRain", temp: "8°", precipitation: "0,5" },
  { time: "17:00", icon: "sunCloud", temp: "7°", precipitation: "0,4" },
];

const impactItems: ImpactItem[] = [
  {
    icon: "car",
    title: "Trafikk",
    status: "Våte veger",
    severity: "medium",
    description: "Flere strekninger har redusert sikt og våt veibane.",
    source: "Statens vegvesen",
    action: "Se trafikkart",
  },
  {
    icon: "bus",
    title: "Kollektiv",
    status: "Normal drift",
    severity: "low",
    description: "Noe lengre reisetid kan oppstå på utsatte ruter.",
    source: "AtB",
    action: "Se reiseinfo",
  },
  {
    icon: "warning",
    title: "Skoler og arrangement",
    status: "Værforbehold",
    severity: "medium",
    description: "Flere uteaktiviteter kan bli berørt ved kraftige byger.",
    source: "Trondheim kommune",
    action: "Se oversikt",
  },
  {
    icon: "water",
    title: "Beredskap",
    status: "Forhøyet beredskap",
    severity: "elevated",
    description: "Våte forhold og overvann kan gi lokale utfordringer.",
    source: "Trondheim kommune",
    action: "Se råd",
  },
];

const weatherEvents: EventItem[] = [
  {
    icon: "cloudRain",
    title: "Kraftige regnbyger over Fosen og Trondheim",
    description: "Lokalt 15-20 mm siste 3 timer.",
    time: "12:02",
  },
  {
    icon: "water",
    title: "Vannstand i Nidelva stiger",
    description: "Nå på 62 cm og økende.",
    time: "11:48",
  },
  {
    icon: "wind",
    title: "Frisk bris flere steder",
    description: "Kast i vind opp mot 12 m/s på utsatte områder.",
    time: "11:30",
  },
  {
    icon: "warning",
    title: "Gult farevarsel for regn gjelder",
    description: "Frem til i morgen kl. 21:00.",
    time: "10:45",
  },
];

const warningRows: WarningRow[] = [
  {
    source: "MET",
    type: "Kraftig regn",
    area: "Trøndelag",
    level: "Gult",
    validUntil: "I morgen 21:00",
  },
  {
    source: "NVE",
    type: "Flomvarsel",
    area: "Nidelva",
    level: "Grønt",
    validUntil: "I morgen 18:00",
  },
  {
    source: "NVE",
    type: "Jordskredfare",
    area: "Trøndelag",
    level: "Gult",
    validUntil: "I morgen 18:00",
  },
  {
    source: "Vegvesen",
    type: "Førevarsel",
    area: "Trøndelag",
    level: "Gult",
    validUntil: "I morgen 12:00",
  },
];
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

function SourceLink({ children }: { children: string }) {
  return (
    <a href="/" onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  );
}

export function WeatherPage() {
  return (
    <main className="weather-page">
      <header className="weather-hero">
        <div>
          <h1>Vær</h1>
          <p>
            Oppdatert 12:08 · Kilder: <SourceLink>MET</SourceLink>, <SourceLink>NVE</SourceLink>,{" "}
            <SourceLink>Statens vegvesen</SourceLink>
          </p>
        </div>
      </header>

      <section className="weather-impact-grid" aria-label="Værstatus">
        <article className="weather-current-panel">
          <div className="weather-panel-heading">
            <div>
              <h2>Trondheim nå</h2>
              <p>Torget</p>
            </div>
          </div>
          <div className="weather-now">
            <WeatherIcon name="cloudRain" />
            <strong>7°</strong>
            <div>
              <h3>Regnbyger</h3>
              <p>Føles som 5°</p>
            </div>
          </div>
          <dl className="weather-metrics">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <WeatherIcon name={metric.icon} />
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
                <small>{metric.detail}</small>
              </div>
            ))}
          </dl>
          <section className="hourly-strip" aria-label="Neste timer">
            <h3>Neste timer</h3>
            <div className="hourly-grid">
              {hourlyForecast.map((hour) => (
                <article key={hour.time}>
                  <time>{hour.time}</time>
                  <WeatherIcon name={hour.icon} />
                  <strong>{hour.temp}</strong>
                  <span>{hour.precipitation}</span>
                </article>
              ))}
            </div>
            <p>Nedbør (mm)</p>
          </section>
        </article>

        <article className="weather-map-panel">
          <div className="weather-panel-heading">
            <div>
              <h2>Dagens værbilde</h2>
              <p>Radar, farevarsler og lokale målinger</p>
            </div>
            <a href="/" onClick={(event) => event.preventDefault()}>
              Se fullskjerm <ArrowIcon />
            </a>
          </div>
          <div className="weather-map-visual" aria-label="Kart med radar og farevarsler">
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
            <div className="warning-area warning-area-north">
              <WeatherIcon name="warning" />
            </div>
            <div className="warning-area warning-area-south">
              <WeatherIcon name="warning" />
            </div>
            <span className="station station-green station-one" />
            <span className="station station-yellow station-two" />
            <span className="station station-green station-three" />
            <span className="station station-blue station-four" />
            <div className="weather-map-legend">
              <span>Nedbør mm/t</span>
              <i />
              <small>0,1</small>
              <small>1</small>
              <small>5</small>
              <small>20+</small>
            </div>
          </div>
          <div className="weather-brief">
            <h3>Kort fortalt</h3>
            <ul>
              <li>Regn og byger fortsetter ut ettermiddagen. Mest nedbør i ytre strøk.</li>
              <li>Temperaturen holder seg mellom 6 og 8 grader.</li>
              <li>Frisk bris fra sørvest. Kast i vind opp mot 12 m/s utsatt til.</li>
              <li>Lav risiko for flom i vassdrag. Våt bekk og overvann lokalt.</li>
            </ul>
          </div>
        </article>

        <aside className="weather-impact-panel" aria-label="Hva påvirkes">
          <h2>Hva påvirkes</h2>
          <div className="impact-list">
            {impactItems.map((item) => (
              <article className={`impact-card ${item.severity}`} key={item.title}>
                <div className="impact-icon">
                  <WeatherIcon name={item.icon} />
                </div>
                <div>
                  <header>
                    <h3>{item.title}</h3>
                    <strong>{item.status}</strong>
                  </header>
                  <p>{item.description}</p>
                  <footer>
                    <span>Kilde: {item.source}</span>
                    <a href="/" onClick={(event) => event.preventDefault()}>
                      {item.action} <ArrowIcon />
                    </a>
                  </footer>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="weather-bottom-grid">
        <article className="weather-events-panel">
          <h2>Siste værhendelser</h2>
          <div className="weather-event-list">
            {weatherEvents.map((item) => (
              <a href="/" key={item.title} onClick={(event) => event.preventDefault()}>
                <WeatherIcon name={item.icon} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <time>{item.time}</time>
                <ArrowIcon />
              </a>
            ))}
          </div>
          <a className="weather-panel-link" href="/" onClick={(event) => event.preventDefault()}>
            Se alle hendelser <ArrowIcon />
          </a>
        </article>

        <article className="weather-warning-panel">
          <h2>Varsler og terskler</h2>
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
              {warningRows.map((row) => (
                <tr key={`${row.source}-${row.type}`}>
                  <td data-label="Kilde">{row.source}</td>
                  <td data-label="Type">{row.type}</td>
                  <td data-label="Område">{row.area}</td>
                  <td data-label="Nivå">
                    <span className={`warning-level level-${row.level.toLowerCase()}`}>
                      {row.level}
                    </span>
                  </td>
                  <td data-label="Gyldig til">{row.validUntil}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <a className="weather-panel-link" href="/" onClick={(event) => event.preventDefault()}>
            Se alle varsler og terskler <ArrowIcon />
          </a>
        </article>
      </section>
    </main>
  );
}
