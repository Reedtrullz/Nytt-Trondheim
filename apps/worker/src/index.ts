import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type {
  Article,
  ArticleCoverageAnalysis,
  OfficialEvent,
  PublicTransportServiceAlert,
  SourceCollectorRun,
  SourceItemInput,
  TrafficCounterSnapshot,
  WorkerCycleMetrics,
} from "@nytt/shared";
import { analyzeArticleCoverage } from "@nytt/shared";
import {
  collectFrontpage,
  collectMunicipality,
  collectRss,
  frontpageSources,
  probeOfficialSources,
  rssSources,
} from "./collectors.js";
import { applySituationUpdateHints, createAnalyzer, enhanceSituations } from "./ai.js";
import {
  collectDatexTravelTimePulse,
  defaultDatexTravelTimeDataEndpoint,
  defaultDatexTravelTimeLocationsEndpoint,
} from "./datexTravelTime.js";
import {
  detectPreliminarySituations,
  officialTrafficSituationsFromEvents,
  promotableDatexEventIds,
  resolvedDuplicateOfficialTrafficSituationsForMergedDatex,
  resolvedNonPromotableOfficialTrafficSituations,
  resolvedOfficialTrafficSituationsForMissingDatex,
} from "./clusters.js";
import {
  collectDatexSituationEvents,
  datexBasicAuthHeader,
  defaultDatexSituationEndpoint,
  normalizeDatexCredentialedEndpoint,
  normalizeDatexSituationEndpoint,
} from "./datex.js";
import {
  defaultDatexWeatherMeasurementsEndpoint,
  defaultDatexWeatherSitesEndpoint,
  parseDatexRoadWeather,
} from "./datexRoadWeather.js";
import {
  defaultDatexCctvSitesEndpoint,
  defaultDatexCctvStatusEndpoint,
  parseDatexCctv,
} from "./datexCctv.js";
import {
  defaultTrafikkdataGraphqlEndpoint,
  fetchTrafikkdataCounterSnapshots,
} from "./trafikkdata.js";
import { fetchEnturVehicles, type EnturVehicleBounds } from "./enturVehicles.js";
import { enturServiceAlertSourceItemInput, fetchEnturServiceAlerts } from "./enturServiceAlerts.js";
import {
  collectPolitiloggen,
  isPolitiloggenEnabled,
  politiloggenSituationsFromThreads,
  type PolitiloggenThread,
} from "./politiloggen.js";
import { geocodeArticles } from "./geocode.js";
import { collectMetWarnings, collectNveWarnings } from "./official.js";
import { fetchWithSourcePolicy, sourceUserAgent } from "./fetchPolicy.js";
import { WorkerRepository } from "./repository.js";
import {
  collectTrafficInfoMessages,
  defaultTrafficInfoEndpoint,
  trafficInfoSourceItemInput,
} from "./vegvesenTrafficInfo.js";
import { baneNorSourceItemInput, fetchBaneNorRailMessages } from "./baneNor.js";

const municipalityIntervalMs = 60 * 60 * 1000;
let lastMunicipalityCollection = 0;

export { normalizeDatexSituationEndpoint };

interface CollectionContext {
  repository: WorkerRepository;
  analyzer: ReturnType<typeof createAnalyzer>;
  once: boolean;
}

export interface WorkerSourceMetricInput {
  source: string;
  startedAtMs: number;
  completedAtMs: number;
  sourceItemCount?: number;
  parseFailures?: number;
  skipped?: boolean;
}

interface WorkerCollectorTelemetry {
  sourceItemCount?: number;
  parseFailures?: number;
  skipped?: boolean;
}

export async function prepareArticleCoverageAnalysis({
  articlesForGeocoding,
  articlesWithoutGeocoding = [],
  generatedAt = new Date().toISOString(),
  geocoder = geocodeArticles,
}: {
  articlesForGeocoding: Article[];
  articlesWithoutGeocoding?: Article[];
  generatedAt?: string;
  geocoder?: typeof geocodeArticles;
}): Promise<ArticleCoverageAnalysis> {
  const articlesForAnalysis = articlesForGeocoding.map(stripArticleCoverageBundle);
  const fixedArticlesForAnalysis = articlesWithoutGeocoding.map(stripArticleCoverageBundle);
  return analyzeArticleCoverage(
    [
      ...(await geocoder(articlesForAnalysis)).map(stripArticleCoverageBundle),
      ...fixedArticlesForAnalysis,
    ],
    generatedAt,
  );
}

function stripArticleCoverageBundle(article: Article): Article {
  const articleWithoutCoverageBundle = { ...article };
  delete articleWithoutCoverageBundle.coverageBundle;
  return articleWithoutCoverageBundle;
}

export function buildWorkerCycleMetrics({
  cycleStartedAt,
  cycleCompletedAt,
  sources,
}: {
  cycleStartedAt: Date;
  cycleCompletedAt: Date;
  sources: WorkerSourceMetricInput[];
}): WorkerCycleMetrics {
  const sourceDurationsMs: Record<string, number> = {};
  const sourceItemCounts: Record<string, number> = {};
  const parseFailures: Record<string, number> = {};

  for (const source of sources) {
    const durationMs = Math.max(0, Math.round(source.completedAtMs - source.startedAtMs));
    sourceDurationsMs[source.source] = (sourceDurationsMs[source.source] ?? 0) + durationMs;
    if (source.sourceItemCount !== undefined) {
      sourceItemCounts[source.source] =
        (sourceItemCounts[source.source] ?? 0) + Math.max(0, Math.round(source.sourceItemCount));
    }
    if (source.parseFailures !== undefined) {
      parseFailures[source.source] =
        (parseFailures[source.source] ?? 0) + Math.max(0, Math.round(source.parseFailures));
    }
  }

  return {
    cycleStartedAt: cycleStartedAt.toISOString(),
    cycleCompletedAt: cycleCompletedAt.toISOString(),
    cycleDurationMs: Math.max(0, Math.round(cycleCompletedAt.getTime() - cycleStartedAt.getTime())),
    sourceDurationsMs,
    sourceItemCounts,
    parseFailures,
  };
}

