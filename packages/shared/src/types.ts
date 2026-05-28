import type { Feature, Geometry } from "geojson";

export type SourceId =
  | "nrk"
  | "adressa"
  | "vg"
  | "dagbladet"
  | "trondheim_kommune"
  | "met"
  | "nve"
  | "datex"
  | "datex_travel_time"
  | "dsb"
  | "politiloggen"
  | "deepseek";

export type GeographicScope = "trondheim" | "trondelag";
export type ArticleCategory =
  | "Nyheter"
  | "Hendelser"
  | "Byutvikling"
  | "Kultur"
  | "Transport"
  | "Politikk"
  | "Vær";

export type SituationType =
  | "fire"
  | "missing_person"
  | "traffic"
  | "flood"
  | "landslide"
  | "weather"
  | "rescue"
  | "service_disruption"
  | "other";

export type SituationLifecycle = "preliminary" | "active" | "resolved" | "dismissed";
export type Provenance =
  | "official"
  | "reporting_estimate"
  | "preparedness_context"
  | "private_annotation";

export interface Article {
  id: string;
  source: SourceId;
  sourceLabel: string;
  title: string;
  excerpt: string;
  url: string;
  publishedAt: string;
  scope: GeographicScope;
  category: ArticleCategory;
  places: string[];
  location?: { lat: number; lng: number; label: string };
  saved?: boolean;
  situationId?: string;
  imageUrl?: string;
}

export interface EvidenceItem {
  id: string;
  situationId: string;
  source: SourceId;
  sourceLabel: string;
  sourceUrl: string;
  supportingSnippet: string;
  claim: string;
  claimType: string;
  provenance: Exclude<Provenance, "private_annotation">;
  confidence: number;
  extractedAt: string;
  publishedAt: string;
}

export interface MapFeature extends Feature<Geometry> {
  id: string;
  properties: {
    label: string;
    provenance: Provenance;
    sourceLabel?: string;
    sourceUrl?: string;
    updatedAt: string;
    note?: string;
    layer?: string;
  };
}

export interface TimelineEntry {
  id: string;
  situationId: string;
  timestamp: string;
  title: string;
  detail: string;
  sourceLabel: string;
  sourceUrl: string;
  official: boolean;
}

export interface Situation {
  id: string;
  type: SituationType;
  title: string;
  summary: string;
  status: SituationLifecycle;
  verificationStatus: "Foreløpig fra rapportering" | "Offentlig bekreftet";
  importance: "high" | "normal";
  updatedAt: string;
  createdAt: string;
  locationLabel: string;
  incidentSignature?: string;
  detectionVersion?: string;
  officialSource?: Extract<SourceId, "datex">;
  officialEventId?: string;
  activationBasis?: {
    rule: "two_independent_sources" | "official_source";
    sourceIds: SourceId[];
    articleIds: string[];
    activatedAt: string;
  };
  dismissedAt?: string;
  dismissalReason?: "false_positive" | "owner_dismissed";
  relatedArticleIds: string[];
  evidence: EvidenceItem[];
  features: MapFeature[];
  timeline: TimelineEntry[];
  saved?: boolean;
}

export type OfficialEventState = "active" | "updated" | "cancelled" | "expired";

export interface OfficialEvent {
  id: string;
  source: "met" | "nve" | "datex";
  eventType: SituationType;
  title: string;
  detail: string;
  sourceUrl: string;
  areaLabel: string;
  state: OfficialEventState;
  severity?: string;
  publishedAt: string;
  validFrom: string;
  validTo: string;
  geometry?: MapFeature["geometry"];
  replacesIds?: string[];
  raw: unknown;
}

export interface AiProcessingRun {
  id: string;
  provider: "deepseek" | "deterministic";
  model: string;
  status: "ok" | "degraded" | "disabled";
  startedAt: string;
  completedAt: string;
  articleIds: string[];
  result: unknown;
  error?: string;
}

export interface WorkspaceTask {
  id: string;
  situationId: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

export interface WorkspaceNote {
  id: string;
  situationId: string;
  text: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  situationId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface SourceHealth {
  source: SourceId;
  label: string;
  state: "ok" | "degraded" | "disabled" | "awaiting_access";
  lastCheckedAt?: string;
  lastFailureAt?: string;
  nextPollAt?: string;
  detail: string;
}

export interface TrafficPulseCorridor {
  id: string;
  name: string;
  state: "free_flow" | "slow" | "congested" | "stale";
  travelTimeSeconds?: number;
  freeFlowSeconds?: number;
  delaySeconds?: number;
  delayRatio?: number;
  trend?: string;
  measurementFrom?: string;
  measurementTo?: string;
  updatedAt: string;
  sourceUrl: string;
}

export interface SituationWorkspace {
  situation: Situation;
  relatedArticles: Article[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  attachments: Attachment[];
}

export interface BootstrapPayload {
  articles: Article[];
  situations: Situation[];
  sourceHealth: SourceHealth[];
}

export interface ArticlePage {
  items: Article[];
  nextCursor?: string;
}

export interface SituationPage {
  items: Situation[];
  nextCursor?: string;
}

export interface OperationsStatus {
  sources: SourceHealth[];
  articleCount: number;
  situationCounts: Record<SituationLifecycle, number>;
  latestAiRun?: Pick<AiProcessingRun, "provider" | "model" | "status" | "completedAt" | "error">;
  latestCollectionAt?: string;
  trafficPulse?: TrafficPulseCorridor[];
  backup?: { status: "ok"; completedAt: string };
  restoreCheck?: { status: "ok"; completedAt: string };
}

export interface SessionPayload {
  user: { login: string; displayName: string; avatarUrl?: string };
  csrfToken: string;
}
