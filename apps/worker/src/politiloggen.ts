import { createHash } from "node:crypto";
import type { Article, EvidenceItem, MapFeature, Situation } from "@nytt/shared";
import { fetchWithSourcePolicy } from "./fetchPolicy.js";

export interface PolitiloggenThreadMessage {
  id?: string | null;
  text?: string | null;
  createdOn?: string | null;
  updatedOn?: string | null;
  hasImage?: boolean;
  previouslyIncludedImage?: boolean;
  type?: string | null;
}

export interface PolitiloggenThread {
  id?: string | null;
  district?: string | null;
  districtId?: number | null;
  category?: string | null;
  municipality?: string | null;
  area?: string | null;
  createdOn?: string | null;
  updatedOn?: string | null;
  lastMessageOn?: string | null;
  isActive?: boolean;
  messages?: PolitiloggenThreadMessage[] | null;
}

export interface PolitiloggenCollection {
  threads: PolitiloggenThread[];
  articles: Article[];
  count: number;
}

export const defaultPolitiloggenEndpoint = "https://api.politiloggen.politiet.no/messagethreads";

export function isPolitiloggenEnabled(): boolean {
  return process.env.POLITILOGGEN_ENABLED?.trim().toLocaleLowerCase("en") !== "false";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeMessage(value: unknown): PolitiloggenThreadMessage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    text: asString(value.text),
    createdOn: asString(value.createdOn),
    updatedOn: asString(value.updatedOn),
    hasImage: asBoolean(value.hasImage),
    previouslyIncludedImage: asBoolean(value.previouslyIncludedImage),
    type: asString(value.type),
  };
}

function normalizeThread(value: unknown): PolitiloggenThread | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  if (!id) return undefined;
  const messages = Array.isArray(value.messages)
    ? value.messages.flatMap((message) => {
        const normalized = normalizeMessage(message);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id,
    district: asString(value.district),
    districtId: asNumber(value.districtId),
    category: asString(value.category),
    municipality: asString(value.municipality),
    area: asString(value.area),
    createdOn: asString(value.createdOn),
    updatedOn: asString(value.updatedOn),
    lastMessageOn: asString(value.lastMessageOn),
    isActive: asBoolean(value.isActive) ?? false,
    messages,
  };
}

function toIso(value: string | null | undefined, fallback?: string): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  if (fallback) return fallback;
  return new Date().toISOString();
}

function orderedMessages(thread: PolitiloggenThread): PolitiloggenThreadMessage[] {
  return [...(thread.messages ?? [])]
    .filter((message) => message.type !== "Removed")
    .sort((left, right) =>
      toIso(left.createdOn, toIso(thread.createdOn)).localeCompare(
        toIso(right.createdOn, toIso(thread.createdOn)),
      ),
    );
}

function compact(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  ];
}

function sourceUrl(thread: PolitiloggenThread): string {
  return `https://www.politiet.no/politiloggen/hendelse/${encodeURIComponent(thread.id ?? "")}`;
}

function titleForThread(thread: PolitiloggenThread): string {
  const category = thread.category?.trim() || "Politilogg";
  const location = compact([thread.municipality ?? undefined, thread.area ?? undefined]).join(", ");
  return location ? `${category}: ${location}` : category;
}

function excerptForThread(thread: PolitiloggenThread): string {
  const texts = orderedMessages(thread)
    .map((message) => message.text?.trim())
    .filter(Boolean);
  return texts.length > 0 ? texts.join("\n") : titleForThread(thread);
}

function categoryForThread(thread: PolitiloggenThread): Article["category"] {
  const category = `${thread.category ?? ""}`.toLocaleLowerCase("nb");
  if (category.includes("trafikk")) return "Transport";
  if (category.includes("vær")) return "Vær";
  return "Hendelser";
}

function typeForThread(thread: PolitiloggenThread): Situation["type"] {
  const text = `${thread.category ?? ""} ${excerptForThread(thread)}`.toLocaleLowerCase("nb");
  if (/\b(brann|røykutvikling)\b/.test(text)) return "fire";
  if (/\b(savnet|leteaksjon|forsvunnet)\b/.test(text)) return "missing_person";
  if (/\b(trafikk|kollisjon|påkjørt|bilstans|fartskontroll|uhell|fører|kjøring)\b/.test(text)) {
    return "traffic";
  }
  if (/\b(redning|ulykke|ambulanse|skadet|skadd)\b/.test(text)) return "rescue";
  return "other";
}

