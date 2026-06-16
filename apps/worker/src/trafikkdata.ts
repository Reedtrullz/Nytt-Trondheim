import type { Point, Position } from "geojson";
import type { TrafficCounterSnapshot } from "@nytt/shared";
import { fetchWithSourcePolicy, sourceUserAgent } from "./fetchPolicy.js";

export const defaultTrafikkdataGraphqlEndpoint = "https://trafikkdata-api.atlas.vegvesen.no/";

const trondheimRegionBounds = {
  west: 10.05,
  south: 63.2,
  east: 10.75,
  north: 63.65,
};

export interface ParseTrafikkdataOptions {
  receivedAt?: string;
}

export function buildTrafficRegistrationPointsQuery(): string {
  return `
    query TrafficRegistrationPointsForTrondheim {
      trafficRegistrationPoints(searchQuery: { countyNumbers: [50], isOperational: true }) {
        id
        name
        operationalStatus
        registrationFrequency
        location {
          municipality { name number }
          county { name number }
          coordinates { latLon { lat lon } }
          roadReference { shortForm roadCategory { id name } }
        }
        dataTimeSpan { latestData { volumeByHour } }
      }
    }
  `;
}

export function parseTrafikkdataPoints(
  response: unknown,
  options: ParseTrafikkdataOptions = {},
): TrafficCounterSnapshot[] {
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const points = extractTrafficRegistrationPoints(response);
  const snapshots: TrafficCounterSnapshot[] = [];
  const seenPointIds = new Set<string>();

  for (const rawPoint of points) {
    const point = asRecord(rawPoint);
    if (!point) continue;
    if (point.isOperational === false) continue;

    const pointId = stringValue(
      point.id,
      point.trafficRegistrationPointId,
      point.pointId,
      point.stationId,
      point.registrationPointId,
    );
    if (!pointId || seenPointIds.has(pointId)) continue;

    const geometry = pointGeometry(point);
    if (!geometry) continue;

    const municipalityName = municipality(point);
    if (!isTrondheimCounter(geometry, municipalityName)) continue;

    const metrics = trafficVolumeMetrics(point, receivedAt);
    const category = roadCategory(point);
    const number = roadNumber(point);
    const snapshot: TrafficCounterSnapshot = {
      id: `trafikkdata:${pointId}`,
      source: "trafikkdata",
      pointId,
      name: stringValue(point.name, point.roadStationName, point.description) ?? pointId,
      updatedAt: metrics.updatedAt,
      geometry,
      ...(municipalityName ? { municipalityName } : {}),
      ...(category ? { roadCategory: category } : {}),
      ...(number ? { roadNumber: number } : {}),
      ...(typeof metrics.volumeLastHour === "number"
        ? { volumeLastHour: metrics.volumeLastHour }
        : {}),
      ...(typeof metrics.coveragePercent === "number"
        ? { coveragePercent: metrics.coveragePercent }
        : {}),
      ...(typeof metrics.baselineVolumeLastHour === "number"
        ? { baselineVolumeLastHour: metrics.baselineVolumeLastHour }
        : {}),
      ...(typeof metrics.anomalyRatio === "number" ? { anomalyRatio: metrics.anomalyRatio } : {}),
    };

    snapshots.push(snapshot);
    seenPointIds.add(pointId);
  }

  return snapshots.sort((left, right) => left.name.localeCompare(right.name, "nb"));
}

export async function fetchTrafikkdataCounterSnapshots({
  endpoint = defaultTrafikkdataGraphqlEndpoint,
  fetcher = fetch,
  now = () => new Date(),
}: {
  endpoint?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
} = {}): Promise<TrafficCounterSnapshot[]> {
  const receivedAt = now();
  const registrationPayload = await postTrafikkdataGraphql(endpoint, fetcher, {
    query: buildTrafficRegistrationPointsQuery(),
  });
  const registrationErrors = graphqlErrors(registrationPayload);
  if (registrationErrors.length > 0) {
    throw new Error(`Trafikkdata GraphQL error: ${registrationErrors.join("; ")}`);
  }

  const snapshots = parseTrafikkdataPoints(registrationPayload, {
    receivedAt: receivedAt.toISOString(),
  });
  if (snapshots.length === 0) return snapshots;

  try {
    const volumePayload = await postTrafikkdataGraphql(endpoint, fetcher, {
      query: buildTrafficVolumeQuery(snapshots.map((snapshot) => snapshot.pointId)),
      variables: trafficVolumeQueryVariables(receivedAt),
    });
    const volumeMetricsByPointId = parseTrafficVolumeMetricsByPointId(
      volumePayload,
      snapshots.map((snapshot) => snapshot.pointId),
      receivedAt.toISOString(),
    );
    return snapshots.map((snapshot) => ({
      ...snapshot,
      ...volumeMetricsByPointId.get(snapshot.pointId),
    }));
  } catch {
    return snapshots;
  }
}

