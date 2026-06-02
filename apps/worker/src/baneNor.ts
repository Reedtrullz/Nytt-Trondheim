import { createHash } from "node:crypto";
import type { SourceItemInput } from "@nytt/shared";
import { XMLParser } from "fast-xml-parser";

export const baneNorRssEndpoint =
  "https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true";

export type BaneNorRailMessageState = "active" | "planned" | "unknown";
export type BaneNorRssItem = Record<string, unknown>;

export interface BaneNorRailMessage {
  id: string;
  source: "bane_nor";
  guid: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  receivedAt: string;
  state: BaneNorRailMessageState;
  validFrom?: string;
  validTo?: string;
  matchedTerms: string[];
  promotion: "none";
}

export interface BaneNorParseOptions {
  receivedAt: string;
}

export interface BaneNorParseResult {
  messages: BaneNorRailMessage[];
  seenGuids: string[];
  rawItemsByGuid: Map<string, BaneNorRssItem>;
}

const railTerms = [
  "Trondheim S",
  "Leangen",
  "Marienborg",
  "Støren",
  "Hell",
  "Steinkjer",
  "Storlien",
  "Dombås",
  "Levanger",
  "Åsen",
  "Ronglan",
  "Nordlandsbanen",
  "Dovrebanen",
  "Meråkerbanen",
  "Trønderbanen",
  "Rørosbanen",
];

