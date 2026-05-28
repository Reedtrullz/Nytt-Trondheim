import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { OfficialEvent } from "@nytt/shared";
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
  defaultDatexSituationEndpoint,
  normalizeDatexSituationEndpoint,
} from "./datex.js";
import { geocodeArticles } from "./geocode.js";
import { collectMetWarnings, collectNveWarnings } from "./official.js";
import { WorkerRepository } from "./repository.js";

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
