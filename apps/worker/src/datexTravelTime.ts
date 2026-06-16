import type { TrafficPulseCorridor } from "@nytt/shared";
import { XMLParser } from "fast-xml-parser";
import { datexBasicAuthHeader, normalizeDatexCredentialedEndpoint } from "./datex.js";
import { fetchWithSourcePolicy } from "./fetchPolicy.js";

export const defaultDatexTravelTimeLocationsEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetPredefinedTravelTimeLocations/pullsnapshotdata";

export const defaultDatexTravelTimeDataEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata";

type DatexObject = Record<string, unknown>;

export interface DatexTravelTimeLocation {
  id: string;
  name: string;
}

export interface DatexTravelTimeMeasurement {
  locationId: string;
  measurementFrom?: string;
  measurementTo?: string;
  travelTimeSeconds: number;
  freeFlowSeconds?: number;
  trend?: string;
}

export type DatexTravelTimeLocations = Map<string, DatexTravelTimeLocation>;

export interface DatexTravelTimePulseOptions {
  sourceUrl: string;
  receivedAt: string;
}

export interface DatexTravelTimeCollectOptions {
  locationsEndpoint: string;
  dataEndpoint: string;
  username: string;
  password: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export interface DatexTravelTimeCollectResult {
  corridors: TrafficPulseCorridor[];
}

const datexTravelTimeUserAgent = "NyttTrondheim/0.1 kontakt@reidar.tech";

const localTravelTimeLocationIds = new Set([
  "100071",
  "100080",
  "100135",
  "100136",
  "100137",
  "100138",
  "100139",
  "100140",
  "100141",
  "100142",
  "100208",
  "100209",
  "100210",
  "100211",
  "100222",
  "100223",
  "100228",
  "100229",
  "100230",
  "100231",
  "100322",
  "100323",
  "100348",
  "100349",
  "100350",
  "100351",
]);

const localTravelTimeNamePattern =
  /\b(trondheim|tiller|heimdal|moholt|ranheim|sluppen|okstad|ilevollen|iladalen|studentersamfunnet|havnegata|haakon\s+vii)\b/i;

function isObject(value: unknown): value is DatexObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asDatexArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function datexText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isObject(value) && "#text" in value) return datexText(value["#text"]);
  return "";
}

function parseXml(xml: string): DatexObject {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    processEntities: false,
  }).parse(xml) as DatexObject;
}

function findDatexObjectsWithKey(value: unknown, key: string): DatexObject[] {
  if (Array.isArray(value)) return value.flatMap((item) => findDatexObjectsWithKey(item, key));
  if (!isObject(value)) return [];
  const nested = Object.values(value).flatMap((item) => findDatexObjectsWithKey(item, key));
  return key in value ? [value, ...nested] : nested;
}

function datexAttribute(object: DatexObject, name: string): string {
  return datexText(object[`@${name}`] ?? object[name]);
}

function firstNestedTextForKey(value: unknown, key: string): string {
  for (const object of findDatexObjectsWithKey(value, key)) {
    for (const nestedValue of asDatexArray(object[key])) {
      const text = datexText(nestedValue).trim();
      if (text) return text;
    }
  }
  return "";
}

