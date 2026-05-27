import { randomUUID } from "node:crypto";
import type {
  Article,
  ArticlePage,
  Attachment,
  BootstrapPayload,
  EvidenceItem,
  MapFeature,
  OperationsStatus,
  Situation,
  SituationPage,
  SituationWorkspace,
  SourceHealth,
  TimelineEntry,
  WorkspaceNote,
  WorkspaceTask,
} from "@nytt/shared";
import {
  sampleArticles,
  sampleBootstrap,
  sampleNotes,
  sampleSituation,
  sampleTasks,
  sampleWorkspace,
} from "@nytt/shared";
import pg from "pg";

export interface ArticleFilters {
  scope?: string;
  category?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface SituationFilters {
  status?: Situation["status"];
  saved?: boolean;
  includeDismissed?: boolean;
  cursor?: string;
  limit?: number;
}

export interface AttachmentRecord extends Attachment {
  storagePath: string;
}

export interface ExportRecord {
  id: string;
  situationId: string;
  githubLogin: string;
  storagePath: string;
  payload: unknown;
  createdAt: string;
}

export interface Store {
  getBootstrap(login: string): Promise<BootstrapPayload>;
  listArticles(filters: ArticleFilters, login: string): Promise<ArticlePage>;
  listSavedArticles(login: string): Promise<Article[]>;
  setSaved(articleId: string, saved: boolean, login: string): Promise<void>;
  listSituations(filters: SituationFilters, login: string): Promise<SituationPage>;
  setSavedSituation(situationId: string, saved: boolean, login: string): Promise<void>;
  setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
  ): Promise<Situation | undefined>;
  getWorkspace(id: string, login?: string): Promise<SituationWorkspace | undefined>;
  addPrivateFeature(situationId: string, feature: MapFeature): Promise<MapFeature>;
  updatePrivateFeature(
    situationId: string,
    featureId: string,
    label: string,
    note?: string,
  ): Promise<MapFeature | undefined>;
  deletePrivateFeature(situationId: string, featureId: string): Promise<boolean>;
  addTask(situationId: string, text: string): Promise<WorkspaceTask>;
  toggleTask(
    situationId: string,
    taskId: string,
    completed: boolean,
  ): Promise<WorkspaceTask | undefined>;
  updateTaskText(
    situationId: string,
    taskId: string,
    text: string,
  ): Promise<WorkspaceTask | undefined>;
  deleteTask(situationId: string, taskId: string): Promise<boolean>;
  addNote(situationId: string, text: string): Promise<WorkspaceNote>;
  updateNote(situationId: string, noteId: string, text: string): Promise<WorkspaceNote | undefined>;
  deleteNote(situationId: string, noteId: string): Promise<boolean>;
  addAttachment(record: AttachmentRecord): Promise<Attachment>;
  getAttachment(id: string): Promise<AttachmentRecord | undefined>;
  deleteAttachment(situationId: string, id: string): Promise<AttachmentRecord | undefined>;
  recordExport(record: ExportRecord): Promise<void>;
  getExport(id: string, situationId: string, login: string): Promise<ExportRecord | undefined>;
  listSourceHealth(): Promise<SourceHealth[]>;
  getOperationsStatus(): Promise<OperationsStatus>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore implements Store {
  private articles = clone(sampleArticles);
  private situations = new Map([[sampleSituation.id, clone(sampleSituation)]]);
  private tasks = clone(sampleTasks);
  private notes = clone(sampleNotes);
  private attachments: AttachmentRecord[] = [];
  private exports: ExportRecord[] = [];
  private savedSituations = new Set<string>();

  async getBootstrap(): Promise<BootstrapPayload> {
    return {
      ...clone(sampleBootstrap),
      articles: clone(this.articles),
      situations: [...this.situations.values()].map(clone),
    };
  }

  async listArticles(filters: ArticleFilters): Promise<ArticlePage> {
    const search = filters.q?.toLocaleLowerCase("nb");
    const items = this.articles.filter(
      (article) =>
        (!filters.scope || article.scope === filters.scope) &&
        (!filters.category ||
          filters.category === "Alle" ||
          article.category === filters.category) &&
        (!search ||
          `${article.title} ${article.excerpt} ${article.places.join(" ")}`
            .toLocaleLowerCase("nb")
            .includes(search)),
    );
    return { items: clone(items.slice(0, filters.limit ?? 40)) };
  }

  async listSavedArticles(): Promise<Article[]> {
    return clone(this.articles.filter((article) => article.saved));
  }

  async setSaved(articleId: string, saved: boolean): Promise<void> {
    const article = this.articles.find((item) => item.id === articleId);
    if (article) article.saved = saved;
  }

  async listSituations(filters: SituationFilters): Promise<SituationPage> {
    return {
      items: [...this.situations.values()]
        .filter(
          (situation) =>
            (!filters.status && (filters.includeDismissed || situation.status !== "dismissed")) ||
            situation.status === filters.status,
        )
        .filter((situation) => !filters.saved || this.savedSituations.has(situation.id))
        .map((situation) => ({
          ...clone(situation),
          saved: this.savedSituations.has(situation.id),
        })),
    };
  }

  async setSavedSituation(situationId: string, saved: boolean): Promise<void> {
    if (saved) this.savedSituations.add(situationId);
    else this.savedSituations.delete(situationId);
  }

  async setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
  ): Promise<Situation | undefined> {
    const situation = this.situations.get(id);
    if (!situation) return undefined;
    situation.status = status;
    situation.updatedAt = new Date().toISOString();
    if (status === "dismissed") {
      situation.dismissedAt = new Date().toISOString();
      situation.dismissalReason = dismissalReason ?? "owner_dismissed";
    }
    return clone(situation);
  }

