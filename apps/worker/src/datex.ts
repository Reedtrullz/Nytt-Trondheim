import { createHash } from "node:crypto";
import type { Geometry } from "geojson";
import type { OfficialEvent, OfficialEventState } from "@nytt/shared";
import { XMLParser } from "fast-xml-parser";

type DatexObject = Record<string, unknown>;

function isObject(value: unknown): value is DatexObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function asDatexArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function datexText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isObject(value) && "#text" in value) return datexText(value["#text"]);
  return "";
}

export function findDatexObjectsWithKey(value: unknown, key: string): DatexObject[] {
  if (Array.isArray(value)) return value.flatMap((item) => findDatexObjectsWithKey(item, key));
  if (!isObject(value)) return [];
  const nested = Object.values(value).flatMap((item) => findDatexObjectsWithKey(item, key));
  return key in value ? [value, ...nested] : nested;
}

function parseXml(xml: string): DatexObject {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    processEntities: false,
  }).parse(xml) as DatexObject;
}

export interface DatexParseOptions {
  endpoint: string;
  receivedAt: string;
}

export interface DatexParseResult {
  events: OfficialEvent[];
}

function datexAttribute(object: DatexObject, name: string): string {
  return datexText(object[`@${name}`] ?? object[name]);
}

function firstTextForKey(value: unknown, key: string): string {
  for (const object of findDatexObjectsWithKey(value, key)) {
    const text = datexText(object[key]).trim();
    if (text) return text;
  }
  return "";
}

function firstIso(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return undefined;
}

function receivedAtPlusOneDay(receivedAt: string): string {
  const time = new Date(receivedAt).getTime();
  const base = Number.isFinite(time) ? time : Date.now();
  return new Date(base + 24 * 60 * 60 * 1000).toISOString();
}

function datexId(situationId: string, recordId: string): string {
  return `datex-${createHash("sha256").update(`${situationId}:${recordId}`).digest("hex").slice(0, 24)}`;
}

function recordState(validityStatus: string): OfficialEventState {
  const normalized = validityStatus.toLocaleLowerCase("en");
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("expire")) return "expired";
  if (normalized.includes("active")) return "active";
  return "updated";
}

function recordKind(record: DatexObject): string {
  return datexAttribute(record, "type") || datexAttribute(record, "xsi:type") || "DATEX situation";
}

function humanizeRecordKind(kind: string): string {
  return kind
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function publicComments(record: DatexObject): string[] {
  return findDatexObjectsWithKey(record.generalPublicComment, "value")
    .flatMap((object) => asDatexArray(object.value))
    .map((value) => datexText(value).trim())
    .filter(Boolean);
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?)[.!?](?:\s|$)/u.exec(trimmed);
  return (match?.[1] ?? trimmed).replace(/[.!?]+$/u, "").trim();
}

function titleForRecord(
  record: DatexObject,
  kind: string,
  roadName: string,
  roadNumber: string,
): string {
  const commentTitle = publicComments(record).map(firstSentence).find(Boolean);
  if (commentTitle) return commentTitle;
  const location = roadName || roadNumber;
  return [humanizeRecordKind(kind), location && `på ${location}`].filter(Boolean).join(" ");
}

function pointGeometry(record: DatexObject): Geometry | undefined {
  for (const object of findDatexObjectsWithKey(record, "locationForDisplay")) {
    const location = object.locationForDisplay;
    if (!isObject(location)) continue;
    const latitude = Number(datexText(location.latitude));
    const longitude = Number(datexText(location.longitude));
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { type: "Point", coordinates: [longitude, latitude] };
    }
  }
  return undefined;
}

const trondelagBounds = { minLat: 62.0, maxLat: 65.6, minLng: 8.0, maxLng: 14.8 };
const localTextPattern =
  /\b(trondheim|trøndelag|trondelag|tiller|heimdal|ranheim|lade|byåsen|bymarka|sjetnemarka|e6\s+(ved\s+)?(tiller|heimdal|trondheim)|omkjøringsvegen|stavne|singsaker)\b/i;

function pointInTrondelag(geometry: Geometry | undefined): boolean {
  if (!geometry || geometry.type !== "Point") return false;
  const [lng, lat] = geometry.coordinates;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    lat >= trondelagBounds.minLat &&
    lat <= trondelagBounds.maxLat &&
    lng >= trondelagBounds.minLng &&
    lng <= trondelagBounds.maxLng
  );
}

function isRelevantToNytt(event: OfficialEvent): boolean {
  return (
    pointInTrondelag(event.geometry) ||
    localTextPattern.test(`${event.title} ${event.detail} ${event.areaLabel}`)
  );
}

export function parseDatexSituationPublication(
  xml: string,
  options: DatexParseOptions,
): DatexParseResult {
  const tree = parseXml(xml);
  const publications = findDatexObjectsWithKey(tree, "situation");
  const events: OfficialEvent[] = [];

  for (const publication of publications) {
    const publicationTime = firstIso(datexText(publication.publicationTime), options.receivedAt);
    for (const situationValue of asDatexArray(publication.situation)) {
      if (!isObject(situationValue)) continue;
      const situation = situationValue;
      const situationId = datexAttribute(situation, "id");
      const overallSeverity = datexText(situation.overallSeverity).trim();

      for (const recordValue of asDatexArray(situation.situationRecord)) {
        if (!isObject(recordValue)) continue;
        const record = recordValue;
        const recordId = datexAttribute(record, "id");
        if (!situationId || !recordId) continue;

        const version = datexAttribute(record, "version");
        const kind = recordKind(record);
        const creationTime = firstIso(datexText(record.situationRecordCreationTime));
        const versionTime = firstIso(datexText(record.situationRecordVersionTime));
        const validity = isObject(record.validity) ? record.validity : {};
        const validityTimeSpecification = isObject(validity.validityTimeSpecification)
          ? validity.validityTimeSpecification
          : {};
        const validityStatus = datexText(validity.validityStatus).trim();
        const validFrom =
          firstIso(
            datexText(validityTimeSpecification.overallStartTime),
            creationTime,
            versionTime,
            publicationTime,
            options.receivedAt,
          ) ?? options.receivedAt;
        const validTo =
          firstIso(datexText(validityTimeSpecification.overallEndTime)) ??
          receivedAtPlusOneDay(options.receivedAt);
        const roadNumber = firstTextForKey(record.roadInformation, "roadNumber");
        const roadName = firstTextForKey(record.roadInformation, "roadName");
        const comments = publicComments(record);
        const title = titleForRecord(record, kind, roadName, roadNumber);
        const geometry = pointGeometry(record);

        events.push({
          id: datexId(situationId, recordId),
          source: "datex",
          eventType: "traffic",
          title,
          detail: comments.join("\n") || title,
          sourceUrl: options.endpoint,
          areaLabel: roadName || roadNumber || "Vegtrafikk",
          state: recordState(validityStatus),
          severity: datexText(record.severity).trim() || overallSeverity || undefined,
          publishedAt: publicationTime ?? versionTime ?? creationTime ?? options.receivedAt,
          validFrom,
          validTo,
          ...(geometry ? { geometry } : {}),
          raw: {
            datex: {
              situationId,
              recordId,
              version,
              recordKind: kind,
              roadNumber,
              roadName,
              receivedAt: options.receivedAt,
              publicationTime,
              situationRecordCreationTime: creationTime,
              situationRecordVersionTime: versionTime,
              validityStatus,
            },
            situation,
            record,
          },
        });
      }
    }
  }

  return { events: events.filter(isRelevantToNytt) };
}
