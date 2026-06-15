import type { Feature, Geometry } from "geojson";
import type { TrafficEventSeverity, TrafficMapEvent } from "@nytt/shared";
import { CircleMarker, GeoJSON, Popup } from "react-leaflet";
import { safeExternalUrl } from "../../safeExternalUrl.js";
import { trafficMapObjectsForEvent } from "../../trafficMapObjects.js";

interface TrafficLayerProps {
  events: TrafficMapEvent[];
  highlightedEventIds?: string[];
  showEstimatedNews?: boolean;
  onSelectEvent?: (eventId: string) => void;
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return [lat, lng];
}

function formatTime(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function formatDistance(distanceMeters?: number): string | undefined {
  if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) return undefined;
  if (distanceMeters < 0) return undefined;
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1).replace(".", ",")} km unna`
    : `${Math.round(distanceMeters)} m unna`;
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
  const sourceUrl = safeExternalUrl(event.sourceUrl);

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
              {event.relatedArticles.map((article) => {
                const articleUrl = safeExternalUrl(article.url);
                const distance = formatDistance(article.distanceMeters);
                return (
                  <li key={article.id}>
                    {articleUrl ? (
                      <a href={articleUrl} target="_blank" rel="noreferrer noopener">
                        {article.title}
                      </a>
                    ) : (
                      <span>{article.title}</span>
                    )}{" "}
                    {distance ? <small>{distance}</small> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Åpne kilde
          </a>
        ) : null}
      </article>
    </Popup>
  );
}

export function TrafficLayer({
  events,
  highlightedEventIds = [],
  showEstimatedNews = false,
  onSelectEvent,
}: TrafficLayerProps) {
  const highlightedIds = new Set(highlightedEventIds);
  return (
    <>
      {events.flatMap((event) =>
        trafficMapObjectsForEvent(event, { estimatedNews: showEstimatedNews }).map((object) => {
          if (object.kind === "estimated-news-location") {
            return (
              <CircleMarker
                key={`${object.eventId}:estimated-news:${object.articleId}`}
                center={object.center}
                radius={8}
                className="traffic-estimated-news-location"
                pathOptions={{
                  color: "#7c3aed",
                  fillColor: "#a855f7",
                  fillOpacity: 0.25,
                  opacity: 0.9,
                  weight: 2,
                  dashArray: "4 4",
                  className: "traffic-estimated-news-location",
                }}
                eventHandlers={{ click: () => onSelectEvent?.(object.eventId) }}
              >
                <Popup>Estimert fra nyhetskilde: {object.label}</Popup>
              </CircleMarker>
            );
          }

          const highlighted = highlightedIds.has(event.id);
          const point = pointFromGeometry(object.geometry);
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
                eventHandlers={{ click: () => onSelectEvent?.(event.id) }}
              >
                <TrafficPopup event={event} />
              </CircleMarker>
            );
          }

          if (object.geometry.type === "Point") return null;

          const feature: Feature<Geometry> = {
            type: "Feature",
            geometry: object.geometry,
            properties: {
              id: event.id,
              category: event.category,
              severity: event.severity,
            },
          };

          return (
            <GeoJSON
              key={`${event.id}:${eventClassName}`}
              data={feature}
              style={() => pathOptions}
              eventHandlers={{ click: () => onSelectEvent?.(event.id) }}
            >
              <TrafficPopup event={event} />
            </GeoJSON>
          );
        }),
      )}
    </>
  );
}