  async getWorkspace(id: string): Promise<SituationWorkspace | undefined> {
    const situation = this.situations.get(id);
    if (!situation) return undefined;
    return {
      ...clone(sampleWorkspace),
      situation: { ...clone(situation), saved: this.savedSituations.has(id) },
      relatedArticles: clone(this.articles.filter((item) => item.situationId === id)),
      tasks: clone(this.tasks.filter((task) => task.situationId === id)),
      notes: clone(this.notes.filter((note) => note.situationId === id)),
      attachments: clone(this.attachments.filter((attachment) => attachment.situationId === id)),
    };
  }

  async addPrivateFeature(situationId: string, feature: MapFeature): Promise<MapFeature> {
    const situation = this.situations.get(situationId);
    if (!situation) throw new Error("Situation not found");
    situation.features.push(clone(feature));
    return clone(feature);
  }

  async updatePrivateFeature(situationId: string, featureId: string, label: string, note?: string) {
    const feature = this.situations
      .get(situationId)
      ?.features.find((item) => item.id === featureId);
    if (!feature || feature.properties.provenance !== "private_annotation") return undefined;
    feature.properties = {
      ...feature.properties,
      label,
      note,
      updatedAt: new Date().toISOString(),
    };
    return clone(feature);
  }

  async deletePrivateFeature(situationId: string, featureId: string): Promise<boolean> {
    const situation = this.situations.get(situationId);
    if (!situation) return false;
    const before = situation.features.length;
    situation.features = situation.features.filter(
      (feature) =>
        feature.id !== featureId || feature.properties.provenance !== "private_annotation",
    );
    return situation.features.length < before;
  }

