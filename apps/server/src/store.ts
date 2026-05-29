import { createHash, randomUUID } from "node:crypto";
import type {
  Article,
  ArticlePage,
  Attachment,
  BootstrapPayload,
  EvidenceItem,
  MapFeature,
  OfficialEvent,
  OperationsStatus,
  RoadCamera,
  RoadWeatherObservation,
  Situation,
  SituationPage,
  SituationWorkspace,
  SourceItem,
  SourceItemFilters,
  SourceItemPage,
  SourceItemRelationship,
  SourceHealth,
  TimelineEntry,
  TrafficCounterSnapshot,
  TrafficMapEvent,
  TrafficPulseCorridor,
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

export interface OfficialEventFilters {
  source?: OfficialEvent["source"];
  states?: OfficialEvent["state"][];
  cursor?: string;
  limit?: number;
}

export interface TrafficMapEventFilters {
  sources?: TrafficMapEvent["source"][];
  categories?: TrafficMapEvent["category"][];
  severities?: TrafficMapEvent["severity"][];
  states?: TrafficMapEvent["state"][];
  from?: string;
  to?: string;
  bounds?: { north: number; south: number; east: number; west: number };
}

export type Bounds = TrafficMapEventFilters["bounds"];

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
  listSourceItems(filters: SourceItemFilters, login: string): Promise<SourceItemPage>;
  listOfficialEvents(filters: OfficialEventFilters, login: string): Promise<OfficialEvent[]>;
  listTrafficMapEvents(filters: TrafficMapEventFilters, login: string): Promise<TrafficMapEvent[]>;
  listRoadWeatherObservations(bounds?: Bounds): Promise<RoadWeatherObservation[]>;
  listRoadCameras(bounds?: Bounds): Promise<RoadCamera[]>;
  listTrafficCounterSnapshots(bounds?: Bounds): Promise<TrafficCounterSnapshot[]>;
  listTrafficPulseCorridors(limit?: number): Promise<TrafficPulseCorridor[]>;
  listSituationSourceItems(situationId: string, login: string): Promise<SourceItem[]>;
  linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined>;
  unlinkSourceItem(situationId: string, sourceItemId: string, login: string): Promise<boolean>;
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

function encodeCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify([timestamp, id]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { timestamp: string; id?: string } {
  if (!Number.isNaN(Date.parse(cursor))) return { timestamp: cursor };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      typeof parsed[1] === "string"
    ) {
      return { timestamp: parsed[0], id: parsed[1] };
    }
  } catch {
    // Validation below returns one stable client-facing error for malformed cursors.
  }
  throw new Error("Ugyldig sidepeker.");
}

