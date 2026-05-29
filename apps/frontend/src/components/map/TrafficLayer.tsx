import type { Feature, Geometry } from "geojson";
import type { TrafficEventSeverity, TrafficMapEvent } from "@nytt/shared";
import { CircleMarker, GeoJSON, Popup } from "react-leaflet";

interface TrafficLayerProps {
  events: TrafficMapEvent[];
  highlightedEventIds?: string[];
}

const severityRadius: Record<TrafficEventSeverity, number> = {
  low: 6,
  medium: 8,
  high: 10,
  critical: 12,
};

const severityWeight: Record<TrafficEventSeverity, number> = {
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

function pointFromGeometry(geometry: Geometry): [number, number] | undefined {
  if (geometry.type !== "Point") return undefined;
  const lng = geometry.coordinates[0];
  const lat = geometry.coordinates[1];
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  return [lat, lng];
}

function formatTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function categoryLabel(category: TrafficMapEvent["category"]) {
  switch (category) {
    case "roadworks":
      return "Veiarbeid";
    case "accident":
      return "Ulykke";
    case "closure":
      return "Stengt vei";
    case "congestion":
      return "Kø/forsinkelse";
    case "weather":
      return "Vær/føre";
    case "restriction":
      return "Restriksjon";
    case "obstruction":
      return "Hindring";
    default:
      return "Annen trafikkhendelse";
  }
}

function severityLabel(severity: TrafficEventSeverity) {
  switch (severity) {
    case "critical":
      return "kritisk";
    case "high":
      return "høy";
    case "medium":
      return "middels";
    default:
      return "lav";
  }
}

function sourceLabel(source: TrafficMapEvent["source"]) {
  switch (source) {
    case "vegvesen_traffic_info":
      return "Statens vegvesen";
    case "datex":
    default:
      return "DATEX";
  }
}

function TrafficPopup({ event }: { event: TrafficMapEvent }) {
  const validFrom = formatTime(event.validFrom);
  const validTo = formatTime(event.validTo);

  return (
    <Popup>
      <article className="traffic-popup">
        <strong>{event.title}</strong>
        <p>
          {categoryLabel(event.category)} · {severityLabel(event.severity)} ·{" "}
          {sourceLabel(event.source)}
        </p>
        {event.description ? <p>{event.description}</p> : null}
        {event.locationName ? (
          <p>
            <strong>Sted:</strong> {event.locationName}
          </p>
        ) : null}
        {validFrom ? (
          <p>
            <strong>Fra:</strong> {validFrom}
          </p>
        ) : null}
        {validTo ? (
          <p>
            <strong>Til:</strong> {validTo}
          </p>
        ) : null}
        {event.relatedArticles?.length ? (
          <section className="traffic-popup-related">
            <strong>Relaterte saker</strong>
            <ul>
              {event.relatedArticles.map((article) => (
                <li key={article.id}>
                  <a href={article.url} target="_blank" rel="noreferrer">
                    {article.title}
                  </a>{" "}
                  <small>{article.distanceMeters} m unna</small>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {event.sourceUrl ? (
          <a href={event.sourceUrl} target="_blank" rel="noreferrer">
            Åpne kilde
          </a>
        ) : null}
      </article>
    </Popup>
  );
}

export function TrafficLayer({ events, highlightedEventIds = [] }: TrafficLayerProps) {
  const highlightedIds = new Set(highlightedEventIds);
  return (
    <>
      {events.map((event) => {
        const highlighted = highlightedIds.has(event.id);
        const point = pointFromGeometry(event.geometry);
        const eventClassName = `traffic-event traffic-event-${event.source} traffic-event-${event.category} traffic-event-${event.severity} traffic-event-${event.state}${highlighted ? " traffic-event-highlighted" : ""}`;
        const pathOptions = {
          className: eventClassName,
          weight: severityWeight[event.severity] + (highlighted ? 3 : 0),
          opacity: highlighted ? 1 : event.state === "planned" ? 0.65 : 0.95,
          fillOpacity: highlighted ? 0.45 : event.state === "planned" ? 0.2 : 0.3,
        };

        if (point) {
          return (
            <CircleMarker
              key={`${event.id}:${eventClassName}`}
              center={point}
              radius={severityRadius[event.severity] + (highlighted ? 4 : 0)}
              className={eventClassName}
              pathOptions={pathOptions}
            >
              <TrafficPopup event={event} />
            </CircleMarker>
          );
        }

        const feature: Feature<Geometry> = {
          type: "Feature",
          geometry: event.geometry,
          properties: {
            id: event.id,
            category: event.category,
            severity: event.severity,
          },
        };

        return (
          <GeoJSON key={`${event.id}:${eventClassName}`} data={feature} style={() => pathOptions}>
            <TrafficPopup event={event} />
          </GeoJSON>
        );
      })}
    </>
  );
}
