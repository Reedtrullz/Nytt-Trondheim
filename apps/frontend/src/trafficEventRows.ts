import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { sourceDisplayLabel } from "./trafficProvenance.js";

function categoryLabel(category: TrafficMapEvent["category"]): string {
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
      return "Trafikkmelding";
  }
}

function clock(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function delayForEvent(event: TrafficMapEvent, corridors: TrafficCorridorImpact[]): string | undefined {
  const delayMinutes = corridors
    .filter((item) => item.affectedEventIds.includes(event.id))
    .map((item) => item.travelTime?.delaySeconds)
    .filter((delaySeconds): delaySeconds is number =>
      typeof delaySeconds === "number" && Number.isFinite(delaySeconds) && delaySeconds > 0,
    )
    .map((delaySeconds) => Math.max(1, Math.round(delaySeconds / 60)))
    .sort((left, right) => right - left)[0];
  return delayMinutes ? `påvirker reisetid +${delayMinutes} min` : undefined;
}

export function compactTrafficEventRow(
  event: TrafficMapEvent,
  corridors: TrafficCorridorImpact[] = [],
): { title: string; meta: string } {
  return {
    title: event.title,
    meta: [
      categoryLabel(event.category),
      sourceDisplayLabel(event.source),
      `Oppdatert ${clock(event.updatedAt)}`,
      delayForEvent(event, corridors),
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
