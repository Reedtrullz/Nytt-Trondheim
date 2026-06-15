import type { RoadCamera, RoadWeatherObservation, TrafficCounterSnapshot } from "@nytt/shared";
import { CircleMarker, Popup } from "react-leaflet";
import type { Point } from "geojson";
import { latLngFromPoint } from "../../mapCoordinates.js";
import { safeExternalUrl } from "../../safeExternalUrl.js";

interface RoadContextLayerProps {
  weather?: RoadWeatherObservation[];
  cameras?: RoadCamera[];
  counters?: TrafficCounterSnapshot[];
}

const allowedCameraPreviewHosts = new Set([
  "webkamera.vegvesen.no",
  "webkamera.atlas.vegvesen.no",
  "www.vegvesen.no",
]);

function pointCenter(geometry: Point): [number, number] | undefined {
  return latLngFromPoint(geometry);
}

function formatTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits }).format(value);
}

function formatTemperature(value?: number): string | undefined {
  return typeof value === "number" ? `${formatNumber(value)} °C` : undefined;
}

function cameraPreviewUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    return allowedCameraPreviewHosts.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function WeatherPopup({ observation }: { observation: RoadWeatherObservation }) {
  const observedAt = formatTime(observation.observedAt);
  return (
    <Popup>
      <article className="road-context-popup">
        <strong>{observation.stationName}</strong>
        {observedAt ? <p>Observert {observedAt}</p> : null}
        <dl>
          {formatTemperature(observation.airTemperatureC) ? (
            <>
              <dt>Luft</dt>
              <dd>{formatTemperature(observation.airTemperatureC)}</dd>
            </>
          ) : null}
          {formatTemperature(observation.roadSurfaceTemperatureC) ? (
            <>
              <dt>Vei</dt>
              <dd>{formatTemperature(observation.roadSurfaceTemperatureC)}</dd>
            </>
          ) : null}
          {typeof observation.precipitationMm === "number" ? (
            <>
              <dt>Nedbør</dt>
              <dd>{formatNumber(observation.precipitationMm)} mm</dd>
            </>
          ) : null}
          {typeof observation.windSpeedMps === "number" ? (
            <>
              <dt>Vind</dt>
              <dd>{formatNumber(observation.windSpeedMps)} m/s</dd>
            </>
          ) : null}
          {typeof observation.visibilityMeters === "number" ? (
            <>
              <dt>Sikt</dt>
              <dd>{formatNumber(observation.visibilityMeters, 0)} m</dd>
            </>
          ) : null}
        </dl>
        {observation.rawSummary ? <p>{observation.rawSummary}</p> : null}
      </article>
    </Popup>
  );
}

function CameraPopup({ camera }: { camera: RoadCamera }) {
  const previewUrl = cameraPreviewUrl(camera.imageUrl);
  const sourceUrl = safeExternalUrl(camera.sourceUrl);
  const imageUrl = safeExternalUrl(camera.imageUrl);
  return (
    <Popup>
      <article className="road-context-popup road-context-popup-camera">
        <strong>{camera.name}</strong>
        <p>Status: {camera.status}</p>
        {formatTime(camera.updatedAt) ? <p>Oppdatert {formatTime(camera.updatedAt)}</p> : null}
        {previewUrl ? (
          <img src={previewUrl} alt={`Webkamera: ${camera.name}`} loading="lazy" />
        ) : null}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Åpne kamera
          </a>
        ) : imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noreferrer noopener">
            Åpne bilde
          </a>
        ) : null}
      </article>
    </Popup>
  );
}

function CounterPopup({ counter }: { counter: TrafficCounterSnapshot }) {
  const roadLabel = [counter.roadCategory, counter.roadNumber].filter(Boolean).join(" ");
  return (
    <Popup>
      <article className="road-context-popup">
        <strong>{counter.name}</strong>
        {roadLabel ? <p>{roadLabel}</p> : null}
        {counter.municipalityName ? <p>{counter.municipalityName}</p> : null}
        <dl>
          {typeof counter.volumeLastHour === "number" ? (
            <>
              <dt>Siste time</dt>
              <dd>{formatNumber(counter.volumeLastHour, 0)} kjøretøy</dd>
            </>
          ) : null}
          {typeof counter.coveragePercent === "number" ? (
            <>
              <dt>Dekning</dt>
              <dd>{formatNumber(counter.coveragePercent, 0)} %</dd>
            </>
          ) : null}
          {typeof counter.anomalyRatio === "number" ? (
            <>
              <dt>Avvik</dt>
              <dd>{formatNumber(counter.anomalyRatio, 2)}×</dd>
            </>
          ) : null}
        </dl>
        {formatTime(counter.updatedAt) ? <p>Oppdatert {formatTime(counter.updatedAt)}</p> : null}
      </article>
    </Popup>
  );
}

export function RoadContextLayer({
  weather = [],
  cameras = [],
  counters = [],
}: RoadContextLayerProps) {
  return (
    <>
      {weather.flatMap((observation) => {
        const center = pointCenter(observation.geometry);
        if (!center) return [];
        return [
          <CircleMarker
            key={observation.id}
            center={center}
            radius={5}
            pathOptions={{
              className: "road-context-marker road-context-marker-weather",
              opacity: 0.9,
              fillOpacity: 0.75,
              weight: 2,
            }}
          >
            <WeatherPopup observation={observation} />
          </CircleMarker>,
        ];
      })}
      {cameras.flatMap((camera) => {
        const center = pointCenter(camera.geometry);
        if (!center) return [];
        return [
          <CircleMarker
            key={camera.id}
            center={center}
            radius={6}
            pathOptions={{
              className: "road-context-marker road-context-marker-camera",
              opacity: camera.status === "ok" ? 0.9 : 0.55,
              fillOpacity: camera.status === "ok" ? 0.75 : 0.45,
              weight: 2,
            }}
          >
            <CameraPopup camera={camera} />
          </CircleMarker>,
        ];
      })}
      {counters.flatMap((counter) => {
        const center = pointCenter(counter.geometry);
        if (!center) return [];
        return [
          <CircleMarker
            key={counter.id}
            center={center}
            radius={typeof counter.volumeLastHour === "number" ? 7 : 5}
            pathOptions={{
              className: "road-context-marker road-context-marker-counter",
              opacity: 0.9,
              fillOpacity: 0.7,
              weight: 2,
            }}
          >
            <CounterPopup counter={counter} />
          </CircleMarker>,
        ];
      })}
    </>
  );
}