export function collectorRunFromMetric(metric: WorkerSourceMetricInput): SourceCollectorRun {
  const startedAt = new Date(metric.startedAtMs);
  const completedAt = new Date(metric.completedAtMs);
  const parseFailures = Math.max(0, Math.round(metric.parseFailures ?? 0));
  const accepted = Math.max(0, Math.round(metric.sourceItemCount ?? 0));
  const status = metric.skipped
    ? "skipped"
    : parseFailures > 0
      ? accepted > 0
        ? "partial"
        : "failed"
      : "succeeded";

  return {
    id: `${metric.source}:${startedAt.toISOString()}:${completedAt.getTime()}`,
    source: metric.source as SourceCollectorRun["source"],
    collector: metric.source,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, Math.round(metric.completedAtMs - metric.startedAtMs)),
    recordsSeen: accepted + parseFailures,
    recordsAccepted: accepted,
    recordsRejected: parseFailures,
    ...(parseFailures > 0
      ? {
          errorCode: "parse_or_collection_failure",
          errorMessage: `${parseFailures} parse- eller innhentingsfeil i siste kjøring`,
        }
      : {}),
  };
}

export function shouldResolveMissingDatexSituations(freshSnapshot: boolean): boolean {
  return freshSnapshot;
}

export function createCollectionGuard(
  collect: () => Promise<void>,
  onSkip: () => void = () =>
    console.warn("[worker] skipping collection tick; previous cycle still running"),
): () => Promise<void> {
  let collectionRunning = false;
  return async () => {
    if (collectionRunning) {
      onSkip();
      return;
    }
    collectionRunning = true;
    try {
      await collect();
    } finally {
      collectionRunning = false;
    }
  };
}