const genericAreas = new Set(["trondheim", "trøndelag", "trondelag"]);
const lowImpactCategories = /\b(fartskontroll|kontroll|ordenstjeneste)\b/i;

function hasConcretePlace(thread: PolitiloggenThread, article: Article | undefined): boolean {
  const area = thread.area?.trim().toLocaleLowerCase("nb");
  return Boolean((area && !genericAreas.has(area)) || article?.location);
}

function isResolvedByLatestMessage(thread: PolitiloggenThread): boolean {
  const latestText = orderedMessages(thread).at(-1)?.text?.toLocaleLowerCase("nb") ?? "";
  return /\b(trafikken går som normalt igjen|går som normalt igjen|normal trafikk|veien er åpnet|vegen er åpnet|veien åpnet|vegen åpnet|bilen er nå hentet|kjøretøyet er hentet|ryddet|avsluttet)\b/u.test(
    latestText,
  );
}

function shouldPromoteThread(
  thread: PolitiloggenThread,
  type: Situation["type"],
  article: Article | undefined,
): boolean {
  if (!hasConcretePlace(thread, article)) return false;
  if (lowImpactCategories.test(thread.category ?? "")) return false;
  if (type === "other" || type === "weather" || type === "flood" || type === "landslide") {
    return false;
  }
  return true;
}

function articleForThread(thread: PolitiloggenThread): Article | undefined {
  if (!thread.id) return undefined;
  const firstMessageAt = orderedMessages(thread)[0]?.createdOn;
  return {
    id: `politiloggen-${thread.id}`,
    source: "politiloggen",
    sourceLabel: "Politiloggen",
    title: titleForThread(thread),
    excerpt: excerptForThread(thread),
    url: sourceUrl(thread),
    publishedAt: toIso(thread.createdOn, toIso(firstMessageAt)),
    scope: "trondheim",
    category: categoryForThread(thread),
    places: compact([thread.area ?? undefined, thread.municipality ?? undefined]),
  };
}

export async function collectPolitiloggen(
  fetcher: typeof fetch = fetch,
  endpoint = process.env.POLITILOGGEN_ENDPOINT?.trim() || defaultPolitiloggenEndpoint,
): Promise<PolitiloggenCollection> {
  const url = new URL(endpoint);
  url.searchParams.set("Municipalities", "Trondheim");
  url.searchParams.set("Take", "1000");
  url.searchParams.set("Skip", "0");
  url.searchParams.set("SortByEnum", "LastMessageOn");
  url.searchParams.set("SortByAsc", "false");

  const response = await fetchWithSourcePolicy(fetcher, url);
  if (response.status === 204) return { threads: [], articles: [], count: 0 };
  if (!response.ok) throw new Error(`Politiloggen returned HTTP ${response.status}`);

  const payload = (await response.json()) as unknown;
  const rawThreads =
    isRecord(payload) && Array.isArray(payload.messageThreads) ? payload.messageThreads : [];
  const threads = rawThreads.flatMap((thread) => {
    const normalized = normalizeThread(thread);
    return normalized ? [normalized] : [];
  });
  return {
    threads,
    articles: threads.flatMap((thread) => {
      if (!thread.isActive) return [];
      const article = articleForThread(thread);
      return article ? [article] : [];
    }),
    count: isRecord(payload) && typeof payload.count === "number" ? payload.count : threads.length,
  };
}

function evidenceForThread(
  id: string,
  thread: PolitiloggenThread,
  extractedAt: string,
): EvidenceItem[] {
  return orderedMessages(thread).map((message) => ({
    id: createHash("sha1")
      .update(
        `${id}:politiloggen-evidence:${message.id ?? message.createdOn ?? message.text ?? ""}`,
      )
      .digest("hex")
      .slice(0, 18),
    situationId: id,
    source: "politiloggen",
    sourceLabel: "Politiloggen",
    sourceUrl: sourceUrl(thread),
    supportingSnippet: message.text ?? "",
    claim: titleForThread(thread),
    claimType: "official_police_log",
    provenance: "official",
    confidence: 1,
    extractedAt,
    publishedAt: toIso(message.createdOn, toIso(thread.createdOn)),
  }));
}

function timelineForThread(id: string, thread: PolitiloggenThread): Situation["timeline"] {
  return orderedMessages(thread).map((message) => ({
    id: `timeline-politiloggen-${message.id ?? createHash("sha1").update(`${id}:${message.text}`).digest("hex").slice(0, 12)}`,
    situationId: id,
    timestamp: toIso(message.createdOn, toIso(thread.createdOn)),
    title: `Politiloggen: ${thread.category ?? "Oppdatering"}`,
    detail: message.text ?? "",
    sourceLabel: "Politiloggen",
    sourceUrl: sourceUrl(thread),
    official: true,
  }));
}

