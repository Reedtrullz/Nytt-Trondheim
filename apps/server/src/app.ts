import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import pg from "pg";
import {
  articleQuerySchema,
  labelInputSchema,
  lifecycleInputSchema,
  noteInputSchema,
  privateMapFeatureInputSchema,
  sourceItemLinkInputSchema,
  sourceItemQuerySchema,
  situationQuerySchema,
  taskInputSchema,
  type MapFeature,
} from "@nytt/shared";
import type { AppConfig } from "./config.js";
import { configureAuth, csrfToken, currentLogin, requireCsrf, requireUser } from "./auth.js";
import { buildWorkspaceExport, safeFilename } from "./export.js";
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
      contentSecurityPolicy:
        config.nodeEnv === "production"
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https://cache.kartverket.no", "https://ogc.dsb.no"],
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

  app.post("/api/situations/:id/notes", async (req, res, next) => {
    try {
      const { text } = noteInputSchema.parse(req.body);
      res.status(201).json(await store.addNote(req.params.id, text));
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
      if (req.file) await unlink(req.file.path).catch(() => undefined);
      next(error);
    }
  });

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
      const exportId = randomUUID();
      const manifest = {
        exportId,
        situationId: workspace.situation.id,
        createdAt: new Date().toISOString(),
        attachmentChecksums: workspace.attachments.map(({ filename, sha256, size }) => ({
          filename: safeFilename(filename),
          sha256,
          size,
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
      res.set("Location", `/api/situations/${req.params.id}/exports/${exportId}`);
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
