import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";
import { ZodError } from "zod";
import {
  articleQuerySchema,
  labelInputSchema,
  lifecycleInputSchema,
  noteInputSchema,
  privateMapFeatureInputSchema,
  publicTransportMapQuerySchema,
  sourceItemLinkInputSchema,
  sourceItemQuerySchema,
  situationQuerySchema,
  taskInputSchema,
  trafficMapQuerySchema,
  type MapFeature,
  type SourceHealth,
  type TrafficEventState,
  type TrafficMapEvent,
  type TrafficMapSourceStatus,
} from "@nytt/shared";
import type { AppConfig } from "./config.js";
import { configureAuth, csrfToken, currentLogin, requireCsrf, requireUser } from "./auth.js";
import { buildWorkspaceExport, safeFilename } from "./export.js";
import { MemoryStore, PgStore, type Store } from "./store.js";
import { buildCorridorImpacts } from "./traffic/corridor-impact.js";
import { officialEventToTrafficMapEvent } from "./traffic/datex-normalizer.js";
import { geometryIntersectsBounds } from "./traffic/geo.js";
import { relatedTrafficArticlesForEvent } from "./traffic/related-articles.js";
import { buildTrafficBrief } from "./traffic/traffic-brief.js";

const EXPORT_ATTACHMENT_COUNT_LIMIT = 25;
const EXPORT_ATTACHMENT_BYTE_LIMIT = 50 * 1024 * 1024;
const trafficMapSourceIds = [
  "datex",
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "vegvesen_traffic_info",
] as const;
const trafficMapSourceIdSet = new Set<string>(trafficMapSourceIds);
const publicTransportSourceIdSet = new Set<string>([
  "entur_vehicle_positions",
  "entur_service_alerts",
]);
const defaultPublicTransportBounds = { north: 63.55, south: 63.3, east: 10.65, west: 10.2 };

function trafficMapSourceStatuses(sourceHealth: SourceHealth[]): TrafficMapSourceStatus[] {
  return sourceHealth
    .filter((source): source is SourceHealth & { source: TrafficMapSourceStatus["source"] } =>
      trafficMapSourceIdSet.has(source.source),
    )
    .map((source) => ({
      source: source.source,
      label: source.label,
      state: source.state,
      detail: source.detail,
      ...(source.lastCheckedAt ? { lastCheckedAt: source.lastCheckedAt } : {}),
    }));
}

function attachmentSizeBytes(size: unknown): number {
  const bytes =
    typeof size === "number" ? size : typeof size === "string" ? Number(size) : Number.NaN;
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : Number.POSITIVE_INFINITY;
}

interface RateLimitRule {
  name: string;
  max: number;
  windowMs: number;
}

const rateLimitRules = {
  auth: { name: "auth", max: 20, windowMs: 15 * 60 * 1000 },
  api: { name: "api", max: 120, windowMs: 60 * 1000 },
  write: { name: "write", max: 20, windowMs: 60 * 1000 },
  export: { name: "export", max: 5, windowMs: 60 * 1000 },
  upload: { name: "upload", max: 10, windowMs: 60 * 1000 },
} satisfies Record<string, RateLimitRule>;

function selectRateLimitRule(req: express.Request): RateLimitRule | undefined {
  if (req.path.startsWith("/auth/")) return rateLimitRules.auth;
  if (!req.path.startsWith("/api/")) return undefined;
  if (req.path.includes("/attachments")) return rateLimitRules.upload;
  if (req.path.includes("/exports")) return rateLimitRules.export;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return rateLimitRules.write;
  return rateLimitRules.api;
}