export async function collectTrafficInfoForMap({
  repository,
  endpoint,
  nextPollAt,
  now = () => new Date(),
  collector = collectTrafficInfoMessages,
}: {
  repository: WorkerRepository;
  endpoint: string;
  nextPollAt: string;
  now?: () => Date;
  collector?: typeof collectTrafficInfoMessages;
}): Promise<WorkerCollectorTelemetry> {
  try {
    const checkedAt = now().toISOString();
    const fetchedAt = checkedAt;
    const result = await collector({ endpoint, now });
    await repository.upsertTrafficMapEvents(result.events, {
      source: "vegvesen_traffic_info",
      fetchedAt,
    });
    await repository.upsertTrafficInfoSourceItems(
      result.events.map((event) =>
        trafficInfoSourceItemInput(event, {
          fetchedAt,
          rawMessage: result.rawMessagesById.get(event.sourceEventId) ?? event,
        }),
      ),
    );
    const expiredCount = await repository.markMissingTrafficMapEventsExpired(
      "vegvesen_traffic_info",
      result.events.map((event) => event.sourceEventId),
      fetchedAt,
    );
    const staleExpiredCount = await repository.expireStaleOpenEndedTrafficMapEvents(
      "vegvesen_traffic_info",
      fetchedAt,
      7 * 24,
    );
    await repository.setCollectorState("vegvesen_traffic_info:lastHash", result.sourcePayloadHash);
    await repository.setHealth({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${result.relevantMessages} relevante av ${result.totalMessages} Vegvesen trafikkmeldinger hentet (${result.events.filter((event) => event.state === "active").length} aktive, ${result.events.filter((event) => event.state === "planned").length} planlagte, ${expiredCount} utløpt fra snapshot, ${staleExpiredCount} stale utløpt)`,
    });
    return { sourceItemCount: result.events.length, parseFailures: 0 };
  } catch (error) {
    const failureAt = now().toISOString();
    await repository.setHealth({
      source: "vegvesen_traffic_info",
      label: "Vegvesen trafikkmeldinger",
      state: "degraded",
      lastCheckedAt: failureAt,
      lastFailureAt: failureAt,
      nextPollAt,
      detail: `TrafficInfo-innhenting feilet: ${String(error)}`,
    });
    return { sourceItemCount: 0, parseFailures: 1 };
  }
}

function enturBoundsFromEnv(value: string | undefined): EnturVehicleBounds {
  const fallback = { minLat: 63.3, minLon: 10.2, maxLat: 63.55, maxLon: 10.65 };
  if (!value) return fallback;
  const parts = value.split(",").map((entry) => entry.trim());
  if (parts.length !== 4 || parts.some((entry) => entry.length === 0)) return fallback;
  const [minLat, minLon, maxLat, maxLon] = parts.map(Number);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return fallback;
  if (minLat! < -90 || maxLat! > 90 || minLon! < -180 || maxLon! > 180) return fallback;
  if (minLat! >= maxLat! || minLon! >= maxLon!) return fallback;
  return { minLat: minLat!, minLon: minLon!, maxLat: maxLat!, maxLon: maxLon! };
}

function enturCodespacesFromEnv(value: string | undefined): string[] {
  const seen = new Set<string>();
  for (const entry of (value ?? "ATB").split(",")) {
    const codespace = entry.trim().toUpperCase();
    if (codespace) seen.add(codespace);
  }
  return seen.size ? [...seen] : ["ATB"];
}

type EnturVehicleRepository = Pick<
  WorkerRepository,
  "markMissingPublicTransportVehiclesStale" | "setHealth" | "upsertPublicTransportVehicles"
>;

type EnturVehicleCollector = typeof fetchEnturVehicles;

export async function collectEnturVehiclesForMap({
  repository,
  clientName,
  codespaceId,
  bounds,
  nextPollAt,
  now = () => new Date(),
  collector = fetchEnturVehicles,
}: {
  repository: EnturVehicleRepository;
  clientName: string;
  codespaceId: string;
  bounds: EnturVehicleBounds;
  nextPollAt: string;
  now?: () => Date;
  collector?: EnturVehicleCollector;
}): Promise<WorkerCollectorTelemetry> {
  return collectEnturVehiclesForMapCodespaces({
    repository,
    clientName,
    codespaceIds: [codespaceId],
    bounds,
    nextPollAt,
    now,
    collector,
  });
}

export async function collectEnturVehiclesForMapCodespaces({
  repository,
  clientName,
  codespaceIds,
  bounds,
  nextPollAt,
  now = () => new Date(),
  collector = fetchEnturVehicles,
}: {
  repository: EnturVehicleRepository;
  clientName: string;
  codespaceIds: string[];
  bounds: EnturVehicleBounds;
  nextPollAt: string;
  now?: () => Date;
  collector?: EnturVehicleCollector;
}): Promise<WorkerCollectorTelemetry> {
  const checkedAt = now().toISOString();
  let vehicleCount = 0;
  let staleCount = 0;
  let successfulCodespaces = 0;
  const failures: string[] = [];

  for (const codespaceId of codespaceIds) {
    try {
      const result = await collector({ clientName, codespaceId, bounds });
      await repository.upsertPublicTransportVehicles(result.vehicles, checkedAt);
      staleCount += await repository.markMissingPublicTransportVehiclesStale(
        "entur_vehicle_positions",
        codespaceId,
        result.activeVehicleIds,
        checkedAt,
      );
      vehicleCount += result.vehicles.length;
      successfulCodespaces += 1;
    } catch (error) {
      failures.push(`${codespaceId}: ${String(error)}`);
    }
  }

  await repository.setHealth({
    source: "entur_vehicle_positions",
    label: "Entur kjøretøyposisjoner",
    state: failures.length ? "degraded" : "ok",
    lastCheckedAt: checkedAt,
    lastFailureAt: failures.length ? checkedAt : undefined,
    nextPollAt,
    detail: failures.length
      ? `${vehicleCount} kjøretøy oppdatert fra ${successfulCodespaces}/${codespaceIds.length} codespaces (${staleCount} markert stale). Feil: ${failures.join("; ")}`
      : `${vehicleCount} kjøretøy oppdatert fra ${successfulCodespaces} codespaces (${staleCount} markert stale)`,
  });
  return { sourceItemCount: vehicleCount, parseFailures: failures.length };
}

type EnturServiceAlertRepository = Pick<
  WorkerRepository,
  | "expireMissingPublicTransportServiceAlerts"
  | "setHealth"
  | "upsertEnturServiceAlertSourceItems"
  | "upsertPublicTransportServiceAlerts"
>;

type EnturServiceAlertCollector = typeof fetchEnturServiceAlerts;

export async function collectEnturServiceAlerts({
  repository,
  clientName,
  codespaceIds,
  nextPollAt,
  now = () => new Date(),
  collector = fetchEnturServiceAlerts,
}: {
  repository: EnturServiceAlertRepository;
  clientName: string;
  codespaceIds: string[];
  nextPollAt: string;
  now?: () => Date;
  collector?: EnturServiceAlertCollector;
}): Promise<WorkerCollectorTelemetry> {
  const checkedAt = now().toISOString();
  const allAlerts: PublicTransportServiceAlert[] = [];
  const activeSituationNumbersByCodespace = new Map<string, string[]>();
  const sourceItems: SourceItemInput[] = [];
  const failures: string[] = [];

  for (const codespaceId of codespaceIds) {
    try {
      const result = await collector({ clientName, codespaceId, receivedAt: checkedAt });
      allAlerts.push(...result.alerts);
      activeSituationNumbersByCodespace.set(codespaceId, result.activeSituationNumbers);
      sourceItems.push(
        ...result.alerts.map((alert) =>
          enturServiceAlertSourceItemInput(alert, {
            fetchedAt: checkedAt,
            rawAlert: result.rawAlertsBySituationNumber.get(alert.situationNumber) ?? alert,
          }),
        ),
      );
    } catch (error) {
      failures.push(`${codespaceId}: ${String(error)}`);
    }
  }

  let expiredCount = 0;
  if (allAlerts.length) {
    await repository.upsertPublicTransportServiceAlerts(allAlerts, checkedAt);
  }
  if (sourceItems.length) {
    await repository.upsertEnturServiceAlertSourceItems(sourceItems);
  }
  for (const [codespaceId, activeSituationNumbers] of activeSituationNumbersByCodespace) {
    expiredCount += await repository.expireMissingPublicTransportServiceAlerts(
      "entur_service_alerts",
      codespaceId,
      activeSituationNumbers,
      checkedAt,
    );
  }

  await repository.setHealth({
    source: "entur_service_alerts",
    label: "Entur trafikkavvik",
    state: failures.length ? "degraded" : "ok",
    lastCheckedAt: checkedAt,
    lastFailureAt: failures.length ? checkedAt : undefined,
    nextPollAt,
    detail: failures.length
      ? `${allAlerts.length} Entur trafikkavvik oppdatert fra ${activeSituationNumbersByCodespace.size}/${codespaceIds.length} codespaces (${expiredCount} utløpt fra snapshot). Feil: ${failures.join("; ")}`
      : `${allAlerts.length} Entur trafikkavvik oppdatert fra ${activeSituationNumbersByCodespace.size}/${codespaceIds.length} codespaces (${expiredCount} utløpt fra snapshot)`,
  });
  return { sourceItemCount: allAlerts.length, parseFailures: failures.length };
}

const trafikkdataPollIntervalMs = 15 * 60 * 1000;
const trafikkdataLastSuccessfulPollStateKey = "trafikkdata:lastSuccessfulPollAt";

type TrafikkdataRepository = Pick<
  WorkerRepository,
  "collectorState" | "setCollectorState" | "setHealth" | "upsertTrafficCounterSnapshots"
>;

type TrafikkdataCollector = typeof fetchTrafikkdataCounterSnapshots;

export async function collectTrafikkdataCounters({
  repository,
  endpoint = defaultTrafikkdataGraphqlEndpoint,
  nextPollAt,
  now = () => new Date(),
  fetcher = fetch,
  collector = fetchTrafikkdataCounterSnapshots,
}: {
  repository: TrafikkdataRepository;
  endpoint?: string;
  nextPollAt: string;
  now?: () => Date;
  fetcher?: typeof fetch;
  collector?: TrafikkdataCollector;
}): Promise<{ skipped: boolean } & WorkerCollectorTelemetry> {
  const checkedAtDate = now();
  const checkedAt = checkedAtDate.toISOString();
  const lastSuccessfulPollAt = await repository.collectorState(
    trafikkdataLastSuccessfulPollStateKey,
  );
  const lastSuccessfulPollMs = lastSuccessfulPollAt ? Date.parse(lastSuccessfulPollAt) : Number.NaN;
  if (Number.isFinite(lastSuccessfulPollMs)) {
    const elapsedMs = checkedAtDate.getTime() - lastSuccessfulPollMs;
    if (elapsedMs >= 0 && elapsedMs < trafikkdataPollIntervalMs) {
      const earliestNextPollAt = new Date(
        lastSuccessfulPollMs + trafikkdataPollIntervalMs,
      ).toISOString();
      await repository.setHealth({
        source: "trafikkdata",
        label: "Vegvesen Trafikkdata",
        state: "ok",
        lastCheckedAt: checkedAt,
        nextPollAt: earliestNextPollAt,
        detail: `Trafikkdata-poll hoppet over fordi siste vellykkede poll var ${lastSuccessfulPollAt}. Neste poll tidligst ${earliestNextPollAt}`,
      });
      return { skipped: true, sourceItemCount: 0, parseFailures: 0 };
    }
  }

  try {
    const counters = await collector({ endpoint, fetcher, now });
    await repository.upsertTrafficCounterSnapshots(counters);
    const volumeCount = counters.filter(
      (counter: TrafficCounterSnapshot) => typeof counter.volumeLastHour === "number",
    ).length;
    await repository.setCollectorState(trafikkdataLastSuccessfulPollStateKey, checkedAt);
    await repository.setHealth({
      source: "trafikkdata",
      label: "Vegvesen Trafikkdata",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${counters.length} Trafikkdata tellepunkter oppdatert (${volumeCount} med timesvolum). Neste poll tidligst ${nextPollAt}`,
    });
    return { skipped: false, sourceItemCount: counters.length, parseFailures: 0 };
  } catch (error) {
    const failureAt = now().toISOString();
    await repository.setHealth({
      source: "trafikkdata",
      label: "Vegvesen Trafikkdata",
      state: "degraded",
      lastCheckedAt: failureAt,
      lastFailureAt: failureAt,
      nextPollAt,
      detail: `Trafikkdata-innhenting feilet: ${String(error)}`,
    });
    return { skipped: false, sourceItemCount: 0, parseFailures: 1 };
  }
}