async function postTrafikkdataGraphql(
  endpoint: string,
  fetcher: typeof fetch,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchWithSourcePolicy(fetcher, endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": sourceUserAgent,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Trafikkdata returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function trafficVolumeQueryVariables(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}

function buildTrafficVolumeQuery(pointIds: string[]): string {
  const fields = pointIds.map((pointId, index) => {
    return `p${index}: trafficData(trafficRegistrationPointId: ${JSON.stringify(pointId)}) {
      volume {
        byHour(from: $from, to: $to, first: 8) {
          edges {
            node {
              from
              to
              total {
                volumeNumbers { volume }
                coverage { percentage }
              }
            }
          }
        }
      }
    }`;
  });
  return `query TrafficCounterHourlyVolumes($from: ZonedDateTime!, $to: ZonedDateTime!) {
    ${fields.join("\n")}
  }`;
}

function extractTrafficRegistrationPoints(response: unknown): unknown[] {
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  const value = data?.trafficRegistrationPoints;
  return extractConnectionItems(value);
}

function extractConnectionItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.nodes)) return record.nodes;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.values)) return record.values;
  if (Array.isArray(record.edges)) {
    return record.edges.flatMap((edge) => {
      const edgeRecord = asRecord(edge);
      return edgeRecord && "node" in edgeRecord ? [edgeRecord.node] : [];
    });
  }
  return [];
}

function graphqlErrors(payload: unknown): string[] {
  const errors = asRecord(payload)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => stringValue(asRecord(error)?.message) ?? String(error));
}

function parseTrafficVolumeMetricsByPointId(
  response: unknown,
  pointIds: string[],
  fallbackUpdatedAt: string,
): Map<string, Partial<TrafficCounterSnapshot>> {
  const data = asRecord(asRecord(response)?.data) ?? asRecord(response);
  const result = new Map<string, Partial<TrafficCounterSnapshot>>();
  if (!data) return result;

  pointIds.forEach((pointId, index) => {
    const trafficData = asRecord(data[`p${index}`]);
    const byHour = asRecord(asRecord(trafficData?.volume)?.byHour);
    const nodes = extractConnectionItems(byHour).flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
    const latest = nodes
      .map((node) => trafficVolumeMetrics(node, fallbackUpdatedAt))
      .filter((metrics) => typeof metrics.volumeLastHour === "number")
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (latest) result.set(pointId, latest);
  });

  return result;
}

function pointGeometry(point: Record<string, unknown>): Point | undefined {
  const directGeometry = asRecord(point.geometry);
  if (directGeometry?.type === "Point") {
    const coordinates = normalizePosition(directGeometry.coordinates);
    if (coordinates) return { type: "Point", coordinates };
  }

  const location = asRecord(point.location);
  const candidates = [
    point.coordinates,
    point.coordinate,
    location?.coordinates,
    location?.coordinate,
    point.location,
    point,
  ];
  for (const candidate of candidates) {
    const coordinates = normalizePosition(candidate);
    if (coordinates) return { type: "Point", coordinates };
  }
  return undefined;
}

function normalizePosition(value: unknown): Position | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const first = finiteNumber(value[0]);
    const second = finiteNumber(value[1]);
    if (first === undefined || second === undefined) return undefined;
    return normalizeLonLat(first, second);
  }

  const record = asRecord(value);
  if (!record) return undefined;
  const nested =
    asRecord(record.coordinates) ?? asRecord(record.coordinate) ?? asRecord(record.latLon);
  if (nested && nested !== record) {
    const nestedPosition = normalizePosition(nested);
    if (nestedPosition) return nestedPosition;
  }

  const lat = finiteNumber(record.latitude, record.lat, record.y);
  const lon = finiteNumber(record.longitude, record.lng, record.lon, record.x);
  if (lat === undefined || lon === undefined) return undefined;
  return [lon, lat];
}

function normalizeLonLat(first: number, second: number): Position {
  if (Math.abs(first) > 40 && Math.abs(second) <= 40) return [second, first];
  return [first, second];
}