function firstIso(value: unknown): string | undefined {
  const text = datexText(value).trim();
  if (!text) return undefined;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function numberFromDuration(value: unknown): number | undefined {
  const text = datexText(value).trim();
  if (!text) return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function typeName(value: DatexObject): string {
  return datexAttribute(value, "type") || datexAttribute(value, "xsi:type");
}

function isTravelTimeData(value: DatexObject): boolean {
  return /(^|:)TravelTimeData$/i.test(typeName(value));
}

function firstPredefinedLocationReferenceId(value: unknown): string {
  for (const object of findDatexObjectsWithKey(value, "predefinedLocationReference")) {
    for (const referenceValue of asDatexArray(object.predefinedLocationReference)) {
      if (!isObject(referenceValue)) continue;
      const id = datexAttribute(referenceValue, "id").trim();
      if (id) return id;
    }
  }
  return "";
}

function locationMapFromInput(
  locations:
    | DatexTravelTimeLocations
    | Record<string, DatexTravelTimeLocation>
    | DatexTravelTimeLocation[],
): Map<string, DatexTravelTimeLocation> {
  if (locations instanceof Map) return locations;
  if (Array.isArray(locations))
    return new Map(locations.map((location) => [location.id, location]));
  return new Map(
    Object.entries(locations).flatMap(([id, location]) => {
      if (!isObject(location) || typeof location.name !== "string") return [];
      const locationId = typeof location.id === "string" ? location.id : id;
      return [[locationId, { id: locationId, name: location.name }]];
    }),
  );
}

function isLocalTravelTimeLocation(id: string, name: string): boolean {
  return localTravelTimeLocationIds.has(id) || localTravelTimeNamePattern.test(name);
}

function trafficState(
  travelTimeSeconds: number,
  freeFlowSeconds: number | undefined,
): TrafficPulseCorridor["state"] {
  if (freeFlowSeconds === undefined) return "free_flow";

  const delaySeconds = Math.max(0, travelTimeSeconds - freeFlowSeconds);
  const delayRatio = freeFlowSeconds > 0 ? travelTimeSeconds / freeFlowSeconds : undefined;

  if ((delayRatio !== undefined && delayRatio >= 1.5) || delaySeconds >= 300) return "congested";
  if ((delayRatio !== undefined && delayRatio >= 1.15) || delaySeconds >= 60) return "slow";
  return "free_flow";
}

export function parseDatexTravelTimeLocations(xml: string): DatexTravelTimeLocations {
  const tree = parseXml(xml);
  const locations = new Map<string, DatexTravelTimeLocation>();

  for (const location of findDatexObjectsWithKey(tree, "predefinedLocationName")) {
    const id =
      firstPredefinedLocationReferenceId(location) || datexAttribute(location, "id").trim();
    const name = firstNestedTextForKey(location.predefinedLocationName, "value");
    if (id && name) locations.set(id, { id, name });
  }

  return locations;
}

export function parseDatexTravelTimeData(xml: string): DatexTravelTimeMeasurement[] {
  const tree = parseXml(xml);
  const measurements: DatexTravelTimeMeasurement[] = [];

  for (const object of findDatexObjectsWithKey(tree, "basicData")) {
    for (const basicData of asDatexArray(object.basicData)) {
      if (!isObject(basicData) || !isTravelTimeData(basicData)) continue;

      const locationId =
        firstPredefinedLocationReferenceId(object) || firstPredefinedLocationReferenceId(basicData);
      const travelTimeSeconds = numberFromDuration(
        isObject(basicData.travelTime) ? basicData.travelTime.duration : undefined,
      );
      if (!locationId || travelTimeSeconds === undefined) continue;

      const freeFlowSeconds = numberFromDuration(
        isObject(basicData.freeFlowTravelTime) ? basicData.freeFlowTravelTime.duration : undefined,
      );
      const period = isObject(basicData.measurementOrCalculationTime)
        ? basicData.measurementOrCalculationTime.period
        : undefined;
      const trend = datexText(basicData.travelTimeTrendType).trim();

      measurements.push({
        locationId,
        measurementFrom: isObject(period) ? firstIso(period.startOfPeriod) : undefined,
        measurementTo: isObject(period) ? firstIso(period.endOfPeriod) : undefined,
        travelTimeSeconds,
        ...(freeFlowSeconds !== undefined ? { freeFlowSeconds } : {}),
        ...(trend ? { trend } : {}),
      });
    }
  }

  return measurements;
}

async function fetchDatexTravelTimeSnapshot(
  fetcher: typeof fetch,
  endpointType: "locations" | "data",
  endpoint: string,
  headers: Record<string, string>,
): Promise<string> {
  const response = await fetchWithSourcePolicy(fetcher, endpoint, { headers });
  if (!response.ok) {
    throw new Error(`DATEX TravelTime ${endpointType} returned HTTP ${response.status}`);
  }
  return response.text();
}

export async function collectDatexTravelTimePulse({
  locationsEndpoint,
  dataEndpoint,
  username,
  password,
  fetcher = fetch,
  now = () => new Date(),
}: DatexTravelTimeCollectOptions): Promise<DatexTravelTimeCollectResult> {
  const normalizedLocationsEndpoint = normalizeDatexCredentialedEndpoint(
    locationsEndpoint,
    "DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT",
  );
  const normalizedDataEndpoint = normalizeDatexCredentialedEndpoint(
    dataEndpoint,
    "DATEX_TRAVEL_TIME_DATA_ENDPOINT",
  );
  const headers: Record<string, string> = {
    "User-Agent": datexTravelTimeUserAgent,
    Authorization: datexBasicAuthHeader(username, password),
  };

  const locationsXml = await fetchDatexTravelTimeSnapshot(
    fetcher,
    "locations",
    normalizedLocationsEndpoint,
    headers,
  );
  const dataXml = await fetchDatexTravelTimeSnapshot(
    fetcher,
    "data",
    normalizedDataEndpoint,
    headers,
  );

  return {
    corridors: trafficPulseFromDatexTravelTime(
      parseDatexTravelTimeLocations(locationsXml),
      parseDatexTravelTimeData(dataXml),
      {
        sourceUrl: normalizedDataEndpoint,
        receivedAt: now().toISOString(),
      },
    ),
  };
}

export function trafficPulseFromDatexTravelTime(
  locations:
    | DatexTravelTimeLocations
    | Record<string, DatexTravelTimeLocation>
    | DatexTravelTimeLocation[],
  measurements: DatexTravelTimeMeasurement[],
  options: DatexTravelTimePulseOptions,
): TrafficPulseCorridor[] {
  const locationMap = locationMapFromInput(locations);
  const corridors: TrafficPulseCorridor[] = [];

  for (const measurement of measurements) {
    const location = locationMap.get(measurement.locationId);
    if (!location?.name) continue;
    if (!isLocalTravelTimeLocation(measurement.locationId, location.name)) continue;

    const delaySeconds =
      measurement.freeFlowSeconds !== undefined
        ? Math.max(0, measurement.travelTimeSeconds - measurement.freeFlowSeconds)
        : undefined;
    const delayRatio =
      measurement.freeFlowSeconds !== undefined && measurement.freeFlowSeconds > 0
        ? measurement.travelTimeSeconds / measurement.freeFlowSeconds
        : undefined;

    corridors.push({
      id: measurement.locationId,
      name: location.name,
      state: trafficState(measurement.travelTimeSeconds, measurement.freeFlowSeconds),
      travelTimeSeconds: measurement.travelTimeSeconds,
      ...(measurement.freeFlowSeconds !== undefined
        ? { freeFlowSeconds: measurement.freeFlowSeconds }
        : {}),
      ...(delaySeconds !== undefined ? { delaySeconds } : {}),
      ...(delayRatio !== undefined ? { delayRatio } : {}),
      ...(measurement.trend ? { trend: measurement.trend } : {}),
      ...(measurement.measurementFrom ? { measurementFrom: measurement.measurementFrom } : {}),
      ...(measurement.measurementTo ? { measurementTo: measurement.measurementTo } : {}),
      updatedAt: options.receivedAt,
      sourceUrl: options.sourceUrl,
    });
  }

  return corridors;
}