  async addTask(situationId: string, text: string): Promise<WorkspaceTask> {
    const task = {
      id: randomUUID(),
      situationId,
      text,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.tasks.push(task);
    return clone(task);
  }

  async toggleTask(situationId: string, taskId: string, completed: boolean) {
    const task = this.tasks.find((item) => item.id === taskId && item.situationId === situationId);
    if (!task) return undefined;
    task.completed = completed;
    return clone(task);
  }

  async updateTaskText(situationId: string, taskId: string, text: string) {
    const task = this.tasks.find((item) => item.id === taskId && item.situationId === situationId);
    if (!task) return undefined;
    task.text = text;
    return clone(task);
  }

  async deleteTask(situationId: string, taskId: string) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(
      (task) => task.id !== taskId || task.situationId !== situationId,
    );
    return this.tasks.length < before;
  }

  async addNote(situationId: string, text: string): Promise<WorkspaceNote> {
    const note = { id: randomUUID(), situationId, text, createdAt: new Date().toISOString() };
    this.notes.push(note);
    return clone(note);
  }

  async updateNote(situationId: string, noteId: string, text: string) {
    const note = this.notes.find((item) => item.id === noteId && item.situationId === situationId);
    if (!note) return undefined;
    note.text = text;
    return clone(note);
  }

  async deleteNote(situationId: string, noteId: string) {
    const before = this.notes.length;
    this.notes = this.notes.filter(
      (note) => note.id !== noteId || note.situationId !== situationId,
    );
    return this.notes.length < before;
  }

  async addAttachment(record: AttachmentRecord): Promise<Attachment> {
    this.attachments.push(record);
    return clone({
      id: record.id,
      situationId: record.situationId,
      filename: record.filename,
      contentType: record.contentType,
      size: record.size,
      sha256: record.sha256,
      createdAt: record.createdAt,
    });
  }

  async getAttachment(id: string): Promise<AttachmentRecord | undefined> {
    return clone(this.attachments.find((attachment) => attachment.id === id));
  }

  async deleteAttachment(situationId: string, id: string) {
    const attachment = this.attachments.find(
      (item) => item.id === id && item.situationId === situationId,
    );
    this.attachments = this.attachments.filter(
      (item) => item.id !== id || item.situationId !== situationId,
    );
    return clone(attachment);
  }

  async recordExport(record: ExportRecord): Promise<void> {
    this.exports.push(clone(record));
  }

  async getExport(id: string, situationId: string, login: string) {
    return clone(
      this.exports.find(
        (record) =>
          record.id === id && record.situationId === situationId && record.githubLogin === login,
      ),
    );
  }

  async listSourceHealth() {
    return clone(sampleBootstrap.sourceHealth);
  }