type RoadContextRepository = Pick<
  WorkerRepository,
  "setHealth" | "upsertRoadWeatherObservations" | "upsertRoadCameras"
>;

type RoadWeatherParser = typeof parseDatexRoadWeather;
type CctvParser = typeof parseDatexCctv;

async function fetchDatexText(
  endpoint: string,
  username: string,
  password: string,
  fetcher: typeof fetch,
  envName = "DATEX_ENDPOINT",
): Promise<string> {
  const normalizedEndpoint = normalizeDatexCredentialedEndpoint(endpoint, envName);
  const response = await fetchWithSourcePolicy(fetcher, normalizedEndpoint, {
    headers: {
      "User-Agent": sourceUserAgent,
      Authorization: datexBasicAuthHeader(username, password),
    },
  });
  if (!response.ok)
    throw new Error(`DATEX returned HTTP ${response.status} for ${normalizedEndpoint}`);
  return response.text();
}

function normalizedDatexCredentials(username?: string, password?: string) {
  const normalizedUsername = username?.trim();
  const normalizedPassword = password?.trim();
  if (!normalizedUsername || !normalizedPassword) return undefined;
  return { username: normalizedUsername, password: normalizedPassword };
}

export async function collectDatexRoadWeatherContext({
  repository,
  sitesEndpoint,
  measurementsEndpoint,
  username,
  password,
  nextPollAt,
  now = () => new Date(),
  fetcher = fetch,
  parser = parseDatexRoadWeather,
}: {
  repository: RoadContextRepository;
  sitesEndpoint: string;
  measurementsEndpoint: string;
  username?: string;
  password?: string;
  nextPollAt: string;
  now?: () => Date;
  fetcher?: typeof fetch;
  parser?: RoadWeatherParser;
}): Promise<WorkerCollectorTelemetry> {
  const checkedAt = now().toISOString();
  const credentials = normalizedDatexCredentials(username, password);
  if (!credentials) {
    await repository.setHealth({
      source: "datex_weather",
      label: "Vegvesen værstasjoner",
      state: "awaiting_access",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: "DATEX Basic Auth mangler for værstasjonsdata",
    });
    return { sourceItemCount: 0, parseFailures: 0 };
  }

  try {
    const [siteXml, measurementXml] = await Promise.all([
      fetchDatexText(
        sitesEndpoint,
        credentials.username,
        credentials.password,
        fetcher,
        "DATEX_WEATHER_SITES_ENDPOINT",
      ),
      fetchDatexText(
        measurementsEndpoint,
        credentials.username,
        credentials.password,
        fetcher,
        "DATEX_WEATHER_MEASUREMENTS_ENDPOINT",
      ),
    ]);
    const observations = parser(siteXml, measurementXml, { receivedAt: checkedAt });
    await repository.upsertRoadWeatherObservations(observations);
    await repository.setHealth({
      source: "datex_weather",
      label: "Vegvesen værstasjoner",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${observations.length} DATEX værstasjonsobservasjoner oppdatert`,
    });
    return { sourceItemCount: observations.length, parseFailures: 0 };
  } catch (error) {
    const failureAt = now().toISOString();
    await repository.setHealth({
      source: "datex_weather",
      label: "Vegvesen værstasjoner",
      state: "degraded",
      lastCheckedAt: failureAt,
      lastFailureAt: failureAt,
      nextPollAt,
      detail: `DATEX værstasjonsinnhenting feilet: ${String(error)}`,
    });
    return { sourceItemCount: 0, parseFailures: 1 };
  }
}

export async function collectDatexCctvContext({
  repository,
  sitesEndpoint,
  statusEndpoint,
  username,
  password,
  nextPollAt,
  now = () => new Date(),
  fetcher = fetch,
  parser = parseDatexCctv,
}: {
  repository: RoadContextRepository;
  sitesEndpoint: string;
  statusEndpoint: string;
  username?: string;
  password?: string;
  nextPollAt: string;
  now?: () => Date;
  fetcher?: typeof fetch;
  parser?: CctvParser;
}): Promise<WorkerCollectorTelemetry> {
  const checkedAt = now().toISOString();
  const credentials = normalizedDatexCredentials(username, password);
  if (!credentials) {
    await repository.setHealth({
      source: "datex_cctv",
      label: "Vegvesen webkamera",
      state: "awaiting_access",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: "DATEX Basic Auth mangler for webkameradata",
    });
    return { sourceItemCount: 0, parseFailures: 0 };
  }

  try {
    const [siteXml, statusXml] = await Promise.all([
      fetchDatexText(
        sitesEndpoint,
        credentials.username,
        credentials.password,
        fetcher,
        "DATEX_CCTV_SITES_ENDPOINT",
      ),
      fetchDatexText(
        statusEndpoint,
        credentials.username,
        credentials.password,
        fetcher,
        "DATEX_CCTV_STATUS_ENDPOINT",
      ),
    ]);
    const cameras = parser(siteXml, statusXml, { receivedAt: checkedAt });
    await repository.upsertRoadCameras(cameras);
    await repository.setHealth({
      source: "datex_cctv",
      label: "Vegvesen webkamera",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${cameras.length} DATEX webkamera oppdatert`,
    });
    return { sourceItemCount: cameras.length, parseFailures: 0 };
  } catch (error) {
    const failureAt = now().toISOString();
    await repository.setHealth({
      source: "datex_cctv",
      label: "Vegvesen webkamera",
      state: "degraded",
      lastCheckedAt: failureAt,
      lastFailureAt: failureAt,
      nextPollAt,
      detail: `DATEX webkamerainnhenting feilet: ${String(error)}`,
    });
    return { sourceItemCount: 0, parseFailures: 1 };
  }
}

