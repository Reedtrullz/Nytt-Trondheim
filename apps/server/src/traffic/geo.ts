import type { Geometry, Position } from "geojson";

export type Coordinate = [number, number];
export type CoordinateSegment = [Coordinate, Coordinate];

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function projectedMeters(coordinate: Coordinate, originLat: number): ProjectedPoint {
  const [lng, lat] = coordinate;
  return {
    x: toRadians(lng) * EARTH_RADIUS_METERS * Math.cos(toRadians(originLat)),
    y: toRadians(lat) * EARTH_RADIUS_METERS,
  };
}

function lineSegments(coordinates: Coordinate[], closeRing = false): CoordinateSegment[] {
  const segments: CoordinateSegment[] = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (start && end) segments.push([start, end]);
  }
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (closeRing && first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    segments.push([last, first]);
  }
  return segments;
}

function ringSegments(rings: Position[][]): CoordinateSegment[] {
  return rings.flatMap((ring) => lineSegments(coordinatesFromPositions(ring), true));
}

function coordinatesFromPositions(positions: Position[]): Coordinate[] {
  return positions
    .map(coordinateFromPosition)
    .filter((coordinate): coordinate is Coordinate => Boolean(coordinate));
}

function orientation(a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint): boolean {
  return (
    b.x <= Math.max(a.x, c.x) + 1e-9 &&
    b.x + 1e-9 >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) + 1e-9 &&
    b.y + 1e-9 >= Math.min(a.y, c.y)
  );
}

function projectedSegmentsIntersect(
  a1: ProjectedPoint,
  a2: ProjectedPoint,
  b1: ProjectedPoint,
  b2: ProjectedPoint,
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  return o4 === 0 && onSegment(b1, a2, b2);
}

export function positionsFromGeometry(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "LineString":
    case "MultiPoint":
      return geometry.coordinates;
    case "Polygon":
    case "MultiLineString":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(positionsFromGeometry);
    default:
      return [];
  }
}

export function coordinateFromPosition(position: Position): Coordinate | undefined {
  const lng = position[0];
  const lat = position[1];
  if (typeof lng !== "number" || typeof lat !== "number") return undefined;
  return [lng, lat];
}

export function coordinatesFromGeometry(geometry: Geometry): Coordinate[] {
  return coordinatesFromPositions(positionsFromGeometry(geometry));
}

export function coordinateSegmentsFromGeometry(geometry: Geometry): CoordinateSegment[] {
  switch (geometry.type) {
    case "LineString":
      return lineSegments(coordinatesFromPositions(geometry.coordinates));
    case "Polygon":
      return ringSegments(geometry.coordinates);
    case "MultiLineString":
      return geometry.coordinates.flatMap((line) => lineSegments(coordinatesFromPositions(line)));
    case "MultiPolygon":
      return geometry.coordinates.flatMap((polygon) => ringSegments(polygon));
    case "GeometryCollection":
      return geometry.geometries.flatMap(coordinateSegmentsFromGeometry);
    default:
      return [];
  }
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const p1 = toRadians(lat1);
  const p2 = toRadians(lat2);
  const dp = toRadians(lat2 - lat1);
  const dl = toRadians(lng2 - lng1);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distancePointToSegmentMeters(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number {
  const originLat = point[1];
  const p = projectedMeters(point, originLat);
  const a = projectedMeters(start, originLat);
  const b = projectedMeters(end, originLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segmentLengthSquared = dx * dx + dy * dy;
  if (segmentLengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / segmentLengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceSegmentToSegmentMeters(
  first: CoordinateSegment,
  second: CoordinateSegment,
): number {
  const originLat = (first[0][1] + first[1][1] + second[0][1] + second[1][1]) / 4;
  const a1 = projectedMeters(first[0], originLat);
  const a2 = projectedMeters(first[1], originLat);
  const b1 = projectedMeters(second[0], originLat);
  const b2 = projectedMeters(second[1], originLat);
  if (projectedSegmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    distancePointToSegmentMeters(first[0], second[0], second[1]),
    distancePointToSegmentMeters(first[1], second[0], second[1]),
    distancePointToSegmentMeters(second[0], first[0], first[1]),
    distancePointToSegmentMeters(second[1], first[0], first[1]),
  );
}

export function geometryIntersectsBounds(geometry: Geometry, bounds: Bounds): boolean {
  const coordinates = coordinatesFromGeometry(geometry);
  if (coordinates.length === 0) return false;

  const lngs = coordinates.map(([lng]) => lng);
  const lats = coordinates.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  return maxLat >= bounds.south && minLat <= bounds.north && maxLng >= bounds.west && minLng <= bounds.east;
}
