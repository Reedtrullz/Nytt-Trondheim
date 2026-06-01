import type { Geometry } from "geojson";
import type { TrafficMapEvent } from "@nytt/shared";

export type TrafficMapObject =
  | { kind: "official-road-event"; eventId: string; event: TrafficMapEvent; geometry: Geometry }
  | {
      kind: "estimated-news-location";
      eventId: string;
      articleId: string;
      label: string;
      center: [number, number];
      event: TrafficMapEvent;
    };

function validLatLng(lat: unknown, lng: unknown): [number, number] | undefined {
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return [lat, lng];
}

export function trafficMapObjectsForEvent(
  event: TrafficMapEvent,
  options: { estimatedNews: boolean },
): TrafficMapObject[] {
  const objects: TrafficMapObject[] = [
    { kind: "official-road-event", eventId: event.id, event, geometry: event.geometry },
  ];
  if (options.estimatedNews) {
    for (const article of event.relatedArticles ?? []) {
      const center = validLatLng(article.location?.lat, article.location?.lng);
      if (!center) continue;
      objects.push({
        kind: "estimated-news-location",
        eventId: event.id,
        articleId: article.id,
        label: article.location?.label ?? article.title,
        center,
        event,
      });
    }
  }
  return objects;
}