export async function collectBaneNorRailContext({
  repository,
  nextPollAt,
  now = () => new Date(),
  collector = fetchBaneNorRailMessages,
}: {
  repository: Pick<WorkerRepository, "upsertBaneNorSourceItems" | "setHealth">;
  nextPollAt: string;
  now?: () => Date;
  collector?: typeof fetchBaneNorRailMessages;
}): Promise<WorkerCollectorTelemetry> {
  const checkedAt = now().toISOString();
  try {
    const result = await collector({ receivedAt: checkedAt });
    const items = result.messages.map((message) =>
      baneNorSourceItemInput(message, {
        fetchedAt: checkedAt,
        rawItem: result.rawItemsByGuid.get(message.guid) ?? message,
      }),
    );
    await repository.upsertBaneNorSourceItems(items);
    await repository.setHealth({
      source: "bane_nor",
      label: "Bane NOR trafikkmeldinger",
      state: "ok",
      lastCheckedAt: checkedAt,
      nextPollAt,
      detail: `${items.length} relevante Bane NOR trafikkmeldinger hentet`,
    });
    return { sourceItemCount: items.length, parseFailures: 0 };
  } catch (error) {
    const failedAt = now().toISOString();
    await repository.setHealth({
      source: "bane_nor",
      label: "Bane NOR trafikkmeldinger",
      state: "degraded",
      lastCheckedAt: failedAt,
      lastFailureAt: failedAt,
      nextPollAt,
      detail: `Bane NOR RSS feilet: ${String(error)}`,
    });
    return { sourceItemCount: 0, parseFailures: 1 };
  }
}

