import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";
import {
  articleQuerySchema,
  noteInputSchema,
  privateMapFeatureInputSchema,
  taskInputSchema,
  type MapFeature,
} from "@nytt/shared";
import type { AppConfig } from "./config.js";
import { configureAuth, currentLogin, requireUser } from "./auth.js";
import { streamWorkspaceExport } from "./export.js";
import { MemoryStore, PgStore, type Store } from "./store.js";

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
  app.use(
    helmet({
      contentSecurityPolicy: false,
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

  app.get("/api/session", requireUser, (req, res) => res.json({ user: req.user }));
  app.use("/api", requireUser);

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

  app.put("/api/saved/:articleId", async (req, res, next) => {
    try {
      await store.setSaved(req.params.articleId, Boolean(req.body?.saved), currentLogin(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/situations/:id", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      res.json(workspace);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/features", async (req, res, next) => {
    try {
      const input = privateMapFeatureInputSchema.parse(req.body);
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
      res.status(201).json(await store.addPrivateFeature(req.params.id, feature));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/tasks", async (req, res, next) => {
    try {
      const { text } = taskInputSchema.parse(req.body);
      res.status(201).json(await store.addTask(req.params.id, text));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/situations/:id/tasks/:taskId", async (req, res, next) => {
    try {
      const task = await store.toggleTask(
        req.params.id,
        req.params.taskId,
        Boolean(req.body?.completed),
      );
      if (!task) {
        res.status(404).json({ error: "Oppgaven finnes ikke." });
        return;
      }
      res.json(task);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/situations/:id/notes", async (req, res, next) => {
    try {
      const { text } = noteInputSchema.parse(req.body);
      res.status(201).json(await store.addNote(req.params.id, text));
    } catch (error) {
      next(error);
    }
  });

  const upload = multer({ dest: config.uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });
  app.post("/api/situations/:id/attachments", upload.single("file"), async (req, res, next) => {
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
      next(error);
    }
  });

  app.get("/api/situations/:id/export", async (req, res, next) => {
    try {
      const workspace = await store.getWorkspace(req.params.id);
      if (!workspace) {
        res.status(404).json({ error: "Situasjonen finnes ikke." });
        return;
      }
      await streamWorkspaceExport(res, store, workspace);
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

  const here = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(here, "../../frontend/dist");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));

  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next;
      const message = error instanceof Error ? error.message : "Ukjent serverfeil";
      res.status(400).json({ error: message });
    },
  );

  return { app, store, pool };
}
