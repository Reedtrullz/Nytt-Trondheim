import type { RoadCamera } from "@nytt/shared";
import { XMLParser } from "fast-xml-parser";

export const defaultDatexCctvSitesEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetCCTVSiteTable/pullsnapshotdata";
export const defaultDatexCctvStatusEndpoint =
  "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetCCTVStatus/pullsnapshotdata";

type DatexObject = Record<string, unknown>;

type DatexCctvSite = {
  cameraId: string;
  name: string;
  geometry: RoadCamera["geometry"];
  imageUrl?: string;
  sourceUrl?: string;
};

type DatexCctvStatus = {
  status: RoadCamera["status"];
  imageUrl?: string;
  sourceUrl?: string;
};

const trondelagBounds = { minLat: 62.0, maxLat: 65.6, minLng: 8.0, maxLng: 14.8 };

const siteRecordKeys = [
  "cctvCameraRecord",
  "cctvCamera",
  "cctvSiteRecord",
  "cctvSite",
  "cameraSite",
  "measurementSiteRecord",
  "predefinedLocation",
];

const siteNameKeys = [
  "cctvCameraName",
  "cameraName",
  "measurementSiteName",
  "predefinedLocationName",
  "locationName",
  "name",
];

const statusRecordKeys = [
  "cctvCameraStatusRecord",
  "cctvCameraStatus",
  "cctvStatus",
  "cameraStatusRecord",
  "cameraStatus",
  "siteStatus",
];

const referenceKeys = [
  "cctvCameraReference",
  "cameraReference",
  "cctvSiteReference",
  "measurementSiteReference",
  "predefinedLocationReference",
  "siteReference",
  "reference",
];

const imageUrlKeys = [
  "stillImageUrl",
  "stillImageURL",
  "cctvStillImageUrl",
  "imageUrl",
  "imageURL",
  "snapshotUrl",
  "snapshotURL",
];