function municipality(point: Record<string, unknown>): string | undefined {
  const location = asRecord(point.location);
  return stringValue(
    point.municipalityName,
    asRecord(point.municipality)?.name,
    asRecord(point.municipality)?.municipalityName,
    asRecord(location?.municipality)?.name,
    asRecord(location?.municipality)?.municipalityName,
  );
}

function roadCategory(point: Record<string, unknown>): string | undefined {
  const location = asRecord(point.location);
  const roadReference = asRecord(location?.roadReference) ?? asRecord(point.roadReference);
  const category = asRecord(roadReference?.roadCategory) ?? asRecord(point.roadCategory);
  return stringValue(
    point.roadCategory,
    category?.id,
    category?.name,
    roadReference?.category,
    roadReference?.roadCategory,
  );
}

function roadNumber(point: Record<string, unknown>): string | undefined {
  const location = asRecord(point.location);
  const roadReference = asRecord(location?.roadReference) ?? asRecord(point.roadReference);
  const direct = stringValue(point.roadNumber, roadReference?.roadNumber, roadReference?.number);
  if (direct) return direct;
  const shortForm = stringValue(point.roadReference, roadReference?.shortForm, roadReference?.name);
  return shortForm?.match(/\d+[A-Z]?/i)?.[0];
}

function isTrondheimCounter(geometry: Point, municipalityName: string | undefined): boolean {
  if (municipalityName?.toLocaleLowerCase("nb") === "trondheim") return true;
  const lng = geometry.coordinates[0];
  const lat = geometry.coordinates[1];
  if (typeof lng !== "number" || typeof lat !== "number") return false;
  return (
    lng >= trondheimRegionBounds.west &&
    lng <= trondheimRegionBounds.east &&
    lat >= trondheimRegionBounds.south &&
    lat <= trondheimRegionBounds.north
  );
}

function trafficVolumeMetrics(
  point: Record<string, unknown>,
  fallbackUpdatedAt: string,
): {
  updatedAt: string;
  volumeLastHour?: number;
  coveragePercent?: number;
  baselineVolumeLastHour?: number;
  anomalyRatio?: number;
} {
  const candidate = metricCandidate(point);
  const dataTimeSpan = asRecord(point.dataTimeSpan);
  const latestData = asRecord(dataTimeSpan?.latestData);
  const updatedAt =
    firstDateString(candidate, point, latestData) ??
    stringValue(point.updatedAt, point.lastUpdatedAt, point.modifiedAt) ??
    fallbackUpdatedAt;
  return {
    updatedAt,
    volumeLastHour: firstNumberByKeys(candidate, [
      "volumeLastHour",
      "hourlyVolume",
      "volume",
      "totalVolume",
      "total",
      "value",
    ]),
    coveragePercent: firstNumberByKeys(candidate, [
      "coveragePercent",
      "coveragePercentage",
      "coverage",
      "coverageRatio",
      "percentage",
    ]),
    baselineVolumeLastHour: firstNumberByKeys(candidate, [
      "baselineVolumeLastHour",
      "baselineVolume",
      "normalVolume",
      "expectedVolume",
    ]),
    anomalyRatio: firstNumberByKeys(candidate, ["anomalyRatio", "ratio", "deviationRatio"]),
  };
}

function metricCandidate(point: Record<string, unknown>): unknown {
  for (const key of [
    "latestHourlyVolume",
    "latestHourlyAggregate",
    "latestHour",
    "hourlyVolume",
    "trafficVolume",
    "latestTrafficVolume",
    "volumeLastHour",
    "volume",
    "latest",
  ]) {
    if (point[key] !== undefined) return point[key];
  }
  return point;
}

function firstDateString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = stringValue(value);
    if (direct && !Number.isNaN(Date.parse(direct))) return direct;
    const record = asRecord(value);
    if (!record) continue;
    const found = stringValue(
      record.updatedAt,
      record.lastUpdatedAt,
      record.to,
      record.endTime,
      record.periodEnd,
      record.timestamp,
      record.time,
      record.volumeByHour,
    );
    if (found && !Number.isNaN(Date.parse(found))) return found;
  }
  return undefined;
}

function firstNumberByKeys(value: unknown, keys: string[]): number | undefined {
  const record = asRecord(value);
  if (!record) return finiteNumber(value);
  for (const key of keys) {
    const direct = finiteNumber(record[key]);
    if (direct !== undefined) return normalizeMetricNumber(key, direct);
  }
  for (const nested of Object.values(record)) {
    if (typeof nested !== "object" || nested === null) continue;
    const found = firstNumberByKeys(nested, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeMetricNumber(key: string, value: number): number {
  if (key === "coverageRatio" && value <= 1) return value * 100;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function finiteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
