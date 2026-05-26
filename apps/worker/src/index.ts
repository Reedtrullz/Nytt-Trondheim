import pg from "pg";
import {
  collectMunicipality,
  collectPolitiloggenPersonalUse,
  collectRss,
  probeOfficialSources,
  rssSources,
} from "./collectors.js";
import { createAnalyzer } from "./ai.js";
import { detectPreliminarySituations } from "./clusters.js";
import { geocodeArticles } from "./geocode.js";
import { WorkerRepository } from "./repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the collection worker.");

const pool = new pg.Pool({ connectionString: databaseUrl });
const repository = new WorkerRepository(pool);
const analyzer = createAnalyzer();
const once = process.argv.includes("--once");
const municipalityIntervalMs = 60 * 60 * 1000;
let lastMunicipalityCollection = 0;

async function collectAll(): Promise<void> {
  console.log(`[worker] collection started ${new Date().toISOString()}`);
  const articleSets = await Promise.all(
    rssSources.map(async (source) => {
      try {
        const articles = await collectRss(source);
        await repository.setHealth({
          source: source.id,
          label: source.label,
          state: "ok",
          lastCheckedAt: new Date().toISOString(),
          detail: `${articles.length} relevante saker hentet via RSS`,
        });
        return articles;
      } catch (error) {
        await repository.setHealth({
          source: source.id,
          label: source.label,
          state: "degraded",
          lastCheckedAt: new Date().toISOString(),
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
        detail: `${articles.length} kommunale oppslag hentet`,
      });
    } catch (error) {
      await repository.setHealth({
        source: "trondheim_kommune",
        label: "Trondheim kommune",
        state: "degraded",
        lastCheckedAt: new Date().toISOString(),
        detail: String(error),
      });
    }
  }
  const articles = await geocodeArticles(articleSets.flat());
  await repository.upsertArticles(articles);
  for (const status of await probeOfficialSources()) {
    await repository.setHealth({ ...status, lastCheckedAt: new Date().toISOString() });
  }
  if (process.env.POLITILOGGEN_ENABLED === "true") {
    await collectPolitiloggenPersonalUse().catch((error) =>
      console.warn(`[worker] Politiloggen adapter failed: ${String(error)}`),
    );
  }
  const analysis = await analyzer.cluster(articles);
  const deterministicSituations = detectPreliminarySituations(articles);
  await Promise.all(
    deterministicSituations.map((situation) => repository.upsertSituation(situation)),
  );
  console.log(
    `[worker] stored ${articles.length} articles; persisted ${deterministicSituations.length} multi-source situations; AI identified ${analysis.clusters.length} additional candidates`,
  );
}

await collectAll();
if (once) {
  await pool.end();
} else {
  setInterval(() => void collectAll().catch(console.error), 10 * 60 * 1000);
  process.on("SIGTERM", async () => {
    await pool.end();
    process.exit(0);
  });
}