async function collectAll({ repository, analyzer, once }: CollectionContext): Promise<void> {
  const cycleStartedAt = new Date();
  const sourceMetrics: WorkerSourceMetricInput[] = [];
  const recordSourceMetric = (
    source: string,
    startedAtMs: number,
    values: WorkerCollectorTelemetry = {},
  ) => {
    sourceMetrics.push({
      source,
      startedAtMs,
      completedAtMs: Date.now(),
      ...values,
    });
  };
  console.log(`[worker] collection started ${cycleStartedAt.toISOString()}`);
  const nextPollAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const articleSets = await Promise.all(
    rssSources.map(async (source) => {
      const sourceStartedAtMs = Date.now();
      try {
        const articles = await collectRss(source);
        recordSourceMetric(source.id, sourceStartedAtMs, { sourceItemCount: articles.length });
        await repository.setHealth({
          source: source.id,
          label: source.label,
          state: "ok",
          lastCheckedAt: new Date().toISOString(),
          nextPollAt,
          detail: `${articles.length} relevante saker hentet via ${
            source.format === "atom" ? "Atom" : "RSS"
          }`,
        });
        return articles;
      } catch (error) {
        recordSourceMetric(source.id, sourceStartedAtMs, { parseFailures: 1 });
        await repository.setHealth({
          source: source.id,
          label: source.label,
          state: "degraded",
          lastCheckedAt: new Date().toISOString(),
          lastFailureAt: new Date().toISOString(),
          nextPollAt,
          detail: String(error),
        });
        return [];
      }
    }),
  );
  articleSets.push(
    ...(await Promise.all(
      frontpageSources.map(async (source) => {
        const sourceStartedAtMs = Date.now();
        try {
          const articles = await collectFrontpage(source);
          recordSourceMetric(source.id, sourceStartedAtMs, { sourceItemCount: articles.length });
          await repository.setHealth({
            source: source.id,
            label: source.label,
            state: "ok",
            lastCheckedAt: new Date().toISOString(),
            nextPollAt,
            detail: `${articles.length} relevante saker hentet fra offentlig forside`,
          });
          return articles;
        } catch (error) {
          recordSourceMetric(source.id, sourceStartedAtMs, { parseFailures: 1 });
          await repository.setHealth({
            source: source.id,
            label: source.label,
            state: "degraded",
            lastCheckedAt: new Date().toISOString(),
            lastFailureAt: new Date().toISOString(),
            nextPollAt,
            detail: String(error),
          });
          return [];
        }
      }),
    )),
  );
  const articlesWithoutGeocoding: Article[] = [];
  if (once || Date.now() - lastMunicipalityCollection >= municipalityIntervalMs) {
    lastMunicipalityCollection = Date.now();
    const sourceStartedAtMs = Date.now();
    try {
      const articles = await collectMunicipality();
      recordSourceMetric("trondheim_kommune", sourceStartedAtMs, {
        sourceItemCount: articles.length,
      });
      articleSets.push(articles);
      await repository.setHealth({
        source: "trondheim_kommune",
        label: "Trondheim kommune",
        state: "ok",
        lastCheckedAt: new Date().toISOString(),
        nextPollAt: new Date(Date.now() + municipalityIntervalMs).toISOString(),
        detail: `${articles.length} kommunale oppslag hentet`,
      });
    } catch (error) {
      recordSourceMetric("trondheim_kommune", sourceStartedAtMs, { parseFailures: 1 });
      await repository.setHealth({
        source: "trondheim_kommune",
        label: "Trondheim kommune",
        state: "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        nextPollAt: new Date(Date.now() + municipalityIntervalMs).toISOString(),
        detail: String(error),
      });
    }
  }
  let politiloggenThreads: PolitiloggenThread[] = [];
  if (isPolitiloggenEnabled()) {
    const sourceStartedAtMs = Date.now();
    try {
      const collection = await collectPolitiloggen();
      recordSourceMetric("politiloggen", sourceStartedAtMs, {
        sourceItemCount: collection.articles.length,
      });
      politiloggenThreads = collection.threads;
      const activeThreadIds = new Set(
        collection.threads
          .filter((thread) => thread.isActive && thread.id)
          .map((thread) => `politiloggen-${thread.id}`),
      );
      articleSets.push(collection.articles.filter((article) => activeThreadIds.has(article.id)));
      articlesWithoutGeocoding.push(
        ...collection.articles.filter((article) => !activeThreadIds.has(article.id)),
      );
      await repository.setHealth({
        source: "politiloggen",
        label: "Politiloggen",
        state: "ok",
        lastCheckedAt: new Date().toISOString(),
        nextPollAt,
        detail: `${collection.threads.length} Trondheim-tråder hentet fra Politiloggen API`,
      });
    } catch (error) {
      recordSourceMetric("politiloggen", sourceStartedAtMs, { parseFailures: 1 });
      await repository.setHealth({
        source: "politiloggen",
        label: "Politiloggen",
        state: "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        nextPollAt,
        detail: `Politiloggen API feilet: ${String(error)}`,
      });
    }
  } else {
    await repository.setHealth({
      source: "politiloggen",
      label: "Politiloggen",
      state: "disabled",
      lastCheckedAt: new Date().toISOString(),
      nextPollAt,
      detail: "Politiloggen-adapter er slått av med POLITILOGGEN_ENABLED=false",
    });
  }
  const coverageGeneratedAt = new Date().toISOString();
  const coverageAnalysis = await prepareArticleCoverageAnalysis({
    articlesForGeocoding: articleSets.flat(),
    articlesWithoutGeocoding,
    generatedAt: coverageGeneratedAt,
  });
  await repository.upsertArticles(coverageAnalysis.articles);
  await repository.upsertCoverageBundles(coverageAnalysis.bundles, coverageGeneratedAt);
  for (const status of await probeOfficialSources()) {
    if (status.source === "politiloggen") continue;
    await repository.setHealth({ ...status, lastCheckedAt: new Date().toISOString(), nextPollAt });
  }
  const trafficInfoStartedAtMs = Date.now();
  const trafficInfoMetrics = await collectTrafficInfoForMap({
    repository,
    endpoint: process.env.TRAFFIC_INFO_ENDPOINT?.trim() || defaultTrafficInfoEndpoint,
    nextPollAt,
  });
  recordSourceMetric("vegvesen_traffic_info", trafficInfoStartedAtMs, trafficInfoMetrics);
  const trafikkdataStartedAtMs = Date.now();
  const trafikkdataResult = await collectTrafikkdataCounters({
    repository,
    endpoint: process.env.TRAFIKKDATA_GRAPHQL_ENDPOINT?.trim() || defaultTrafikkdataGraphqlEndpoint,
    nextPollAt: new Date(Date.now() + trafikkdataPollIntervalMs).toISOString(),
  });
  recordSourceMetric("trafikkdata", trafikkdataStartedAtMs, trafikkdataResult);
  const enturServiceAlertsStartedAtMs = Date.now();
  const enturServiceAlertMetrics = await collectEnturServiceAlerts({
    repository,
    clientName: process.env.ENTUR_CLIENT_NAME?.trim() || "reidar-nytt-trondheim",
    codespaceIds: enturCodespacesFromEnv(process.env.ENTUR_CODESPACES),
    nextPollAt,
  });
  recordSourceMetric(
    "entur_service_alerts",
    enturServiceAlertsStartedAtMs,
    enturServiceAlertMetrics,
  );
  const baneNorStartedAtMs = Date.now();
  const baneNorMetrics = await collectBaneNorRailContext({ repository, nextPollAt });
  recordSourceMetric("bane_nor", baneNorStartedAtMs, baneNorMetrics);
  const officialEvents: OfficialEvent[] = [];
  for (const [source, collector] of [
    ["met", () => collectMetWarnings(fetch)],
    ["nve", collectNveWarnings],
  ] as const) {
    const sourceStartedAtMs = Date.now();
    try {
      const warnings = await collector();
      officialEvents.push(...warnings);
      recordSourceMetric(source, sourceStartedAtMs, { sourceItemCount: warnings.length });
    } catch (error) {
      recordSourceMetric(source, sourceStartedAtMs, { parseFailures: 1 });
      await repository.setHealth({
        source,
        label: source === "met" ? "MET farevarsel" : "NVE Varsom",
        state: "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        nextPollAt,
        detail: `Varselinnhenting feilet: ${String(error)}`,
      });
    }
  }
  const datexUsername = process.env.DATEX_USERNAME?.trim();
  const datexPassword = process.env.DATEX_PASSWORD;
  const datexTravelTimeLocationsEndpoint =
    process.env.DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT?.trim() ||
    defaultDatexTravelTimeLocationsEndpoint;
  const datexTravelTimeDataEndpoint =
    process.env.DATEX_TRAVEL_TIME_DATA_ENDPOINT?.trim() || defaultDatexTravelTimeDataEndpoint;
  const datexWeatherSitesEndpoint =
    process.env.DATEX_WEATHER_SITES_ENDPOINT?.trim() || defaultDatexWeatherSitesEndpoint;
  const datexWeatherMeasurementsEndpoint =
    process.env.DATEX_WEATHER_MEASUREMENTS_ENDPOINT?.trim() ||
    defaultDatexWeatherMeasurementsEndpoint;
  const datexCctvSitesEndpoint =
    process.env.DATEX_CCTV_SITES_ENDPOINT?.trim() || defaultDatexCctvSitesEndpoint;
  const datexCctvStatusEndpoint =
    process.env.DATEX_CCTV_STATUS_ENDPOINT?.trim() || defaultDatexCctvStatusEndpoint;
  let freshDatexSnapshotEventIds: string[] | undefined;
  let pendingDatexLastModified: string | undefined;

  if (datexUsername && datexPassword) {
    const datexStartedAtMs = Date.now();
    try {
      const datexEndpoint = normalizeDatexSituationEndpoint(
        process.env.DATEX_ENDPOINT?.trim() || defaultDatexSituationEndpoint,
      );
      const lastModified = await repository.collectorState("datex:lastModified");
      const result = await collectDatexSituationEvents({
        endpoint: datexEndpoint,
        username: datexUsername,
        password: datexPassword,
        lastModified,
      });
      officialEvents.push(...result.events);
      if (!result.notModified) {
        freshDatexSnapshotEventIds = result.events.map((event) => event.id);
        pendingDatexLastModified = result.lastModified;
      }
      recordSourceMetric("datex", datexStartedAtMs, { sourceItemCount: result.events.length });
      await repository.setHealth({
        source: "datex",
        label: "Vegvesen DATEX",
        state: "ok",
        lastCheckedAt: new Date().toISOString(),
        nextPollAt,
        detail: result.notModified
          ? "Ingen endringer siden forrige DATEX-snapshot"
          : `${result.events.length} relevante DATEX trafikkhendelser hentet`,
      });
    } catch (error) {
      recordSourceMetric("datex", datexStartedAtMs, { parseFailures: 1 });
      await repository.setHealth({
        source: "datex",
        label: "Vegvesen DATEX",
        state: "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        nextPollAt,
        detail: `DATEX-innhenting feilet: ${String(error)}`,
      });
    }

    const datexTravelTimeStartedAtMs = Date.now();
    try {
      const result = await collectDatexTravelTimePulse({
        locationsEndpoint: datexTravelTimeLocationsEndpoint,
        dataEndpoint: datexTravelTimeDataEndpoint,
        username: datexUsername,
        password: datexPassword,
      });
      await repository.upsertDatexTravelTimes(result.corridors);
      await repository.markMissingDatexTravelTimesStale(
        result.corridors.map((corridor) => corridor.id),
      );
      recordSourceMetric("datex_travel_time", datexTravelTimeStartedAtMs, {
        sourceItemCount: result.corridors.length,
      });
      await repository.setHealth({
        source: "datex_travel_time",
        label: "Vegvesen reisetid",
        state: "ok",
        lastCheckedAt: new Date().toISOString(),
        nextPollAt,
        detail: `${result.corridors.length} DATEX reisetidskorridorer oppdatert`,
      });
    } catch (error) {
      recordSourceMetric("datex_travel_time", datexTravelTimeStartedAtMs, { parseFailures: 1 });
      await repository.setHealth({
        source: "datex_travel_time",
        label: "Vegvesen reisetid",
        state: "degraded",
        lastCheckedAt: new Date().toISOString(),
        lastFailureAt: new Date().toISOString(),
        nextPollAt,
        detail: `DATEX reisetidsinnhenting feilet: ${String(error)}`,
      });
    }
  } else {
    await repository.setHealth({
      source: "datex_travel_time",
      label: "Vegvesen reisetid",
      state: "awaiting_access",
      lastCheckedAt: new Date().toISOString(),
      nextPollAt,
      detail: "DATEX Basic Auth mangler for reisetidsdata",
    });
  }
  const datexWeatherStartedAtMs = Date.now();
  const datexWeatherMetrics = await collectDatexRoadWeatherContext({
    repository,
    sitesEndpoint: datexWeatherSitesEndpoint,
    measurementsEndpoint: datexWeatherMeasurementsEndpoint,
    username: datexUsername,
    password: datexPassword,
    nextPollAt,
  });
  recordSourceMetric("datex_weather", datexWeatherStartedAtMs, datexWeatherMetrics);
  const datexCctvStartedAtMs = Date.now();
  const datexCctvMetrics = await collectDatexCctvContext({
    repository,
    sitesEndpoint: datexCctvSitesEndpoint,
    statusEndpoint: datexCctvStatusEndpoint,
    username: datexUsername,
    password: datexPassword,
    nextPollAt,
  });
  recordSourceMetric("datex_cctv", datexCctvStartedAtMs, datexCctvMetrics);
  await repository.upsertOfficialEvents(officialEvents);
  if (freshDatexSnapshotEventIds) {
    await repository.expireMissingOfficialEvents("datex", freshDatexSnapshotEventIds);
  }
  if (pendingDatexLastModified) {
    await repository.setCollectorState("datex:lastModified", pendingDatexLastModified);
  }
  const recentArticles = await repository.recentArticles(12);
  const situationUpdateArticles = await repository.recentArticles(72);
  const officialTrafficArticleCandidates = await repository.recentArticles(24 * 180);
  const currentOfficialEvents = await repository.currentOfficialEvents();
  const currentWarnings = currentOfficialEvents.filter(
    (event) => event.source === "met" || event.source === "nve",
  );
  const currentDatexEvents = currentOfficialEvents.filter((event) => event.source === "datex");
  const trackedSituations = await repository.trackedSituations();
  const aiStartedAtMs = Date.now();
  const analysis = await analyzer.cluster(recentArticles, { situations: trackedSituations });
  recordSourceMetric("deepseek", aiStartedAtMs, {
    parseFailures: analysis.run.status === "degraded" ? 1 : 0,
  });
  await repository.saveAiRun(analysis.run);
  await repository.setHealth({
    source: "deepseek",
    label: "AI-analyse",
    state: analysis.run.status === "disabled" ? "disabled" : analysis.run.status,
    lastCheckedAt: analysis.run.completedAt,
    lastFailureAt: analysis.run.status === "degraded" ? analysis.run.completedAt : undefined,
    nextPollAt,
    detail:
      analysis.run.status === "ok"
        ? [
            `${analysis.result.clusters.length} validerte kandidatgrupper`,
            `${analysis.result.situationUpdates.length} mulige situasjonsoppdateringer`,
            `${analysis.result.bundleHints.length} bunthint`,
            `${analysis.result.categoryHints.length} kategorihint`,
            `${analysis.result.relevanceHints.length} relevanshint`,
          ].join(", ")
        : analysis.run.status === "disabled"
          ? "DEEPSEEK_API_KEY er ikke konfigurert"
          : (analysis.run.error ?? "AI-analyse feilet"),
  });
  const aiSituationUpdates = applySituationUpdateHints(
    trackedSituations,
    analysis.result,
    recentArticles,
    analysis.run.completedAt,
  );
  const deterministicSituations = enhanceSituations(
    detectPreliminarySituations(situationUpdateArticles, currentWarnings, trackedSituations),
    analysis.result,
    recentArticles,
  );
  const officialTrafficSituations = officialTrafficSituationsFromEvents(
    currentDatexEvents,
    trackedSituations,
    officialTrafficArticleCandidates,
  );
  const politiloggenSituations = politiloggenSituationsFromThreads(
    politiloggenThreads,
    trackedSituations,
    coverageAnalysis.articles,
  );
  const activeDatexEventIds = new Set(currentDatexEvents.map((event) => event.id));
  const activePromotableDatexEventIds = promotableDatexEventIds(currentDatexEvents);
  const activeDatexSituationIds = new Set(
    officialTrafficSituations.map((situation) => situation.id),
  );
  const resolvedDuplicateDatexSituations = resolvedDuplicateOfficialTrafficSituationsForMergedDatex(
    trackedSituations,
    activePromotableDatexEventIds,
    activeDatexSituationIds,
    new Date().toISOString(),
  );
  const resolvedNonPromotableDatexSituations = resolvedNonPromotableOfficialTrafficSituations(
    trackedSituations,
    activeDatexEventIds,
    activePromotableDatexEventIds,
    activeDatexSituationIds,
    new Date().toISOString(),
  );
  const resolvedDatexSituations = shouldResolveMissingDatexSituations(
    freshDatexSnapshotEventIds !== undefined,
  )
    ? resolvedOfficialTrafficSituationsForMissingDatex(
        trackedSituations,
        activeDatexEventIds,
        new Date().toISOString(),
      )
    : [];
  const situationsToPersist = [
    ...deterministicSituations,
    ...aiSituationUpdates,
    ...officialTrafficSituations,
    ...politiloggenSituations,
    ...resolvedDuplicateDatexSituations,
    ...resolvedNonPromotableDatexSituations,
    ...resolvedDatexSituations,
  ];
  await Promise.all(situationsToPersist.map((situation) => repository.upsertSituation(situation)));
  console.log(
    `[worker] stored ${coverageAnalysis.articles.length} articles and ${coverageAnalysis.bundles.length} coverage bundles; persisted ${situationsToPersist.length} situations (${officialTrafficSituations.length} from DATEX, ${politiloggenSituations.length} from Politiloggen, ${aiSituationUpdates.length} from AI update hints); AI identified ${analysis.result.clusters.length} validated candidates and ${analysis.result.bundleHints.length} bundle hints`,
  );
  const workerMetrics = buildWorkerCycleMetrics({
    cycleStartedAt,
    cycleCompletedAt: new Date(),
    sources: sourceMetrics,
  });
  try {
    await Promise.all(
      sourceMetrics.map((metric) => repository.recordCollectorRun(collectorRunFromMetric(metric))),
    );
    await repository.saveWorkerCycleMetrics(workerMetrics);
  } catch (error) {
    console.warn(`[worker] could not persist worker cycle metrics: ${String(error)}`);
  }
}

