import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { OfficialEvent, TrafficCounterSnapshot } from "@nytt/shared";
import {
  collectMunicipality,
  collectPolitiloggenPersonalUse,
  collectRss,
  probeOfficialSources,
  rssSources,
} from "./collectors.js";
import { createAnalyzer, enhanceSituations } from "./ai.js";
import {
  collectDatexTravelTimePulse,
  defaultDatexTravelTimeDataEndpoint,
  defaultDatexTravelTimeLocationsEndpoint,
} from "./datexTravelTime.js";
import {
  detectPreliminarySituations,
  officialTrafficSituationsFromEvents,
  resolvedOfficialTrafficSituationsForMissingDatex,
} from "./clusters.js";
import {
  collectDatexSituationEvents,
  datexBasicAuthHeader,
  defaultDatexSituationEndpoint,
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
import { geocodeArticles } from "./geocode.js";
import { collectMetWarnings, collectNveWarnings } from "./official.js";
import { WorkerRepository } from "./repository.js";
import {
  collectTrafficInfoMessages,
  defaultTrafficInfoEndpoint,
  trafficInfoSourceItemInput,
} from "./vegvesenTrafficInfo.js";

const municipalityIntervalMs = 60 * 60 * 1000;
let lastMunicipalityCollection = 0;

export { normalizeDatexSituationEndpoint };

interface CollectionContext {
  repository: WorkerRepository;
  analyzer: ReturnType<typeof createAnalyzer>;
  once: boolean;
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
}): Promise<void> {
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
  }
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
}): Promise<{ skipped: boolean }> {
  const checkedAtDate = now();
  const checkedAt = checkedAtDate.toISOString();
  const lastSuccessfulPollAt = await repository.collectorState(
    trafikkdataLastSuccessfulPollStateKey,
  );
  const lastSuccessfulPollMs = lastSuccessfulPollAt ? Date.parse(lastSuccessfulPollAt) : Number.NaN;
  if (Number.isFinite(lastSuccessfulPollMs)) {
    const elapsedMs = checkedAtDate.getTime() - lastSuccessfulPollMs;
    if (elapsedMs >= 0 && elapsedMs < trafikkdataPollIntervalMs) return { skipped: true };
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
    return { skipped: false };
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
    return { skipped: false };
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
): Promise<string> {
  const response = await fetcher(endpoint, {
    headers: {
      "User-Agent": "NyttTrondheim/0.1 kontakt@reidar.tech",
      Authorization: datexBasicAuthHeader(username, password),
    },
  });
  if (!response.ok) throw new Error(`DATEX returned HTTP ${response.status} for ${endpoint}`);
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
}): Promise<void> {
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
    return;
  }

  try {
    const [siteXml, measurementXml] = await Promise.all([
      fetchDatexText(sitesEndpoint, credentials.username, credentials.password, fetcher),
      fetchDatexText(measurementsEndpoint, credentials.username, credentials.password, fetcher),
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
}): Promise<void> {
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
    return;
  }

  try {
    const [siteXml, statusXml] = await Promise.all([
      fetchDatexText(sitesEndpoint, credentials.username, credentials.password, fetcher),
      fetchDatexText(statusEndpoint, credentials.username, credentials.password, fetcher),
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
  }
}

async function collectAll({ repository, analyzer, once }: CollectionContext): Promise<void> {
  console.log(`[worker] collection started ${new Date().toISOString()}`);
  const nextPollAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const articleSets = await Promise.all(
    rssSources.map(async (source) => {
      try {
        const articles = await collectRss(source);
        await repository.setHealth({
          source: source.id,
          label: source.label,
          state: "ok",
          lastCheckedAt: new Date().toISOString(),
          nextPollAt,
          detail: `${articles.length} relevante saker hentet via RSS`,
        });
        return articles;
      } catch (error) {
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
  if (once || Date.now() - lastMunicipalityCollection >= municipalityIntervalMs) {
    lastMunicipalityCollection = Date.now();
    try {
      const articles = await collectMunicipality();
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
  const articles = await geocodeArticles(articleSets.flat());
  await repository.upsertArticles(articles);
  for (const status of await probeOfficialSources()) {
    await repository.setHealth({ ...status, lastCheckedAt: new Date().toISOString(), nextPollAt });
  }
  if (process.env.POLITILOGGEN_ENABLED === "true") {
    await collectPolitiloggenPersonalUse().catch((error) =>
      console.warn(`[worker] Politiloggen adapter failed: ${String(error)}`),
    );
  }
  await collectTrafficInfoForMap({
    repository,
    endpoint: process.env.TRAFFIC_INFO_ENDPOINT?.trim() || defaultTrafficInfoEndpoint,
    nextPollAt,
  });
  await collectTrafikkdataCounters({
    repository,
    endpoint: process.env.TRAFIKKDATA_GRAPHQL_ENDPOINT?.trim() || defaultTrafikkdataGraphqlEndpoint,
    nextPollAt: new Date(Date.now() + trafikkdataPollIntervalMs).toISOString(),
  });
  const officialEvents: OfficialEvent[] = [];
  for (const [source, collector] of [
    ["met", () => collectMetWarnings(fetch)],
    ["nve", collectNveWarnings],
  ] as const) {
    try {
      officialEvents.push(...(await collector()));
    } catch (error) {
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
      await repository.setHealth({
        source: "datex_travel_time",
        label: "Vegvesen reisetid",
        state: "ok",
        lastCheckedAt: new Date().toISOString(),
        nextPollAt,
        detail: `${result.corridors.length} DATEX reisetidskorridorer oppdatert`,
      });
    } catch (error) {
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
  await collectDatexRoadWeatherContext({
    repository,
    sitesEndpoint: datexWeatherSitesEndpoint,
    measurementsEndpoint: datexWeatherMeasurementsEndpoint,
    username: datexUsername,
    password: datexPassword,
    nextPollAt,
  });
  await collectDatexCctvContext({
    repository,
    sitesEndpoint: datexCctvSitesEndpoint,
    statusEndpoint: datexCctvStatusEndpoint,
    username: datexUsername,
    password: datexPassword,
    nextPollAt,
  });
  await repository.upsertOfficialEvents(officialEvents);
  if (freshDatexSnapshotEventIds) {
    await repository.expireMissingOfficialEvents("datex", freshDatexSnapshotEventIds);
  }
  if (pendingDatexLastModified) {
    await repository.setCollectorState("datex:lastModified", pendingDatexLastModified);
  }
  const recentArticles = await repository.recentArticles(12);
  const situationUpdateArticles = await repository.recentArticles(72);
  const currentOfficialEvents = await repository.currentOfficialEvents();
  const currentWarnings = currentOfficialEvents.filter(
    (event) => event.source === "met" || event.source === "nve",
  );
  const currentDatexEvents = currentOfficialEvents.filter((event) => event.source === "datex");
  const analysis = await analyzer.cluster(recentArticles);
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
        ? `${analysis.result.clusters.length} validerte kandidatgrupper`
        : analysis.run.status === "disabled"
          ? "DEEPSEEK_API_KEY er ikke konfigurert"
          : (analysis.run.error ?? "AI-analyse feilet"),
  });
  const trackedSituations = await repository.trackedSituations();
  const deterministicSituations = enhanceSituations(
    detectPreliminarySituations(situationUpdateArticles, currentWarnings, trackedSituations),
    analysis.result,
    recentArticles,
  );
  const officialTrafficSituations = officialTrafficSituationsFromEvents(
    currentDatexEvents,
    trackedSituations,
  );
  const resolvedDatexSituations = shouldResolveMissingDatexSituations(
    freshDatexSnapshotEventIds !== undefined,
  )
    ? resolvedOfficialTrafficSituationsForMissingDatex(
        trackedSituations,
        new Set(currentDatexEvents.map((event) => event.id)),
        new Date().toISOString(),
      )
    : [];
  const situationsToPersist = [
    ...deterministicSituations,
    ...officialTrafficSituations,
    ...resolvedDatexSituations,
  ];
  await Promise.all(situationsToPersist.map((situation) => repository.upsertSituation(situation)));
  console.log(
    `[worker] stored ${articles.length} articles; persisted ${situationsToPersist.length} situations (${officialTrafficSituations.length} from DATEX); AI identified ${analysis.result.clusters.length} validated candidates`,
  );
}

export async function runWorker(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the collection worker.");

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const repository = new WorkerRepository(pool);
  const analyzer = createAnalyzer();
  const once = process.argv.includes("--once");
  const guardedCollectAll = createCollectionGuard(() => collectAll({ repository, analyzer, once }));

  try {
    await guardedCollectAll();
    if (!once) {
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
