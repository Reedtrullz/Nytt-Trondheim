import { XMLParser } from "fast-xml-parser";
import type { OfficialEvent } from "@nytt/shared";

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

// Used by Task 4 parser implementation.
void parseXml;

export interface DatexParseOptions {
  endpoint: string;
  receivedAt: string;
}

export interface DatexParseResult {
  events: OfficialEvent[];
}

export function parseDatexSituationPublication(
  xml: string,
  options: DatexParseOptions,
): DatexParseResult {
  void xml;
  void options;

  return { events: [] };
}