export async function runWorker(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the collection worker.");

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const repository = new WorkerRepository(pool);
  const analyzer = createAnalyzer();
  const once = process.argv.includes("--once");
  const guardedCollectAll = createCollectionGuard(() => collectAll({ repository, analyzer, once }));
  const enturClientName = process.env.ENTUR_CLIENT_NAME?.trim() || "reidar-nytt-trondheim";
  const enturCodespaceIds = enturCodespacesFromEnv(process.env.ENTUR_CODESPACES);
  const enturVehicleBounds = enturBoundsFromEnv(process.env.ENTUR_VEHICLE_BOUNDS);
  const enturVehicleIntervalMs = 60 * 1000;
  const guardedEnturVehicles = createCollectionGuard(
    async () => {
      const startedAtMs = Date.now();
      const telemetry = await collectEnturVehiclesForMapCodespaces({
        repository,
        clientName: enturClientName,
        codespaceIds: enturCodespaceIds,
        bounds: enturVehicleBounds,
        nextPollAt: new Date(Date.now() + enturVehicleIntervalMs).toISOString(),
      });
      const completedAtMs = Date.now();
      try {
        await repository.recordCollectorRun(
          collectorRunFromMetric({
            source: "entur_vehicle_positions",
            startedAtMs,
            completedAtMs,
            ...telemetry,
          }),
        );
      } catch (error) {
        console.warn(`[worker] could not persist Entur vehicle collector run: ${String(error)}`);
      }
    },
    () => console.warn("[worker] skipping Entur vehicle tick; previous cycle still running"),
  );

  try {
    await guardedEnturVehicles();
    await guardedCollectAll();
    if (!once) {
      setInterval(() => void guardedEnturVehicles().catch(console.error), enturVehicleIntervalMs);
      setInterval(() => void guardedCollectAll().catch(console.error), 10 * 60 * 1000);
      process.on("SIGTERM", async () => {
        await pool.end();
        process.exit(0);
      });
    }
  } finally {
    if (once) await pool.end();
  }
}

function isDirectRun(): boolean {
  return (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isDirectRun()) await runWorker();