const norwegianMonths = new Map([
  ["januar", 1],
  ["jan", 1],
  ["februar", 2],
  ["feb", 2],
  ["mars", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["mai", 5],
  ["juni", 6],
  ["jun", 6],
  ["juli", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["oktober", 10],
  ["okt", 10],
  ["november", 11],
  ["nov", 11],
  ["desember", 12],
  ["des", 12],
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sha256(JSON.stringify([provider, kind, stableKey]))}`;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
  }
  const valueObject = object(value);
  if (valueObject && "#text" in valueObject) return text(valueObject["#text"]);
  return undefined;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function publishedAt(value: unknown, fallback: string): string {
  const parsed = Date.parse(text(value) ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "iu");
}

function matchedRailTerms(value: string): string[] {
  return railTerms
    .filter((term) => termPattern(term).test(value))
    .sort((left, right) => left.localeCompare(right, "nb"));
}

function osloOffsetMillis(date: Date): number | undefined {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  const second = Number(values.get("second"));
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return undefined;
  return Date.UTC(year, month - 1, day, hour, minute, second) - date.getTime();
}

function osloWallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utc = localAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const offset = osloOffsetMillis(new Date(utc));
    if (offset === undefined) return undefined;
    utc = localAsUtc - offset;
  }
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function parseValidityPhrase(
  description: string,
  receivedAt: string,
): { validFrom?: string; validTo?: string } {
  const match =
    /Fra\s+[\p{L}.]+\s+(\d{1,2})\.\s*([\p{L}æøåÆØÅ]+)\s+kl\.\s*(\d{1,2}):(\d{2})\s+til\s+[\p{L}.]+\s+(\d{1,2})\.\s*([\p{L}æøåÆØÅ]+)\s+kl\.\s*(\d{1,2}):(\d{2})/iu.exec(
      description,
    );
  if (!match) return {};

  const [, fromDay, fromMonthName, fromHour, fromMinute, toDay, toMonthName, toHour, toMinute] =
    match;
  const receivedYear = new Date(receivedAt).getUTCFullYear();
  const fromMonth = norwegianMonths.get(fromMonthName!.toLocaleLowerCase("nb"));
  const toMonth = norwegianMonths.get(toMonthName!.toLocaleLowerCase("nb"));
  if (!fromMonth || !toMonth) return {};

  const validFrom = osloWallTimeToIso(
    receivedYear,
    fromMonth,
    Number(fromDay),
    Number(fromHour),
    Number(fromMinute),
  );
  const toYear = toMonth < fromMonth ? receivedYear + 1 : receivedYear;
  const validTo = osloWallTimeToIso(
    toYear,
    toMonth,
    Number(toDay),
    Number(toHour),
    Number(toMinute),
  );

  return { validFrom, validTo };
}

function hasClosureTerms(value: string): boolean {
  return /\b(stengt|innstilt|kansellert|arbeid|vedlikehold|buss\s+for\s+tog|forsinkelser?)\b/iu.test(
    value,
  );
}

function stateFromValidity({
  textValue,
  validFrom,
  validTo,
  receivedAt,
}: {
  textValue: string;
  validFrom?: string;
  validTo?: string;
  receivedAt: string;
}): BaneNorRailMessageState {
  const received = Date.parse(receivedAt);
  const from = validFrom ? Date.parse(validFrom) : undefined;
  const to = validTo ? Date.parse(validTo) : undefined;

  if (to !== undefined && Number.isFinite(to) && to < received) return "unknown";
  if (from !== undefined && Number.isFinite(from) && from > received) return "planned";
  if (hasClosureTerms(textValue)) return "active";
  if (from !== undefined && Number.isFinite(from)) return "planned";
  return "unknown";
}

export function parseBaneNorRss(rawXml: string, options: BaneNorParseOptions): BaneNorParseResult {
  const feed = new XMLParser({ ignoreAttributes: false }).parse(rawXml) as {
    rss?: { channel?: { item?: BaneNorRssItem | BaneNorRssItem[] } };
  };
  const messages: BaneNorRailMessage[] = [];
  const seenGuids: string[] = [];
  const rawItemsByGuid = new Map<string, BaneNorRssItem>();

  for (const item of asArray(feed.rss?.channel?.item)) {
    if (!object(item)) continue;
    const guid = text(item.guid);
    if (!guid) continue;
    seenGuids.push(guid);
    rawItemsByGuid.set(guid, item);

    const title = text(item.title) ?? "Trafikkmelding";
    const description = stripHtml(text(item.description) ?? "");
    const haystack = `${title} ${description}`;
    const matchedTerms = matchedRailTerms(haystack);
    if (matchedTerms.length === 0) continue;

    const { validFrom, validTo } = parseValidityPhrase(description, options.receivedAt);
    const url = canonicalUrl(text(item.link)) ?? baneNorRssEndpoint;
    const message: BaneNorRailMessage = {
      id: `bane-nor:${guid}`,
      source: "bane_nor",
      guid,
      title,
      description,
      url,
      publishedAt: publishedAt(item.pubDate, options.receivedAt),
      receivedAt: options.receivedAt,
      state: stateFromValidity({ textValue: haystack, validFrom, validTo, receivedAt: options.receivedAt }),
      validFrom,
      validTo,
      matchedTerms,
      promotion: "none",
    };
    messages.push(message);
  }

  return { messages, seenGuids, rawItemsByGuid };
}

export function baneNorSourceItemInput(
  message: BaneNorRailMessage,
  options: { fetchedAt: string; rawItem: unknown },
): SourceItemInput {
  return {
    id: sourceItemId("bane_nor", "official_event", message.guid),
    provider: "bane_nor",
    kind: "official_event",
    externalId: message.guid,
    originalUrl: message.url,
    title: message.title,
    summary: message.description,
    publishedAt: message.publishedAt,
    fetchedAt: options.fetchedAt,
    rawPayload: options.rawItem,
    normalizedPayload: message,
    captureHash: sha256(
      JSON.stringify([
        "bane_nor",
        "official_event",
        message.guid,
        message.title,
        message.publishedAt,
        message.description,
        message.validFrom,
        message.validTo,
      ]),
    ),
    reliabilityTier: "official",
  };
}

export async function fetchBaneNorRailMessages({
  endpoint = baneNorRssEndpoint,
  receivedAt = new Date().toISOString(),
  fetcher = fetch,
}: {
  endpoint?: string;
  receivedAt?: string;
  fetcher?: typeof fetch;
} = {}): Promise<BaneNorParseResult> {
  const response = await fetcher(endpoint, {
    headers: { "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech" },
  });
  if (!response.ok) throw new Error(`Bane NOR RSS fetch failed ${response.status}`);
  return parseBaneNorRss(await response.text(), { receivedAt });
}
