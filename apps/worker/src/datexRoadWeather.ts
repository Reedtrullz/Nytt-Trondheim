import type { RoadWeatherObservation } from "@nytt/shared";
import { XMLParser } from "fast-xml-parser";

export const defaultDatexWeatherMeasurementsEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetMeasuredWeatherData/pullsnapshotdata";
export const defaultDatexWeatherSitesEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetMeasurementWeatherSiteTable/pullsnapshotdata";

type DatexObject = Record<string, unknown>;

type DatexWeatherSite = {
  stationId: string;
  stationName: string;
  geometry: RoadWeatherObservation["geometry"];
};

type DatexWeatherMeasurement = {
  stationId: string;
  observedAt: string;
  airTemperatureC?: number;
  roadSurfaceTemperatureC?: number;
  precipitationMm?: number;
  windSpeedMps?: number;
  visibilityMeters?: number;
};

const trondelagBounds = { minLat: 62.0, maxLat: 65.6, minLng: 8.0, maxLng: 14.8 };

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
  return datexText(object[`@${name}`] ?? object[name]).trim();
}

function firstText(value: unknown): string {
  for (const item of asDatexArray(value)) {
    const direct = datexText(item).trim();
    if (direct) return direct;

    if (isObject(item)) {
      for (const key of ["value", "name", "values"]) {
        const nested = firstText(item[key]);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function firstNestedTextForKey(value: unknown, key: string): string {
  for (const object of findDatexObjectsWithKey(value, key)) {
    const text = firstText(object[key]);
    if (text) return text;
  }
  return "";
}

function firstTextForKeys(value: unknown, keys: string[]): string {
  for (const key of keys) {
    const text = firstNestedTextForKey(value, key);
    if (text) return text;
  }
  return "";
}

function firstIso(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = datexText(value).trim();
    if (!text) continue;
    const time = new Date(text).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return undefined;
}

function firstIsoForKeys(value: unknown, keys: string[]): string | undefined {
  for (const key of keys) {
    for (const object of findDatexObjectsWithKey(value, key)) {
      for (const item of asDatexArray(object[key])) {
        const iso = firstIso(item);
        if (iso) return iso;
      }
    }
  }
  return undefined;
}

function numberFromText(value: unknown): number | undefined {
  const text = datexText(value).trim();
  if (!text) return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function firstNumber(value: unknown): number | undefined {
  const direct = numberFromText(value);
  if (direct !== undefined) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const numeric = firstNumber(item);
      if (numeric !== undefined) return numeric;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;

  for (const key of [
    "temperature",
    "value",
    "metresPerSecond",
    "metres",
    "millimetres",
    "millimetresPerHour",
    "duration",
  ]) {
    if (!(key in value)) continue;
    const numeric = firstNumber(value[key]);
    if (numeric !== undefined) return numeric;
  }

  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("@")) continue;
    const numeric = firstNumber(item);
    if (numeric !== undefined) return numeric;
  }

  return undefined;
}

function firstNumberForKeys(value: unknown, keys: string[]): number | undefined {
  for (const key of keys) {
    for (const object of findDatexObjectsWithKey(value, key)) {
      for (const item of asDatexArray(object[key])) {
        const numeric = firstNumber(item);
        if (numeric !== undefined) return numeric;
      }
    }
  }
  return undefined;
}

function coordinateNumber(value: unknown, keys: string[]): number | undefined {
  for (const key of keys) {
    const numeric = firstNumberForKeys(value, [key]);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

function pointFromLatLngObject(value: unknown): RoadWeatherObservation["geometry"] | undefined {
  if (!isObject(value)) return undefined;

  const latitude = coordinateNumber(value, ["latitude", "lat", "latitudeInDecimalDegrees"]);
  const longitude = coordinateNumber(value, [
    "longitude",
    "lng",
    "lon",
    "longitudeInDecimalDegrees",
  ]);
  if (latitude === undefined || longitude === undefined) return undefined;
  if (!pointInTrondelagCoordinates(longitude, latitude)) return undefined;

  return { type: "Point", coordinates: [longitude, latitude] };
}

function pointGeometry(record: DatexObject): RoadWeatherObservation["geometry"] | undefined {
  for (const key of ["pointCoordinates", "locationForDisplay", "coordinatesForDisplay"]) {
    for (const object of findDatexObjectsWithKey(record, key)) {
      for (const value of asDatexArray(object[key])) {
        const point = pointFromLatLngObject(value);
        if (point) return point;
      }
    }
  }
  return pointFromLatLngObject(record);
}

function pointInTrondelagCoordinates(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= trondelagBounds.minLat &&
    lat <= trondelagBounds.maxLat &&
    lng >= trondelagBounds.minLng &&
    lng <= trondelagBounds.maxLng
  );
}

function firstMeasurementSiteReferenceId(value: unknown): string {
  for (const key of [
    "measurementSiteReference",
    "predefinedLocationReference",
    "measurementSiteTableReference",
    "siteReference",
  ]) {
    for (const object of findDatexObjectsWithKey(value, key)) {
      for (const referenceValue of asDatexArray(object[key])) {
        if (!isObject(referenceValue)) continue;
        const id = datexAttribute(referenceValue, "id");
        if (id) return id;
      }
    }
  }
  return "";
}

function siteId(record: DatexObject): string {
  return datexAttribute(record, "id") || firstMeasurementSiteReferenceId(record);
}

function siteName(record: DatexObject): string {
  return (
    firstTextForKeys(record, ["measurementSiteName", "predefinedLocationName", "name"]) ||
    firstNestedTextForKey(record, "value")
  );
}

function weatherSites(siteXml: string): Map<string, DatexWeatherSite> {
  const tree = parseXml(siteXml);
  const sites = new Map<string, DatexWeatherSite>();

  for (const object of findDatexObjectsWithKey(tree, "measurementSiteRecord")) {
    for (const recordValue of asDatexArray(object.measurementSiteRecord)) {
      if (!isObject(recordValue)) continue;
      const id = siteId(recordValue);
      const name = siteName(recordValue);
      const geometry = pointGeometry(recordValue);
      if (!id || !name || !geometry) continue;
      sites.set(id, { stationId: id, stationName: name, geometry });
    }
  }

  return sites;
}

function hasMeasurementValues(measurement: DatexWeatherMeasurement): boolean {
  return (
    measurement.airTemperatureC !== undefined ||
    measurement.roadSurfaceTemperatureC !== undefined ||
    measurement.precipitationMm !== undefined ||
    measurement.windSpeedMps !== undefined ||
    measurement.visibilityMeters !== undefined
  );
}

function weatherMeasurementFromSiteMeasurements(
  siteMeasurement: DatexObject,
  receivedAt: string,
): DatexWeatherMeasurement | undefined {
  const stationId = firstMeasurementSiteReferenceId(siteMeasurement);
  if (!stationId) return undefined;

  const measurement: DatexWeatherMeasurement = {
    stationId,
    observedAt:
      firstIsoForKeys(siteMeasurement, [
        "measurementTimeDefault",
        "measurementTime",
        "timeStamp",
        "endOfPeriod",
        "startOfPeriod",
      ]) ?? receivedAt,
  };

  const airTemperatureC = firstNumberForKeys(siteMeasurement, [
    "airTemperature",
    "ambientAirTemperature",
    "ambientTemperature",
  ]);
  if (airTemperatureC !== undefined) measurement.airTemperatureC = airTemperatureC;

  const roadSurfaceTemperatureC = firstNumberForKeys(siteMeasurement, [
    "roadSurfaceTemperature",
    "surfaceTemperature",
  ]);
  if (roadSurfaceTemperatureC !== undefined) {
    measurement.roadSurfaceTemperatureC = roadSurfaceTemperatureC;
  }

  const precipitationMm = firstNumberForKeys(siteMeasurement, [
    "precipitationAmount",
    "precipitationIntensity",
    "precipitationRate",
    "precipitation",
  ]);
  if (precipitationMm !== undefined) measurement.precipitationMm = precipitationMm;

  const windSpeedMps = firstNumberForKeys(siteMeasurement, ["windSpeed", "maximumWindSpeed"]);
  if (windSpeedMps !== undefined) measurement.windSpeedMps = windSpeedMps;

  const visibilityMeters = firstNumberForKeys(siteMeasurement, [
    "visibilityDistance",
    "minimumVisibilityDistance",
    "visibility",
  ]);
  if (visibilityMeters !== undefined) measurement.visibilityMeters = visibilityMeters;

  return hasMeasurementValues(measurement) ? measurement : undefined;
}

function weatherMeasurements(
  measurementXml: string,
  receivedAt: string,
): Map<string, DatexWeatherMeasurement> {
  const tree = parseXml(measurementXml);
  const measurements = new Map<string, DatexWeatherMeasurement>();

  for (const object of findDatexObjectsWithKey(tree, "siteMeasurements")) {
    for (const value of asDatexArray(object.siteMeasurements)) {
      if (!isObject(value)) continue;
      const measurement = weatherMeasurementFromSiteMeasurements(value, receivedAt);
      if (!measurement) continue;

      const previous = measurements.get(measurement.stationId);
      if (
        !previous ||
        new Date(measurement.observedAt).getTime() >= new Date(previous.observedAt).getTime()
      ) {
        measurements.set(measurement.stationId, measurement);
      }
    }
  }

  return measurements;
}

function rawSummary(measurement: DatexWeatherMeasurement): string | undefined {
  const parts = [
    measurement.airTemperatureC !== undefined ? `air=${measurement.airTemperatureC}C` : "",
    measurement.roadSurfaceTemperatureC !== undefined
      ? `road=${measurement.roadSurfaceTemperatureC}C`
      : "",
    measurement.precipitationMm !== undefined
      ? `precipitation=${measurement.precipitationMm}mm`
      : "",
    measurement.windSpeedMps !== undefined ? `wind=${measurement.windSpeedMps}m/s` : "",
    measurement.visibilityMeters !== undefined ? `visibility=${measurement.visibilityMeters}m` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function parseDatexRoadWeather(
  siteXml: string,
  measurementXml: string,
  options: { receivedAt: string },
): RoadWeatherObservation[] {
  const sites = weatherSites(siteXml);
  const measurements = weatherMeasurements(measurementXml, options.receivedAt);
  const observations: RoadWeatherObservation[] = [];

  for (const site of sites.values()) {
    const measurement = measurements.get(site.stationId);
    if (!measurement) continue;

    const summary = rawSummary(measurement);
    observations.push({
      id: `datex-weather:${site.stationId}`,
      source: "datex_weather",
      stationId: site.stationId,
      stationName: site.stationName,
      observedAt: measurement.observedAt,
      updatedAt: options.receivedAt,
      geometry: site.geometry,
      ...(measurement.airTemperatureC !== undefined
        ? { airTemperatureC: measurement.airTemperatureC }
        : {}),
      ...(measurement.roadSurfaceTemperatureC !== undefined
        ? { roadSurfaceTemperatureC: measurement.roadSurfaceTemperatureC }
        : {}),
      ...(measurement.precipitationMm !== undefined
        ? { precipitationMm: measurement.precipitationMm }
        : {}),
      ...(measurement.windSpeedMps !== undefined ? { windSpeedMps: measurement.windSpeedMps } : {}),
      ...(measurement.visibilityMeters !== undefined
        ? { visibilityMeters: measurement.visibilityMeters }
        : {}),
      ...(summary ? { rawSummary: summary } : {}),
    });
  }

  return observations;
}