const sourceUrlKeys = [
  "sourceUrl",
  "sourceURL",
  "publicationUrl",
  "urlOfData",
  "informationUrl",
  "url",
  "uri",
  "href",
  "link",
  "linkToExternalResource",
  "externalResourceUrl",
  "resourceUrl",
];

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

  for (const key of ["value", "number", "decimal", "latitude", "longitude"]) {
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

function pointFromLatLngObject(value: unknown): RoadCamera["geometry"] | undefined {
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

function pointGeometry(record: DatexObject): RoadCamera["geometry"] | undefined {
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

function childRecordsForKeys(tree: DatexObject, keys: string[]): DatexObject[] {
  const records: DatexObject[] = [];
  const seen = new Set<DatexObject>();

  for (const key of keys) {
    for (const object of findDatexObjectsWithKey(tree, key)) {
      for (const value of asDatexArray(object[key])) {
        if (!isObject(value) || seen.has(value)) continue;
        seen.add(value);
        records.push(value);
      }
    }
  }

  return records;
}

function objectsWithAnyKey(tree: DatexObject, keys: string[]): DatexObject[] {
  const records: DatexObject[] = [];
  const seen = new Set<DatexObject>();

  for (const key of keys) {
    for (const object of findDatexObjectsWithKey(tree, key)) {
      if (seen.has(object)) continue;
      seen.add(object);
      records.push(object);
    }
  }

  return records;
}

function candidateSiteRecords(tree: DatexObject): DatexObject[] {
  const records = childRecordsForKeys(tree, siteRecordKeys);
  const seen = new Set(records);

  for (const object of objectsWithAnyKey(tree, siteNameKeys)) {
    if (seen.has(object)) continue;
    seen.add(object);
    records.push(object);
  }

  return records;
}

function referenceId(value: unknown): string {
  for (const key of referenceKeys) {
    for (const object of findDatexObjectsWithKey(value, key)) {
      for (const referenceValue of asDatexArray(object[key])) {
        if (!isObject(referenceValue)) continue;
        const id = datexAttribute(referenceValue, "id") || firstText(referenceValue);
        if (id) return id;
      }
    }
  }
  return "";
}

function cameraId(record: DatexObject): string {
  return (
    datexAttribute(record, "id") ||
    referenceId(record) ||
    firstTextForKeys(record, [
      "cctvCameraIdentification",
      "cameraIdentification",
      "cameraId",
      "siteId",
      "id",
    ])
  );
}

function cameraName(record: DatexObject, id: string): string {
  return firstTextForKeys(record, siteNameKeys) || firstNestedTextForKey(record, "value") || id;
}

function validHttpUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function firstHttpUrl(value: unknown): string | undefined {
  const text = datexText(value).trim();
  const direct = validHttpUrl(text);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstHttpUrl(item);
      if (url) return url;
    }
    return undefined;
  }

  if (!isObject(value)) return undefined;
  for (const key of ["@href", "@url", "@uri", "value", "url", "uri", "link"]) {
    if (!(key in value)) continue;
    const url = firstHttpUrl(value[key]);
    if (url) return url;
  }
  for (const item of Object.values(value)) {
    const url = firstHttpUrl(item);
    if (url) return url;
  }
  return undefined;
}

function firstHttpUrlForKeys(value: unknown, keys: string[]): string | undefined {
  for (const key of keys) {
    for (const object of findDatexObjectsWithKey(value, key)) {
      const url = firstHttpUrl(object[key]);
      if (url) return url;
    }
  }
  return undefined;
}

function sourceUrl(record: DatexObject): string | undefined {
  return firstHttpUrlForKeys(record, sourceUrlKeys);
}

function datexStatus(text: string): RoadCamera["status"] {
  const normalized = text.toLocaleLowerCase("en").replace(/[\s_-]+/g, "");
  if (!normalized) return "unknown";
  if (
    /unavailable|fault|faulty|offline|disabled|inactive|outofoperation|notavailable|notworking|error/.test(
      normalized,
    )
  ) {
    return "offline";
  }
  if (/available|operational|online|active|enabled|normal|working|inoperation/.test(normalized)) {
    return "ok";
  }
  return "unknown";
}

function statusText(record: DatexObject): string {
  return firstTextForKeys(record, [
    "operatingStatus",
    "operationalStatus",
    "equipmentOperationalStatus",
    "availabilityStatus",
    "availability",
    "status",
    "cameraStatus",
    "cctvStatus",
    "cctvCameraStatus",
    "faultStatus",
  ]);
}

function candidateStatusRecords(tree: DatexObject): DatexObject[] {
  const records = childRecordsForKeys(tree, statusRecordKeys);
  const seen = new Set(records);

  for (const object of objectsWithAnyKey(tree, referenceKeys)) {
    if (seen.has(object)) continue;
    seen.add(object);
    records.push(object);
  }

  return records;
}

function mergeCctvStatus(
  existing: DatexCctvStatus | undefined,
  candidate: DatexCctvStatus,
): DatexCctvStatus {
  if (!existing) return candidate;

  return {
    status: existing.status !== "unknown" ? existing.status : candidate.status,
    ...((existing.imageUrl ?? candidate.imageUrl)
      ? { imageUrl: existing.imageUrl ?? candidate.imageUrl }
      : {}),
    ...((existing.sourceUrl ?? candidate.sourceUrl)
      ? { sourceUrl: existing.sourceUrl ?? candidate.sourceUrl }
      : {}),
  };
}

function cctvSites(siteXml: string): DatexCctvSite[] {
  const tree = parseXml(siteXml);
  const sites: DatexCctvSite[] = [];
  const seenIds = new Set<string>();

  for (const record of candidateSiteRecords(tree)) {
    const id = cameraId(record);
    if (!id || seenIds.has(id)) continue;

    const geometry = pointGeometry(record);
    if (!geometry) continue;

    seenIds.add(id);
    const imageUrl = firstHttpUrlForKeys(record, imageUrlKeys);
    const officialSourceUrl = sourceUrl(record);
    sites.push({
      cameraId: id,
      name: cameraName(record, id),
      geometry,
      ...(imageUrl ? { imageUrl } : {}),
      ...(officialSourceUrl ? { sourceUrl: officialSourceUrl } : {}),
    });
  }

  return sites;
}

function cctvStatuses(statusXml: string): Map<string, DatexCctvStatus> {
  const tree = parseXml(statusXml);
  const statuses = new Map<string, DatexCctvStatus>();

  for (const record of candidateStatusRecords(tree)) {
    const id = referenceId(record) || cameraId(record);
    if (!id) continue;

    const imageUrl = firstHttpUrlForKeys(record, imageUrlKeys);
    const officialSourceUrl = sourceUrl(record);
    statuses.set(
      id,
      mergeCctvStatus(statuses.get(id), {
        status: datexStatus(statusText(record)),
        ...(imageUrl ? { imageUrl } : {}),
        ...(officialSourceUrl ? { sourceUrl: officialSourceUrl } : {}),
      }),
    );
  }

  return statuses;
}

export function parseDatexCctv(
  siteXml: string,
  statusXml: string,
  options: { receivedAt: string },
): RoadCamera[] {
  const sites = cctvSites(siteXml);
  const statuses = cctvStatuses(statusXml);

  return sites.map((site) => {
    const status = statuses.get(site.cameraId);
    return {
      id: `datex-cctv:${site.cameraId}`,
      source: "datex_cctv",
      cameraId: site.cameraId,
      name: site.name,
      status: status?.status ?? "unknown",
      updatedAt: options.receivedAt,
      geometry: site.geometry,
      ...((status?.imageUrl ?? site.imageUrl)
        ? { imageUrl: status?.imageUrl ?? site.imageUrl }
        : {}),
      ...((status?.sourceUrl ?? site.sourceUrl)
        ? { sourceUrl: status?.sourceUrl ?? site.sourceUrl }
        : {}),
    } satisfies RoadCamera;
  });
}