function featureForArticle(id: string, article: Article | undefined): MapFeature[] {
  if (!article?.location) return [];
  return [
    {
      id: createHash("sha1")
        .update(`${id}:politiloggen-feature:${article.location.lat}:${article.location.lng}`)
        .digest("hex")
        .slice(0, 18),
      type: "Feature" as const,
      geometry: { type: "Point", coordinates: [article.location.lng, article.location.lat] },
      properties: {
        label: `${article.location.label} - geokodet anslag fra Politiloggen`,
        provenance: "official" as const,
        sourceLabel: "Politiloggen",
        sourceUrl: article.url,
        updatedAt: article.publishedAt,
        layer: "official",
      },
    },
  ];
}

export function politiloggenSituationsFromThreads(
  threads: PolitiloggenThread[],
  existingSituations: Situation[] = [],
  articles: Article[] = [],
): Situation[] {
  const existingBySignature = new Map(
    existingSituations
      .filter((situation) => situation.incidentSignature?.startsWith("politiloggen:"))
      .map((situation) => [situation.incidentSignature!, situation]),
  );
  const articleByThreadId = new Map(
    articles
      .filter((article) => article.source === "politiloggen")
      .map((article) => [article.id.replace(/^politiloggen-/, ""), article]),
  );

  return threads.flatMap((thread) => {
    if (!thread.id) return [];
    const incidentSignature = `politiloggen:${thread.id}`;
    const existing = existingBySignature.get(incidentSignature);
    if (!thread.isActive && !existing) return [];

    const id = existing?.id ?? `politiloggen-${thread.id}`;
    const articleId = `politiloggen-${thread.id}`;
    const article = articleByThreadId.get(thread.id);
    const extractedAt = new Date().toISOString();
    const type = typeForThread(thread);
    const promotable = shouldPromoteThread(thread, type, article);
    if (!promotable && !existing) return [];
    const latestMessageAt = orderedMessages(thread)
      .map((message) => toIso(message.createdOn, toIso(thread.createdOn)))
      .sort((left, right) => right.localeCompare(left))[0];
    const updatedAt = toIso(
      thread.lastMessageOn ?? thread.updatedOn,
      latestMessageAt ?? toIso(thread.createdOn),
    );
    const createdAt = existing?.createdAt ?? toIso(thread.createdOn, latestMessageAt);
    const resolvedByMessage = isResolvedByLatestMessage(thread);
    const status: Situation["status"] =
      thread.isActive && promotable && !resolvedByMessage ? "active" : "resolved";
    const timeline = timelineForThread(id, thread);
    if (!thread.isActive || resolvedByMessage || !promotable) {
      timeline.push({
        id: `timeline-politiloggen-resolved-${thread.id}`,
        situationId: id,
        timestamp: updatedAt,
        title: "Politiloggen-hendelsen er avsluttet",
        detail: resolvedByMessage
          ? "Siste Politiloggen-oppdatering beskriver hendelsen som avsluttet."
          : promotable
            ? "Politiloggen markerer ikke lenger hendelsen som aktiv."
            : "Politiloggen-hendelsen oppfyller ikke lenger terskelen for automatisk situasjonsrom.",
        sourceLabel: "Politiloggen",
        sourceUrl: sourceUrl(thread),
        official: true,
      });
    }

    return [
      {
        id,
        type,
        title: titleForThread(thread),
        summary: excerptForThread(thread),
        status,
        verificationStatus: "Offentlig bekreftet",
        importance: type === "fire" || type === "rescue" ? "high" : "normal",
        updatedAt,
        createdAt,
        locationLabel: thread.area?.trim() || thread.municipality?.trim() || "Trondheim",
        incidentSignature,
        detectionVersion: "politiloggen-1",
        officialSource: "politiloggen",
        officialEventId: thread.id,
        activationBasis: existing?.activationBasis ?? {
          rule: "official_source",
          sourceIds: ["politiloggen"],
          articleIds: [articleId],
          activatedAt: createdAt,
        },
        relatedArticleIds: [articleId],
        evidence: evidenceForThread(id, thread, extractedAt),
        features: featureForArticle(id, article),
        timeline,
      } satisfies Situation,
    ];
  });
}