  async getOperationsStatus(): Promise<OperationsStatus> {
    return {
      sources: await this.listSourceHealth(),
      articleCount: this.articles.length,
      situationCounts: {
        preliminary: 0,
        active: this.situations.size,
        resolved: 0,
        dismissed: 0,
      },
    };
  }
}

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  async seedDevelopmentData(): Promise<void> {
    for (const article of sampleArticles) {
      await this.pool.query(
        `INSERT INTO articles (id, canonical_url, dedupe_key, source, published_at, scope, category, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          article.id,
          article.url,
          article.id,
          article.source,
          article.publishedAt,
          article.scope,
          article.category,
          article,
        ],
      );
    }
    await this.pool.query(
      `INSERT INTO situations (id, type, status, verification_status, importance, updated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        sampleSituation.id,
        sampleSituation.type,
        sampleSituation.status,
        sampleSituation.verificationStatus,
        sampleSituation.importance,
        sampleSituation.updatedAt,
        sampleSituation,
      ],
    );
    for (const health of sampleBootstrap.sourceHealth) {
      await this.pool.query(
        `INSERT INTO source_health (source, label, state, last_checked_at, detail)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source) DO NOTHING`,
        [health.source, health.label, health.state, health.lastCheckedAt ?? null, health.detail],
      );
    }
  }

  async getBootstrap(login: string): Promise<BootstrapPayload> {
    const [articles, situations, sourceHealth] = await Promise.all([
      this.listArticles({ limit: 100 }, login),
      this.listSituations({ includeDismissed: false, limit: 100 }, login),
      this.listSourceHealth(),
    ]);
    return { articles: articles.items, situations: situations.items, sourceHealth };
  }

  async listArticles(filters: ArticleFilters, login: string): Promise<ArticlePage> {
    const params: unknown[] = [login];
    const where: string[] = [];
    if (filters.scope) {
      params.push(filters.scope);
      where.push(`a.scope = $${params.length}`);
    }
    if (filters.category && filters.category !== "Alle") {
      params.push(filters.category);
      where.push(`a.category = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(a.payload->>'title' ILIKE $${params.length} OR a.payload->>'excerpt' ILIKE $${params.length})`,
      );
    }
    if (filters.cursor) {
      params.push(filters.cursor);
      where.push(`a.published_at < $${params.length}`);
    }
    params.push((filters.limit ?? 40) + 1);
    const result = await this.pool.query<{ payload: Article; saved: boolean }>(
      `SELECT a.payload, (s.article_id IS NOT NULL) AS saved
       FROM articles a LEFT JOIN saved_articles s ON s.article_id = a.id AND s.github_login = $1
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.published_at DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 40;
    const items = result.rows.slice(0, limit).map((row) => ({ ...row.payload, saved: row.saved }));
    return {
      items,
      nextCursor: result.rows.length > limit ? items.at(-1)?.publishedAt : undefined,
    };
  }

  async listSavedArticles(login: string) {
    const result = await this.pool.query<{ payload: Article }>(
      `SELECT a.payload FROM articles a
       JOIN saved_articles s ON s.article_id=a.id
       WHERE s.github_login=$1 ORDER BY a.published_at DESC`,
      [login],
    );
    return result.rows.map((row) => ({ ...row.payload, saved: true }));
  }

  async setSaved(articleId: string, saved: boolean, login: string) {
    if (saved) {
      await this.pool.query(
        "INSERT INTO saved_articles (github_login, article_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [login, articleId],
      );
    } else {
      await this.pool.query("DELETE FROM saved_articles WHERE github_login=$1 AND article_id=$2", [
        login,
        articleId,
      ]);
    }
  }

  async listSituations(filters: SituationFilters, login: string): Promise<SituationPage> {
    const params: unknown[] = [login];
    const where: string[] = [];
    if (filters.status) {
      params.push(filters.status);
      where.push(`s.status = $${params.length}`);
    } else if (!filters.includeDismissed) {
      where.push("s.status <> 'dismissed'");
    }
    if (filters.saved) where.push("ss.situation_id IS NOT NULL");
    if (filters.cursor) {
      params.push(filters.cursor);
      where.push(`s.updated_at < $${params.length}`);
    }
    params.push((filters.limit ?? 30) + 1);
    const result = await this.pool.query<{ payload: Situation; saved: boolean }>(
      `SELECT s.payload, (ss.situation_id IS NOT NULL) AS saved FROM situations s
       LEFT JOIN saved_situations ss ON ss.situation_id=s.id AND ss.github_login=$1
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.updated_at DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 30;
    const items = result.rows.slice(0, limit).map((row) => ({ ...row.payload, saved: row.saved }));
    return {
      items,
      nextCursor: result.rows.length > limit ? items.at(-1)?.updatedAt : undefined,
    };
  }

  async setSavedSituation(situationId: string, saved: boolean, login: string) {
    if (saved) {
      await this.pool.query(
        "INSERT INTO saved_situations (github_login, situation_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [login, situationId],
      );
    } else {
      await this.pool.query(
        "DELETE FROM saved_situations WHERE github_login=$1 AND situation_id=$2",
        [login, situationId],
      );
    }
  }

  async setSituationStatus(
    id: string,
    status: Situation["status"],
    dismissalReason?: Situation["dismissalReason"],
  ) {
    const current = await this.pool.query<{ payload: Situation }>(
      "SELECT payload FROM situations WHERE id=$1",
      [id],
    );
    if (!current.rows[0]) return undefined;
    const existing = current.rows[0].payload;
    const updatedAt = new Date().toISOString();
    const updated: Situation = {
      ...existing,
      status,
      updatedAt,
      ...(status === "dismissed"
        ? {
            dismissedAt: updatedAt,
            dismissalReason: dismissalReason ?? "owner_dismissed",
            incidentSignature: existing.incidentSignature ?? `legacy:${id}`,
            detectionVersion: existing.detectionVersion ?? "1-legacy",
            activationBasis: existing.activationBasis ?? {
              rule: "two_independent_sources",
              sourceIds: [],
              articleIds: existing.relatedArticleIds,
              activatedAt: existing.createdAt,
            },
          }
        : {}),
    };
    await this.pool.query(
      "UPDATE situations SET status=$2, updated_at=$3, payload=$4 WHERE id=$1",
      [id, status, updatedAt, updated],
    );
    if (status === "dismissed" && updated.incidentSignature && updated.activationBasis) {
      await this.pool.query(
        `INSERT INTO situation_activations
         (situation_id, incident_signature, detection_version, source_ids, article_ids, activated_at,
          dismissed_at, dismissal_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (situation_id) DO UPDATE SET dismissed_at=EXCLUDED.dismissed_at,
         dismissal_reason=EXCLUDED.dismissal_reason`,
        [
          id,
          updated.incidentSignature,
          updated.detectionVersion ?? "2",
          JSON.stringify(updated.activationBasis.sourceIds),
          JSON.stringify(updated.activationBasis.articleIds),
          updated.activationBasis.activatedAt,
          updated.dismissedAt,
          updated.dismissalReason,
        ],
      );
    }
    return updated;
  }

  async getWorkspace(id: string, login?: string): Promise<SituationWorkspace | undefined> {
    const situationResult = await this.pool.query<{ payload: Situation; saved: boolean }>(
      `SELECT s.payload,
       CASE WHEN $2::text IS NULL THEN false ELSE EXISTS(
         SELECT 1 FROM saved_situations ss WHERE ss.situation_id=s.id AND ss.github_login=$2
       ) END AS saved
       FROM situations s WHERE s.id=$1`,
      [id, login ?? null],
    );
    const row = situationResult.rows[0];
    const situation = row ? { ...row.payload, saved: row.saved } : undefined;
    if (!situation) return undefined;
    const [articles, evidence, timeline, tasks, notes, attachments, features] = await Promise.all([
      this.pool.query<{ payload: Article }>(
        "SELECT payload FROM articles WHERE payload->>'situationId'=$1",
        [id],
      ),
      this.pool.query<{ payload: EvidenceItem }>(
        "SELECT payload FROM evidence_items WHERE situation_id=$1 ORDER BY extracted_at",
        [id],
      ),
      this.pool.query<{ payload: TimelineEntry }>(
        "SELECT payload FROM timeline_entries WHERE situation_id=$1 ORDER BY occurred_at",
        [id],
      ),
      this.pool.query<WorkspaceTask>(
        `SELECT id, situation_id AS "situationId", text, completed, created_at AS "createdAt"
         FROM workspace_tasks WHERE situation_id=$1 ORDER BY created_at`,
        [id],
      ),
      this.pool.query<WorkspaceNote>(
        `SELECT id, situation_id AS "situationId", text, created_at AS "createdAt"
         FROM workspace_notes WHERE situation_id=$1 ORDER BY created_at`,
        [id],
      ),
      this.pool.query<Attachment>(
        `SELECT id, situation_id AS "situationId", filename, content_type AS "contentType",
         size, sha256, created_at AS "createdAt" FROM attachments WHERE situation_id=$1 ORDER BY created_at`,
        [id],
      ),
      this.pool.query<MapFeature>(
        `SELECT id, 'Feature' AS type, ST_AsGeoJSON(geometry)::json AS geometry, properties
         FROM map_features WHERE situation_id=$1`,
        [id],
      ),
    ]);
    situation.features = [
      ...new Map(
        [...situation.features, ...features.rows].map((feature) => [feature.id, feature]),
      ).values(),
    ];
    situation.evidence = evidence.rows.map((item) => item.payload);
    situation.timeline = timeline.rows.map((item) => item.payload);
    return {
      situation,
      relatedArticles: articles.rows.map((row) => row.payload),
      tasks: tasks.rows,
      notes: notes.rows,
      attachments: attachments.rows,
    };
  }

  async addPrivateFeature(situationId: string, feature: MapFeature): Promise<MapFeature> {
    await this.pool.query(
      `INSERT INTO map_features (id, situation_id, provenance, geometry, properties)
       VALUES ($1,$2,'private_annotation',ST_SetSRID(ST_GeomFromGeoJSON($3),4326),$4)`,
      [feature.id, situationId, JSON.stringify(feature.geometry), feature.properties],
    );
    return feature;
  }

  async updatePrivateFeature(situationId: string, featureId: string, label: string, note?: string) {
    const properties = {
      label,
      note,
      provenance: "private_annotation",
      updatedAt: new Date().toISOString(),
    };
    const result = await this.pool.query<MapFeature>(
      `UPDATE map_features SET properties=$3
       WHERE id=$1 AND situation_id=$2 AND provenance='private_annotation'
       RETURNING id, 'Feature' AS type, ST_AsGeoJSON(geometry)::json AS geometry, properties`,
      [featureId, situationId, properties],
    );
    return result.rows[0];
  }

  async deletePrivateFeature(situationId: string, featureId: string) {
    const result = await this.pool.query(
      "DELETE FROM map_features WHERE id=$1 AND situation_id=$2 AND provenance='private_annotation'",
      [featureId, situationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addTask(situationId: string, text: string) {
    const id = randomUUID();
    const result = await this.pool.query<WorkspaceTask>(
      `INSERT INTO workspace_tasks (id, situation_id, text) VALUES ($1,$2,$3)
       RETURNING id, situation_id AS "situationId", text, completed, created_at AS "createdAt"`,
      [id, situationId, text],
    );
    return result.rows[0]!;
  }

  async toggleTask(situationId: string, taskId: string, completed: boolean) {
    const result = await this.pool.query<WorkspaceTask>(
      `UPDATE workspace_tasks SET completed=$3 WHERE id=$1 AND situation_id=$2
       RETURNING id, situation_id AS "situationId", text, completed, created_at AS "createdAt"`,
      [taskId, situationId, completed],
    );
    return result.rows[0];
  }

  async updateTaskText(situationId: string, taskId: string, text: string) {
    const result = await this.pool.query<WorkspaceTask>(
      `UPDATE workspace_tasks SET text=$3 WHERE id=$1 AND situation_id=$2
       RETURNING id, situation_id AS "situationId", text, completed, created_at AS "createdAt"`,
      [taskId, situationId, text],
    );
    return result.rows[0];
  }

  async deleteTask(situationId: string, taskId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspace_tasks WHERE id=$1 AND situation_id=$2",
      [taskId, situationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addNote(situationId: string, text: string) {
    const result = await this.pool.query<WorkspaceNote>(
      `INSERT INTO workspace_notes (id, situation_id, text) VALUES ($1,$2,$3)
       RETURNING id, situation_id AS "situationId", text, created_at AS "createdAt"`,
      [randomUUID(), situationId, text],
    );
    return result.rows[0]!;
  }

  async updateNote(situationId: string, noteId: string, text: string) {
    const result = await this.pool.query<WorkspaceNote>(
      `UPDATE workspace_notes SET text=$3 WHERE id=$1 AND situation_id=$2
       RETURNING id, situation_id AS "situationId", text, created_at AS "createdAt"`,
      [noteId, situationId, text],
    );
    return result.rows[0];
  }

  async deleteNote(situationId: string, noteId: string) {
    const result = await this.pool.query(
      "DELETE FROM workspace_notes WHERE id=$1 AND situation_id=$2",
      [noteId, situationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async addAttachment(record: AttachmentRecord) {
    const result = await this.pool.query<Attachment>(
      `INSERT INTO attachments
       (id, situation_id, filename, storage_path, content_type, size, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, situation_id AS "situationId", filename, content_type AS "contentType",
       size, sha256, created_at AS "createdAt"`,
      [
        record.id,
        record.situationId,
        record.filename,
        record.storagePath,
        record.contentType,
        record.size,
        record.sha256,
      ],
    );
    return result.rows[0]!;
  }

  async getAttachment(id: string) {
    const result = await this.pool.query<AttachmentRecord>(
      `SELECT id, situation_id AS "situationId", filename, storage_path AS "storagePath",
       content_type AS "contentType", size, sha256, created_at AS "createdAt"
       FROM attachments WHERE id=$1`,
      [id],
    );
    return result.rows[0];
  }

  async deleteAttachment(situationId: string, id: string) {
    const attachment = await this.getAttachment(id);
    if (!attachment || attachment.situationId !== situationId) return undefined;
    await this.pool.query("DELETE FROM attachments WHERE id=$1 AND situation_id=$2", [
      id,
      situationId,
    ]);
    return attachment;
  }

  async recordExport(record: ExportRecord) {
    await this.pool.query(
      `INSERT INTO export_manifests
       (id, situation_id, github_login, storage_path, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        record.id,
        record.situationId,
        record.githubLogin,
        record.storagePath,
        record.payload,
        record.createdAt,
      ],
    );
  }

  async getExport(id: string, situationId: string, login: string) {
    const result = await this.pool.query<ExportRecord>(
      `SELECT id, situation_id AS "situationId", github_login AS "githubLogin",
       storage_path AS "storagePath", payload, created_at AS "createdAt"
       FROM export_manifests
       WHERE id=$1 AND situation_id=$2 AND github_login=$3 AND storage_path IS NOT NULL`,
      [id, situationId, login],
    );
    return result.rows[0];
  }

  async listSourceHealth() {
    const result = await this.pool.query<SourceHealth>(
      `SELECT source, label, state, last_checked_at AS "lastCheckedAt",
       last_failure_at AS "lastFailureAt", next_poll_at AS "nextPollAt", detail
       FROM source_health ORDER BY label`,
    );
    return result.rows;
  }

  async getOperationsStatus(): Promise<OperationsStatus> {
    const [sources, articleCount, situationCounts, latestAiRun] = await Promise.all([
      this.listSourceHealth(),
      this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM articles"),
      this.pool.query<{ status: Situation["status"]; count: string }>(
        "SELECT status, count(*)::text AS count FROM situations GROUP BY status",
      ),
      this.pool.query<{
        provider: "deepseek" | "deterministic";
        model: string;
        status: "ok" | "degraded" | "disabled";
        completedAt: string;
        error?: string;
      }>(
        `SELECT provider, model, status, completed_at AS "completedAt", error
         FROM ai_processing_runs ORDER BY completed_at DESC LIMIT 1`,
      ),
    ]);
    const counts: OperationsStatus["situationCounts"] = {
      preliminary: 0,
      active: 0,
      resolved: 0,
      dismissed: 0,
    };
    for (const row of situationCounts.rows) counts[row.status] = Number(row.count);
    return {
      sources,
      articleCount: Number(articleCount.rows[0]?.count ?? 0),
      situationCounts: counts,
      latestAiRun: latestAiRun.rows[0],
      latestCollectionAt: sources
        .map((source) => source.lastCheckedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
    };
  }
}