function beforeCursor(
  timestamp: string,
  id: string,
  cursor?: { timestamp: string; id?: string },
): boolean {
  if (!cursor) return true;
  return (
    timestamp < cursor.timestamp ||
    (timestamp === cursor.timestamp && Boolean(cursor.id && id < cursor.id))
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceItemHash(parts: unknown[]): string {
  return sha256(JSON.stringify(parts));
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sourceItemHash([provider, kind, stableKey])}`;
}

function memorySourceItemFromArticle(article: Article): SourceItem {
  const normalizedPayload = {
    id: article.id,
    source: article.source,
    sourceLabel: article.sourceLabel,
    title: article.title,
    excerpt: article.excerpt,
    url: article.url,
    publishedAt: article.publishedAt,
    scope: article.scope,
    category: article.category,
    places: article.places,
    location: article.location,
  };
  const geoHint: SourceItem["geoHint"] = article.location
    ? { type: "Point", coordinates: [article.location.lng, article.location.lat] }
    : undefined;

  return {
    id: sourceItemId(article.source, "article", article.id),
    provider: article.source,
    kind: "article",
    externalId: article.id,
    originalUrl: article.url,
    title: article.title,
    summary: article.excerpt,
    publishedAt: article.publishedAt,
    fetchedAt: article.publishedAt,
    captureHash: sourceItemHash([
      article.source,
      "article",
      article.id,
      article.url,
      article.publishedAt,
      normalizedPayload,
    ]),
    geoHint,
    reliabilityTier: article.source === "trondheim_kommune" ? "official" : "trusted_media",
    linkedSituationIds: [],
  };
}

interface SourceItemRow {
  id: string;
  provider: SourceItem["provider"];
  kind: SourceItem["kind"];
  external_id: string | null;
  original_url: string | null;
  title: string | null;
  summary: string | null;
  author: string | null;
  published_at: Date | string | null;
  fetched_at: Date | string;
  fetched_at_cursor: string;
  capture_hash: string;
  geo_hint: SourceItem["geoHint"] | null;
  reliability_tier: SourceItem["reliabilityTier"];
  linked_situation_ids: string[] | null;
}

function sourceItemFromRow(row: SourceItemRow): SourceItem {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    externalId: row.external_id ?? undefined,
    originalUrl: row.original_url ?? undefined,
    title: row.title ?? undefined,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
    fetchedAt: new Date(row.fetched_at).toISOString(),
    captureHash: row.capture_hash,
    geoHint: row.geo_hint ?? undefined,
    reliabilityTier: row.reliability_tier,
    linkedSituationIds: row.linked_situation_ids ?? [],
  };
}

function sourceItemSelectColumns(alias = "si"): string {
  return `${alias}.id, ${alias}.provider, ${alias}.kind, ${alias}.external_id, ${alias}.original_url,
       ${alias}.title, ${alias}.summary, ${alias}.author, ${alias}.published_at, ${alias}.fetched_at,
       to_char(${alias}.fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fetched_at_cursor,
       ${alias}.capture_hash,
       ST_AsGeoJSON(${alias}.geo_hint)::json AS geo_hint, ${alias}.reliability_tier,
       links.linked_situation_ids`;
}

const TRAFFIC_PULSE_STALE_AFTER_MS = 20 * 60 * 1000;

function isOlderThan(value: Date | string | null | undefined, cutoffMs: number): boolean {
  if (!value) return false;
  const timestampMs = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestampMs) && timestampMs < cutoffMs;
}

function withTrafficPulseStaleOverlay(
  corridor: TrafficPulseCorridor,
  measurementTo: Date | string | null | undefined,
  nowMs: number,
): TrafficPulseCorridor {
  const cutoffMs = nowMs - TRAFFIC_PULSE_STALE_AFTER_MS;
  if (isOlderThan(measurementTo, cutoffMs) || isOlderThan(corridor.measurementTo, cutoffMs)) {
    return { ...corridor, state: "stale" };
  }
  return corridor;
}

export class MemoryStore implements Store {
  private articles = clone(sampleArticles);
  private situations = new Map([[sampleSituation.id, clone(sampleSituation)]]);
  private tasks = clone(sampleTasks);
  private notes = clone(sampleNotes);
  private attachments: AttachmentRecord[] = [];
  private exports: ExportRecord[] = [];
  private savedSituations = new Set<string>();
  private sourceItems = new Map<string, SourceItem>(
    sampleArticles.map((article) => {
      const item = memorySourceItemFromArticle(article);
      return [item.id, item];
    }),
  );
  private sourceLinks = new Map<
    string,
    {
      situationId: string;
      sourceItemId: string;
      relationship: SourceItemRelationship;
      linkedBy: string;
      linkedAt: string;
    }
  >(
    sampleArticles.flatMap((article) => {
      const linkedSituationId =
        article.situationId ??
        (sampleSituation.relatedArticleIds.includes(article.id) ? sampleSituation.id : undefined);
      if (!linkedSituationId) return [];
      const sourceId = sourceItemId(article.source, "article", article.id);
      return [
        [
          `${linkedSituationId}:${sourceId}`,
          {
            situationId: linkedSituationId,
            sourceItemId: sourceId,
            relationship: "supports" as SourceItemRelationship,
            linkedBy: "sample-data",
            linkedAt: article.publishedAt,
          },
        ],
      ];
    }),
  );

  private linkedSituationIdsForSourceItem(sourceItemId: string): string[] {
    return [...this.sourceLinks.values()]
      .filter((link) => link.sourceItemId === sourceItemId)
      .map((link) => link.situationId)
      .sort();
  }

  async getBootstrap(): Promise<BootstrapPayload> {
    return {
      ...clone(sampleBootstrap),
      articles: clone(this.articles),
      situations: [...this.situations.values()].map(clone),
    };
  }

  async listArticles(filters: ArticleFilters): Promise<ArticlePage> {
    const search = filters.q?.toLocaleLowerCase("nb");
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 40;
    const items = this.articles
      .filter(
        (article) =>
          (!filters.scope || article.scope === filters.scope) &&
          (!filters.category ||
            filters.category === "Alle" ||
            article.category === filters.category) &&
          (!search ||
            `${article.title} ${article.excerpt} ${article.places.join(" ")}`
              .toLocaleLowerCase("nb")
              .includes(search)) &&
          beforeCursor(article.publishedAt, article.id, cursor),
      )
      .sort(
        (left, right) =>
          right.publishedAt.localeCompare(left.publishedAt) || right.id.localeCompare(left.id),
      );
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: clone(page),
      nextCursor:
        items.length > limit && last ? encodeCursor(last.publishedAt, last.id) : undefined,
    };
  }

  async listSourceItems(filters: SourceItemFilters): Promise<SourceItemPage> {
    const search = filters.q?.toLocaleLowerCase("nb");
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 40;
    const withLinks = [...this.sourceItems.values()].map((item) => ({
      ...item,
      linkedSituationIds: [...this.sourceLinks.values()]
        .filter((link) => link.sourceItemId === item.id)
        .map((link) => link.situationId)
        .sort(),
    }));
    const items = withLinks
      .filter(
        (item) =>
          (!filters.provider || item.provider === filters.provider) &&
          (!filters.kind || item.kind === filters.kind) &&
          (!filters.unlinked || item.linkedSituationIds.length === 0) &&
          (!search ||
            `${item.title ?? ""} ${item.summary ?? ""} ${item.originalUrl ?? ""}`
              .toLocaleLowerCase("nb")
              .includes(search)) &&
          beforeCursor(item.fetchedAt, item.id, cursor),
      )
      .sort(
        (left, right) =>
          right.fetchedAt.localeCompare(left.fetchedAt) || right.id.localeCompare(left.id),
      );
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: clone(page),
      nextCursor: items.length > limit && last ? encodeCursor(last.fetchedAt, last.id) : undefined,
    };
  }

  async listOfficialEvents(): Promise<OfficialEvent[]> {
    return [];
  }

  async listTrafficMapEvents(): Promise<TrafficMapEvent[]> {
    return [];
  }

  async listRoadWeatherObservations(): Promise<RoadWeatherObservation[]> {
    return [];
  }

  async listRoadCameras(): Promise<RoadCamera[]> {
    return [];
  }

  async listTrafficCounterSnapshots(): Promise<TrafficCounterSnapshot[]> {
    return [];
  }

  async listTrafficPulseCorridors(): Promise<TrafficPulseCorridor[]> {
    return [];
  }

  async listSituationSourceItems(situationId: string): Promise<SourceItem[]> {
    if (!this.situations.has(situationId)) return [];
    const links = [...this.sourceLinks.values()]
      .filter((link) => link.situationId === situationId)
      .sort(
        (left, right) =>
          right.linkedAt.localeCompare(left.linkedAt) ||
          right.sourceItemId.localeCompare(left.sourceItemId),
      );
    return links.flatMap((link) => {
      const item = this.sourceItems.get(link.sourceItemId);
      if (!item) return [];
      return [
        clone({
          ...item,
          linkedSituationIds: this.linkedSituationIdsForSourceItem(item.id),
        }),
      ];
    });
  }

  async linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined> {
    const item = this.sourceItems.get(sourceItemId);
    if (!this.situations.has(situationId) || !item) return undefined;
    this.sourceLinks.set(`${situationId}:${sourceItemId}`, {
      situationId,
      sourceItemId,
      relationship,
      linkedBy: login,
      linkedAt: new Date().toISOString(),
    });
    return clone({
      ...item,
      linkedSituationIds: this.linkedSituationIdsForSourceItem(sourceItemId),
    });
  }

  async unlinkSourceItem(situationId: string, sourceItemId: string): Promise<boolean> {
    return this.sourceLinks.delete(`${situationId}:${sourceItemId}`);
  }

  async listSavedArticles(): Promise<Article[]> {
    return clone(this.articles.filter((article) => article.saved));
  }

  async setSaved(articleId: string, saved: boolean): Promise<void> {
    const article = this.articles.find((item) => item.id === articleId);
    if (article) article.saved = saved;
  }

  async listSituations(filters: SituationFilters): Promise<SituationPage> {
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : undefined;
    const limit = filters.limit ?? 30;
    const items = [...this.situations.values()]
      .filter(
        (situation) =>
          ((!filters.status && (filters.includeDismissed || situation.status !== "dismissed")) ||
            situation.status === filters.status) &&
          (!filters.saved || this.savedSituations.has(situation.id)) &&
          beforeCursor(situation.updatedAt, situation.id, cursor),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      );
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((situation) => ({
        ...clone(situation),
        saved: this.savedSituations.has(situation.id),
      })),
      nextCursor: items.length > limit && last ? encodeCursor(last.updatedAt, last.id) : undefined,
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
      trafficPulse: await this.listTrafficPulseCorridors(),
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
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(a.published_at < $${timestampIndex} OR (a.published_at = $${timestampIndex} AND a.id < $${params.length}))`,
        );
      } else {
        where.push(`a.published_at < $${timestampIndex}`);
      }
    }
    params.push((filters.limit ?? 40) + 1);
    const result = await this.pool.query<{ payload: Article; saved: boolean }>(
      `SELECT a.payload, (s.article_id IS NOT NULL) AS saved
       FROM articles a LEFT JOIN saved_articles s ON s.article_id = a.id AND s.github_login = $1
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.published_at DESC, a.id DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 40;
    const items = result.rows.slice(0, limit).map((row) => ({ ...row.payload, saved: row.saved }));
    return {
      items,
      nextCursor:
        result.rows.length > limit && items.at(-1)
          ? encodeCursor(items.at(-1)!.publishedAt, items.at(-1)!.id)
          : undefined,
    };
  }

  async listSourceItems(filters: SourceItemFilters): Promise<SourceItemPage> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.provider) {
      params.push(filters.provider);
      where.push(`si.provider = $${params.length}`);
    }
    if (filters.kind) {
      params.push(filters.kind);
      where.push(`si.kind = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(si.title ILIKE $${params.length} OR si.summary ILIKE $${params.length} OR si.original_url ILIKE $${params.length})`,
      );
    }
    if (filters.unlinked) {
      where.push(
        "NOT EXISTS (SELECT 1 FROM situation_source_items unlinked_ssi WHERE unlinked_ssi.source_item_id = si.id)",
      );
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(si.fetched_at < $${timestampIndex} OR (si.fetched_at = $${timestampIndex} AND si.id < $${params.length}))`,
        );
      } else {
        where.push(`si.fetched_at < $${timestampIndex}`);
      }
    }
    params.push((filters.limit ?? 40) + 1);
    const result = await this.pool.query<SourceItemRow>(
      `SELECT ${sourceItemSelectColumns("si")}
       FROM source_items si
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(ssi.situation_id ORDER BY ssi.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items ssi WHERE ssi.source_item_id = si.id
       ) links ON true
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY si.fetched_at DESC, si.id DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 40;
    const visibleRows = result.rows.slice(0, limit);
    const items = visibleRows.map(sourceItemFromRow);
    const lastRow = visibleRows.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > limit && lastRow
          ? encodeCursor(lastRow.fetched_at_cursor, lastRow.id)
          : undefined,
    };
  }

  async listOfficialEvents(filters: OfficialEventFilters): Promise<OfficialEvent[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.source) {
      params.push(filters.source);
      where.push(`source = $${params.length}`);
    }
    if (filters.states?.length) {
      params.push(filters.states);
      where.push(`state = ANY($${params.length}::text[])`);
    }
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(published_at < $${timestampIndex} OR (published_at = $${timestampIndex} AND id < $${params.length}))`,
        );
      } else {
        where.push(`published_at < $${timestampIndex}`);
      }
    }
    const limitClause = filters.limit ? `LIMIT $${params.length + 1}` : "";
    if (filters.limit) params.push(filters.limit);
    const result = await this.pool.query<{
      payload: OfficialEvent;
      state: OfficialEvent["state"];
      geometry: OfficialEvent["geometry"] | null;
    }>(
      `SELECT payload, state, ST_AsGeoJSON(geometry)::json AS geometry
       FROM official_events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY published_at DESC, id DESC
       ${limitClause}`,
      params,
    );

    return result.rows.map((row) => ({
      ...row.payload,
      state: row.state,
      ...(row.geometry ? { geometry: row.geometry } : {}),
    }));
  }

  async listTrafficMapEvents(filters: TrafficMapEventFilters): Promise<TrafficMapEvent[]> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.sources?.length) {
      params.push(filters.sources);
      where.push(`source = ANY($${params.length}::text[])`);
    }
    if (filters.states?.length) {
      params.push(filters.states);
      where.push(`state = ANY($${params.length}::text[])`);
    }
    if (filters.categories?.length) {
      params.push(filters.categories);
      where.push(`category = ANY($${params.length}::text[])`);
    }
    if (filters.severities?.length) {
      params.push(filters.severities);
      where.push(`severity = ANY($${params.length}::text[])`);
    }
    if (filters.bounds) {
      params.push(
        filters.bounds.west,
        filters.bounds.south,
        filters.bounds.east,
        filters.bounds.north,
      );
      const westIndex = params.length - 3;
      const southIndex = params.length - 2;
      const eastIndex = params.length - 1;
      const northIndex = params.length;
      where.push(
        `geometry && ST_MakeEnvelope($${westIndex}, $${southIndex}, $${eastIndex}, $${northIndex}, 4326)`,
      );
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`COALESCE(valid_to, updated_at) >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`COALESCE(valid_from, updated_at) <= $${params.length}`);
    }

    const result = await this.pool.query<{
      payload: TrafficMapEvent;
      state: TrafficMapEvent["state"];
    }>(
      `SELECT payload, state
       FROM traffic_map_events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC
       LIMIT 1000`,
      params,
    );

    return result.rows.map((row) => ({ ...row.payload, state: row.state }));
  }

  async listRoadWeatherObservations(bounds?: Bounds): Promise<RoadWeatherObservation[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (bounds) {
      params.push(bounds.west, bounds.south, bounds.east, bounds.north);
      where.push("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    }

    const result = await this.pool.query<{ payload: RoadWeatherObservation }>(
      `SELECT payload
       FROM road_weather_observations
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, station_id ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async listRoadCameras(bounds?: Bounds): Promise<RoadCamera[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (bounds) {
      params.push(bounds.west, bounds.south, bounds.east, bounds.north);
      where.push("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    }

    const result = await this.pool.query<{ payload: RoadCamera }>(
      `SELECT payload
       FROM road_cameras
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, camera_id ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async listTrafficCounterSnapshots(bounds?: Bounds): Promise<TrafficCounterSnapshot[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (bounds) {
      params.push(bounds.west, bounds.south, bounds.east, bounds.north);
      where.push("geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    }

    const result = await this.pool.query<{ payload: TrafficCounterSnapshot }>(
      `SELECT payload
       FROM traffic_counter_snapshots
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, point_id ASC`,
      params,
    );
    return result.rows.map((row) => row.payload);
  }

  async listSituationSourceItems(situationId: string): Promise<SourceItem[]> {
    const result = await this.pool.query<SourceItemRow>(
      `SELECT ${sourceItemSelectColumns("si")}
       FROM situation_source_items ssi
       JOIN source_items si ON si.id = ssi.source_item_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(source_links.situation_id ORDER BY source_links.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items source_links WHERE source_links.source_item_id = si.id
       ) links ON true
       WHERE ssi.situation_id = $1
       ORDER BY ssi.linked_at DESC, ssi.source_item_id DESC`,
      [situationId],
    );
    return result.rows.map(sourceItemFromRow);
  }

  async linkSourceItem(
    situationId: string,
    sourceItemId: string,
    relationship: SourceItemRelationship,
    login: string,
  ): Promise<SourceItem | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO situation_source_items (situation_id, source_item_id, relationship, linked_by)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (SELECT 1 FROM situations WHERE id = $1)
         AND EXISTS (SELECT 1 FROM source_items WHERE id = $2)
       ON CONFLICT (situation_id, source_item_id) DO UPDATE SET
         relationship = EXCLUDED.relationship,
         linked_by = EXCLUDED.linked_by,
         linked_at = now()
       RETURNING source_item_id AS id`,
      [situationId, sourceItemId, relationship, login],
    );
    const linkedId = result.rows[0]?.id;
    return linkedId ? this.getSourceItem(linkedId) : undefined;
  }

  async unlinkSourceItem(situationId: string, sourceItemId: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM situation_source_items WHERE situation_id = $1 AND source_item_id = $2",
      [situationId, sourceItemId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async getSourceItem(id: string): Promise<SourceItem | undefined> {
    const result = await this.pool.query<SourceItemRow>(
      `SELECT ${sourceItemSelectColumns("si")}
       FROM source_items si
       LEFT JOIN LATERAL (
         SELECT COALESCE(array_agg(ssi.situation_id ORDER BY ssi.situation_id), '{}') AS linked_situation_ids
         FROM situation_source_items ssi WHERE ssi.source_item_id = si.id
       ) links ON true
       WHERE si.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? sourceItemFromRow(row) : undefined;
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
      const cursor = decodeCursor(filters.cursor);
      params.push(cursor.timestamp);
      const timestampIndex = params.length;
      if (cursor.id) {
        params.push(cursor.id);
        where.push(
          `(s.updated_at < $${timestampIndex} OR (s.updated_at = $${timestampIndex} AND s.id < $${params.length}))`,
        );
      } else {
        where.push(`s.updated_at < $${timestampIndex}`);
      }
    }
    params.push((filters.limit ?? 30) + 1);
    const result = await this.pool.query<{ payload: Situation; saved: boolean }>(
      `SELECT s.payload, (ss.situation_id IS NOT NULL) AS saved FROM situations s
       LEFT JOIN saved_situations ss ON ss.situation_id=s.id AND ss.github_login=$1
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.updated_at DESC, s.id DESC LIMIT $${params.length}`,
      params,
    );
    const limit = filters.limit ?? 30;
    const items = result.rows.slice(0, limit).map((row) => ({ ...row.payload, saved: row.saved }));
    return {
      items,
      nextCursor:
        result.rows.length > limit && items.at(-1)
          ? encodeCursor(items.at(-1)!.updatedAt, items.at(-1)!.id)
          : undefined,
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

  async listTrafficPulseCorridors(limit = 30): Promise<TrafficPulseCorridor[]> {
    const result = await this.pool.query<{
      payload: TrafficPulseCorridor;
      measurementTo?: Date | string | null;
    }>(
      `SELECT payload, measurement_to AS "measurementTo"
       FROM datex_travel_times
       ORDER BY delay_seconds DESC NULLS LAST, name ASC
       LIMIT $1`,
      [limit],
    );
    const responseTimeMs = Date.now();
    return result.rows.map((row) =>
      withTrafficPulseStaleOverlay(row.payload, row.measurementTo, responseTimeMs),
    );
  }

  async getOperationsStatus(): Promise<OperationsStatus> {
    const [sources, articleCount, situationCounts, latestAiRun, trafficPulse] = await Promise.all([
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
      this.listTrafficPulseCorridors(30),
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
      trafficPulse,
      latestCollectionAt: sources
        .map((source) => source.lastCheckedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
    };
  }
}
