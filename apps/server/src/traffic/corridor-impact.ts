import type {
  TrafficCorridorImpact,
  TrafficEventSeverity,
  TrafficMapEvent,
  TrafficPulseCorridor,
} from "@nytt/shared";
import type { Coordinate, CoordinateSegment } from "./geo.js";
import {
  coordinatesFromGeometry,
  coordinateSegmentsFromGeometry,
  distancePointToSegmentMeters,
  distanceSegmentToSegmentMeters,
} from "./geo.js";
import { trondheimCorridors } from "./corridors.js";

const severityRank: Record<TrafficEventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const trafficPulseStateRank: Record<TrafficPulseCorridor["state"], number> = {
  free_flow: 1,
  stale: 2,
  slow: 3,
  congested: 4,
};

function segmentsFromPolyline(polyline: Coordinate[]): CoordinateSegment[] {
  const segments: CoordinateSegment[] = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    if (start && end) segments.push([start, end]);
  }
  return segments;
}

function pointNearPolyline(
  point: Coordinate,
  polyline: Coordinate[],
  corridorSegments: CoordinateSegment[],
  bufferMeters: number,
): boolean {
  const [firstPoint] = polyline;
  if (!firstPoint) return false;
  if (corridorSegments.length === 0) {
    return distancePointToSegmentMeters(point, firstPoint, firstPoint) <= bufferMeters;
  }
  return corridorSegments.some(
    (segment) => distancePointToSegmentMeters(point, segment[0], segment[1]) <= bufferMeters,
  );
}

function eventNearCorridor(
  event: TrafficMapEvent,
  polyline: Coordinate[],
  bufferMeters: number,
): boolean {
  const corridorSegments = segmentsFromPolyline(polyline);
  const eventCoordinates = coordinatesFromGeometry(event.geometry);
  const eventSegments = coordinateSegmentsFromGeometry(event.geometry);

  if (
    eventCoordinates.some((coordinate) =>
      pointNearPolyline(coordinate, polyline, corridorSegments, bufferMeters),
    )
  ) {
    return true;
  }

  if (corridorSegments.length === 0) return false;
  return eventSegments.some((eventSegment) =>
    corridorSegments.some(
      (corridorSegment) =>
        distanceSegmentToSegmentMeters(eventSegment, corridorSegment) <= bufferMeters,
    ),
  );
}

function highestSeverity(events: TrafficMapEvent[]): TrafficEventSeverity {
  return (
    [...events].sort((left, right) => severityRank[right.severity] - severityRank[left.severity])[0]
      ?.severity ?? "low"
  );
}

function numericRank(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function compareTrafficPulseImpact(
  left: TrafficPulseCorridor,
  right: TrafficPulseCorridor,
): number {
  return (
    numericRank(right.delaySeconds) - numericRank(left.delaySeconds) ||
    numericRank(right.delayRatio) - numericRank(left.delayRatio) ||
    trafficPulseStateRank[right.state] - trafficPulseStateRank[left.state] ||
    left.name.localeCompare(right.name, "nb") ||
    left.id.localeCompare(right.id)
  );
}

function worstTravelTimeForCorridor(
  trafficPulse: TrafficPulseCorridor[],
  travelTimeLocationIds?: string[],
): TrafficPulseCorridor | undefined {
  if (!travelTimeLocationIds?.length) return undefined;
  const locationIds = new Set(travelTimeLocationIds);
  return trafficPulse
    .filter((corridor) => locationIds.has(corridor.id))
    .sort(compareTrafficPulseImpact)[0];
}

export function buildCorridorImpacts(
  events: TrafficMapEvent[],
  trafficPulse: TrafficPulseCorridor[] = [],
): TrafficCorridorImpact[] {
  return trondheimCorridors.map((corridor) => {
    const affectedEvents = events.filter((event) =>
      eventNearCorridor(event, corridor.polyline, corridor.bufferMeters),
    );
    const travelTime = worstTravelTimeForCorridor(trafficPulse, corridor.travelTimeLocationIds);

    return {
      id: corridor.id,
      name: corridor.name,
      affectedEventIds: affectedEvents.map((event) => event.id),
      eventCount: affectedEvents.length,
      highestSeverity: highestSeverity(affectedEvents),
      ...(travelTime ? { travelTime } : {}),
    };
  });
}