function createRateLimiter(): express.RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const rule = selectRateLimitRule(req);
    if (!rule) {
      next();
      return;
    }

    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const key = `${rule.name}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    const current = buckets.get(key);
    const bucket =
      !current || current.resetAt <= now ? { count: 0, resetAt: now + rule.windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > rule.max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: "For mange forespørsler. Prøv igjen senere." });
      return;
    }

    next();
  };
}

function validationDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status =
    "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
  return typeof status === "number" ? status : undefined;
}

function eventIntersectsTimeRange(event: TrafficMapEvent, from?: string, to?: string): boolean {
  const fromMs = from ? Date.parse(from) : Number.NaN;
  const toMs = to ? Date.parse(to) : Number.NaN;
  const startMs = Date.parse(event.validFrom ?? event.updatedAt);
  const endMs = Date.parse(event.validTo ?? event.validFrom ?? event.updatedAt);

  if (Number.isFinite(fromMs) && Number.isFinite(endMs) && endMs < fromMs) return false;
  if (Number.isFinite(toMs) && Number.isFinite(startMs) && startMs > toMs) return false;
  return true;
}

function filterTrafficMapEvents(
  events: TrafficMapEvent[],
  query: ReturnType<typeof trafficMapQuerySchema.parse>,
): TrafficMapEvent[] {
  const states = query.states === undefined ? ["active", "planned"] : query.states;
  return events.filter((event) => {
    if (query.categories !== undefined && !query.categories.includes(event.category)) return false;
    if (query.severities !== undefined && !query.severities.includes(event.severity)) return false;
    if (!(states as TrafficEventState[]).includes(event.state)) return false;
    if (!eventIntersectsTimeRange(event, query.from, query.to)) return false;
    if (
      typeof query.north === "number" &&
      typeof query.south === "number" &&
      typeof query.east === "number" &&
      typeof query.west === "number" &&
      !geometryIntersectsBounds(event.geometry, {
        north: query.north,
        south: query.south,
        east: query.east,
        west: query.west,
      })
    ) {
      return false;
    }
    return true;
  });
}

export interface AppRuntime {
  app: express.Express;
  store: Store;
  pool?: pg.Pool;
}

export async function createApp(config: AppConfig): Promise<AppRuntime> {
  const app = express();
  const pool = config.databaseUrl
    ? new pg.Pool({ connectionString: config.databaseUrl })
    : undefined;
  const store: Store = pool ? new PgStore(pool) : new MemoryStore();
  if (pool && config.seedDemo) await (store as PgStore).seedDevelopmentData();

  await mkdir(config.uploadDir, { recursive: true });
  app.set("trust proxy", 1);
  if (config.rateLimitEnabled) {
    app.use(createRateLimiter());
  }
  app.use(
    helmet({
      contentSecurityPolicy:
        config.nodeEnv === "production"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: [
                  "'self'",
                  "data:",
                  "https://cache.kartverket.no",
                  "https://ogc.dsb.no",
                  "https://webkamera.vegvesen.no",
                  "https://webkamera.atlas.vegvesen.no",
                  "https://www.vegvesen.no",
                ],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
              },
            }
          : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  configureAuth(app, config, pool);

  app.get("/health", async (_req, res) => {
    try {
      if (pool) await pool.query("SELECT 1");
      res.json({ status: "ok", storage: pool ? "postgres" : "development-memory" });
    } catch {
      res.status(503).json({ status: "degraded" });
    }
  });

  app.get("/api/session", requireUser, (req, res) =>
    res.json({ user: req.user, csrfToken: csrfToken(req) }),
  );
  app.use("/api", requireUser);
  app.use("/api", requireCsrf(config));

  app.get("/api/bootstrap", async (req, res, next) => {
    try {
      res.json(await store.getBootstrap(currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/articles", async (req, res, next) => {
    try {
      const query = articleQuerySchema.parse(req.query);
      res.json(await store.listArticles(query, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/source-items", async (req, res, next) => {
    try {
      const query = sourceItemQuerySchema.parse(req.query);
      res.json(await store.listSourceItems(query, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/map/traffic-events", async (req, res, next) => {
    try {
      const query = trafficMapQuerySchema.parse(req.query);
      const login = currentLogin(req);
      const requestedStates = query.states ?? ["active", "planned"];
      const bounds =
        typeof query.north === "number" &&
        typeof query.south === "number" &&
        typeof query.east === "number" &&
        typeof query.west === "number"
          ? { north: query.north, south: query.south, east: query.east, west: query.west }
          : undefined;
      const [
        trafficInfoEvents,
        officialEvents,
        articlesPage,
        sourceHealth,
        trafficPulse,
        weather,
        cameras,
        counters,
      ] = await Promise.all([
        store.listTrafficMapEvents(
          {
            sources: ["vegvesen_traffic_info"],
            states: requestedStates,
            categories: query.categories,
            severities: query.severities,
            from: query.from,
            to: query.to,
            bounds,
          },
          login,
        ),
        store.listOfficialEvents({ source: "datex" }, login),
        store.listArticles({ limit: 500 }, login),
        store.listSourceHealth(),
        store.listTrafficPulseCorridors(50),
        store.listRoadWeatherObservations(bounds),
        store.listRoadCameras(bounds),
        store.listTrafficCounterSnapshots(bounds),
      ]);
      const eventsBySourceKey = new Map<string, TrafficMapEvent>();
      const sourceKey = (event: TrafficMapEvent) => `${event.source}:${event.sourceEventId}`;

      for (const event of trafficInfoEvents) {
        eventsBySourceKey.set(sourceKey(event), event);
      }
      for (const event of officialEvents) {
        const trafficEvent = officialEventToTrafficMapEvent(event);
        if (trafficEvent) eventsBySourceKey.set(sourceKey(trafficEvent), trafficEvent);
      }
      const events = filterTrafficMapEvents([...eventsBySourceKey.values()], query).map((event) => {
        const relatedArticles = relatedTrafficArticlesForEvent(event, articlesPage.items);
        return relatedArticles.length > 0 ? { ...event, relatedArticles } : event;
      });
      res.json({
        events,
        brief: buildTrafficBrief(events),
        corridorImpacts: buildCorridorImpacts(events, trafficPulse),
        sources: trafficMapSourceStatuses(sourceHealth),
        weather,
        cameras,
        counters,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/map/public-transport", async (req, res, next) => {
    try {
      const query = publicTransportMapQuerySchema.parse(req.query);
      const bounds =
        typeof query.north === "number" &&
        typeof query.south === "number" &&
        typeof query.east === "number" &&
        typeof query.west === "number"
          ? { north: query.north, south: query.south, east: query.east, west: query.west }
          : defaultPublicTransportBounds;
      const [vehicles, alerts, sourceHealth] = await Promise.all([
        store.listPublicTransportVehicles({ modes: query.modes, bounds }),
        query.includeAlerts === false
          ? Promise.resolve([])
          : store.listPublicTransportServiceAlerts({ states: ["active"], bounds }),
        store.listSourceHealth(),
      ]);
      res.json({
        vehicles,
        alerts,
        sources: sourceHealth.filter((source) => publicTransportSourceIdSet.has(source.source)),
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/saved/articles", async (req, res, next) => {
    try {
      res.json(await store.listSavedArticles(currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/saved/:articleId", async (req, res, next) => {
    try {
      await store.setSaved(req.params.articleId, Boolean(req.body?.saved), currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/saved/articles/:articleId", async (req, res, next) => {
    try {
      await store.setSaved(req.params.articleId, true, currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/saved/:articleId", async (req, res, next) => {
    try {
      await store.setSaved(req.params.articleId, false, currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/saved/articles/:articleId", async (req, res, next) => {
    try {
      await store.setSaved(req.params.articleId, false, currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations", async (req, res, next) => {
    try {
      const query = situationQuerySchema.parse(req.query);
      res.json(await store.listSituations(query, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      res.json(workspace);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/timeline", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(workspace.situation.timeline);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/articles", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(workspace.relatedArticles);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/source-items", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(await store.listSituationSourceItems(req.params.id, currentLogin(req)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/source-items/:sourceItemId", async (req, res, next) => {
    try {
      const { relationship } = sourceItemLinkInputSchema.parse(req.body ?? {});
      const linked = await store.linkSourceItem(
        req.params.id,
        req.params.sourceItemId,
        relationship,
        currentLogin(req),
      );
      if (!linked) {
        res.status(404).json({ error: "Situasjon eller kildeelement finnes ikke." });
        return;
      }
      res.status(201).json(linked);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/source-items/:sourceItemId", async (req, res, next) => {
    try {
      await store.unlinkSourceItem(req.params.id, req.params.sourceItemId, currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/features", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(workspace.situation.features);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/situations/:id/saved", async (req, res, next) => {
    try {
      await store.setSavedSituation(req.params.id, true, currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/saved", async (req, res, next) => {
    try {
      await store.setSavedSituation(req.params.id, false, currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/status", async (req, res, next) => {
    try {
      const { status, dismissalReason } = lifecycleInputSchema.parse(req.body);
      const situation = await store.setSituationStatus(req.params.id, status, dismissalReason);
      if (!situation) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      res.json(situation);
    } catch (error) {
      next(error);
    }
  });

  const ensureSituationExists: express.RequestHandler = async (req, res, next) => {
    try {
      const situationId = String(req.params.id);
      const workspace = await store.getWorkspace(situationId, currentLogin(req));
      if (!workspace) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  app.post("/api/situations/:id/features", ensureSituationExists, async (req, res, next) => {
    try {
      const input = privateMapFeatureInputSchema.parse(req.body);
      const login = currentLogin(req);
      const situationId = String(req.params.id);
      const sourceItemIds = input.properties.sourceItemIds ?? [];
      if (sourceItemIds.length) {
        const linkedIds = new Set(
          (await store.listSituationSourceItems(situationId, login)).map((item) => item.id),
        );
        const invalidIds = sourceItemIds.filter((sourceItemId) => !linkedIds.has(sourceItemId));
        if (invalidIds.length) {
          return void res.status(400).json({
            error:
              "Kildeelementer må være koblet til situasjonen før de kan brukes som privat markering-grunnlag.",
          });
        }
      }
      const feature: MapFeature = {
        id: randomUUID(),
        type: "Feature",
        geometry: input.geometry,
        properties: {
          ...input.properties,
          provenance: "private_annotation",
          updatedAt: new Date().toISOString(),
        },
      };
      res.status(201).json(await store.addPrivateFeature(situationId, feature));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/features/:featureId", async (req, res, next) => {
    try {
      const { label, note } = labelInputSchema.parse(req.body);
      const feature = await store.updatePrivateFeature(
        req.params.id,
        req.params.featureId,
        label,
        note,
      );
      if (!feature) return void res.status(404).json({ error: "Markeringen finnes ikke." });
      res.json(feature);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/features/:featureId", async (req, res, next) => {
    try {
      if (!(await store.deletePrivateFeature(req.params.id, req.params.featureId))) {
        return void res.status(404).json({ error: "Markeringen finnes ikke." });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/tasks", ensureSituationExists, async (req, res, next) => {
    try {
      const { text } = taskInputSchema.parse(req.body);
      res.status(201).json(await store.addTask(String(req.params.id), text));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/tasks/:taskId", async (req, res, next) => {
    try {
      const task =
        typeof req.body?.text === "string"
          ? await store.updateTaskText(
              req.params.id,
              req.params.taskId,
              taskInputSchema.parse(req.body).text,
            )
          : await store.toggleTask(req.params.id, req.params.taskId, Boolean(req.body?.completed));
      if (!task) {
        res.status(404).json({ error: "Oppgaven finnes ikke." });
        return;
      }
      res.json(task);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/tasks/:taskId", async (req, res, next) => {
    try {
      if (!(await store.deleteTask(req.params.id, req.params.taskId))) {
        return void res.status(404).json({ error: "Oppgaven finnes ikke." });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/notes", ensureSituationExists, async (req, res, next) => {
    try {
      const { text } = noteInputSchema.parse(req.body);
      res.status(201).json(await store.addNote(String(req.params.id), text));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/notes/:noteId", async (req, res, next) => {
    try {
      const { text } = noteInputSchema.parse(req.body);
      const note = await store.updateNote(req.params.id, req.params.noteId, text);
      if (!note) return void res.status(404).json({ error: "Notatet finnes ikke." });
      res.json(note);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/notes/:noteId", async (req, res, next) => {
    try {
      if (!(await store.deleteNote(req.params.id, req.params.noteId))) {
        return void res.status(404).json({ error: "Notatet finnes ikke." });
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  const upload = multer({ dest: config.uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });
  app.post(
    "/api/situations/:id/attachments",
    ensureSituationExists,
    upload.single("file"),
    async (req, res, next) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: "Vedlegg mangler." });
          return;
        }
        const attachmentBytes = await readFile(req.file.path);
        const attachment = await store.addAttachment({
          id: randomUUID(),
          situationId: String(req.params.id),
          filename: req.file.originalname,
          storagePath: req.file.path,
          contentType: req.file.mimetype,
          size: req.file.size,
          sha256: createHash("sha256").update(attachmentBytes).digest("hex"),
          createdAt: new Date().toISOString(),
        });
        res.status(201).json(attachment);
      } catch (error) {
        if (req.file) await unlink(req.file.path).catch(() => undefined);
        next(error);
      }
    },
  );

  app.get("/api/situations/:id/attachments/:attachmentId", async (req, res, next) => {
    try {
      const attachment = await store.getAttachment(req.params.attachmentId);
      if (!attachment || attachment.situationId !== req.params.id) {
        return void res.status(404).json({ error: "Vedlegget finnes ikke." });
      }
      res.download(attachment.storagePath, safeFilename(attachment.filename));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/situations/:id/attachments/:attachmentId", async (req, res, next) => {
    try {
      const attachment = await store.deleteAttachment(req.params.id, req.params.attachmentId);
      if (!attachment) return void res.status(404).json({ error: "Vedlegget finnes ikke." });
      await unlink(attachment.storagePath).catch(() => undefined);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/exports", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id, currentLogin(req));
      if (!workspace) return void res.status(404).json({ error: "Situasjonen finnes ikke." });
      const attachmentCount = workspace.attachments.length;
      const attachmentSizes = workspace.attachments.map((attachment) =>
        attachmentSizeBytes(attachment.size),
      );
      const attachmentBytes = attachmentSizes.reduce((total, size) => total + size, 0);
      if (
        attachmentCount > EXPORT_ATTACHMENT_COUNT_LIMIT ||
        attachmentBytes > EXPORT_ATTACHMENT_BYTE_LIMIT
      ) {
        res.status(413).json({ error: "Arbeidsmappen er for stor til eksport." });
        return;
      }
      const exportId = randomUUID();
      const manifest = {
        exportId,
        situationId: workspace.situation.id,
        createdAt: new Date().toISOString(),
        attachmentChecksums: workspace.attachments.map((attachment, index) => ({
          filename: safeFilename(attachment.filename),
          sha256: attachment.sha256,
          size: attachmentSizes[index] ?? 0,
        })),
      };
      const storagePath = path.join(config.uploadDir, `export-${exportId}.zip`);
      const contents = await buildWorkspaceExport(store, workspace, manifest);
      try {
        await writeFile(storagePath, contents);
        await store.recordExport({
          id: exportId,
          situationId: req.params.id,
          githubLogin: currentLogin(req),
          storagePath,
          payload: manifest,
          createdAt: manifest.createdAt,
        });
      } catch (error) {
        await unlink(storagePath).catch(() => undefined);
        throw error;
      }
      res.set(
        "Location",
        `/api/situations/${encodeURIComponent(req.params.id)}/exports/${exportId}`,
      );
      res.set("X-Export-Id", exportId);
      res.attachment(`${workspace.situation.id}-arbeidsmappe.zip`).send(contents);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id/exports/:exportId", async (req, res, next) => {
    try {
      const record = await store.getExport(req.params.exportId, req.params.id, currentLogin(req));
      if (!record) return void res.status(404).json({ error: "Eksporten finnes ikke." });
      res.download(record.storagePath, `${req.params.id}-arbeidsmappe.zip`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/sources", async (_req, res, next) => {
    try {
      res.json(await store.listSourceHealth());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/status", async (_req, res, next) => {
    try {
      const status = await store.getOperationsStatus();
      const runtimeEntry = async (filename: string) => {
        try {
          return JSON.parse(
            await readFile(path.join(config.runtimeStatusDir, filename), "utf8"),
          ) as {
            status: "ok";
            completedAt: string;
          };
        } catch {
          return undefined;
        }
      };
      const [backup, restoreCheck] = await Promise.all([
        runtimeEntry("backup.json"),
        runtimeEntry("restore-check.json"),
      ]);
      res.json({ ...status, backup, restoreCheck });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API-ruten finnes ikke." });
  });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(here, "../../frontend/dist");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));

  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (res.headersSent) {
        next(error);
        return;
      }

      if (error instanceof ZodError) {
        res.status(400).json({
          error: "Ugyldig forespørsel.",
          details: validationDetails(error),
        });
        return;
      }

      if (error instanceof multer.MulterError) {
        res
          .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
          .json({ error: "Ugyldig vedlegg." });
        return;
      }

      if (error instanceof Error && error.message === "Ugyldig sidepeker.") {
        res.status(400).json({ error: "Ugyldig sidepeker." });
        return;
      }

      const status = errorStatus(error);
      if (status === 400) {
        res.status(400).json({ error: "Ugyldig forespørsel." });
        return;
      }

      console.error("Unexpected API error", error);
      res.status(500).json({ error: "Intern serverfeil." });
    },
  );

  return { app, store, pool };
}
