import type { Polygon } from "geojson";

const earthRadiusMeters = 6_371_000;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

export type LonLat = [number, number];

export function distanceMeters(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

export function lineDistanceMeters(coordinates: LonLat[]): number {
  return coordinates
    .slice(1)
    .reduce((total, point, index) => total + distanceMeters(coordinates[index]!, point), 0);
}

function projectMeters(point: LonLat, origin: LonLat): [number, number] {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.cos(toRad(origin[1])) * 111_320;
  return [(point[0] - origin[0]) * metersPerDegreeLon, (point[1] - origin[1]) * metersPerDegreeLat];
}

function pointToSegmentDistanceMeters(point: LonLat, a: LonLat, b: LonLat): number {
  const [px, py] = projectMeters(point, point);
  const [ax, ay] = projectMeters(a, point);
  const [bx, by] = projectMeters(b, point);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointToLineDistanceMeters(point: LonLat, line: LonLat[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return distanceMeters(point, line[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < line.length - 1; index += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, line[index]!, line[index + 1]!));
  }
  return best;
}

export function bearingDegrees(a: LonLat, b: LonLat): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destination(center: LonLat, distance: number, bearing: number): LonLat {
  const angularDistance = distance / earthRadiusMeters;
  const brng = toRad(bearing);
  const lat1 = toRad(center[1]);
  const lon1 = toRad(center[0]);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [toDeg(lon2), toDeg(lat2)];
}

export function circlePolygon(center: LonLat, radiusMeters: number, steps = 48): Polygon {
  const ring = Array.from({ length: steps }, (_, index) =>
    destination(center, radiusMeters, (360 * index) / steps),
  );
  ring.push(ring[0]!);
  return { type: "Polygon", coordinates: [ring] };
}

export function sectorPolygon(
  center: LonLat,
  radiusMeters: number,
  startBearing: number,
  endBearing: number,
  steps = 16,
): Polygon {
  const span = (endBearing - startBearing + 360) % 360 || 360;
  const ring: LonLat[] = [center];
  for (let index = 0; index <= steps; index += 1) {
    ring.push(destination(center, radiusMeters, startBearing + (span * index) / steps));
  }
  ring.push(center);
  return { type: "Polygon", coordinates: [ring] };
}

export function polygonAreaSquareMeters(ring: LonLat[]): number {
  const origin: LonLat = ring[0] ?? [0, 0];
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.cos(toRad(origin[1])) * 111_320;
  const projected: Array<[number, number]> = ring.map(([lon, lat]) => [
    (lon - origin[0]) * metersPerDegreeLon,
    (lat - origin[1]) * metersPerDegreeLat,
  ]);
  let sum = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const [x1, y1] = projected[index]!;
    const [x2, y2] = projected[index + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}
