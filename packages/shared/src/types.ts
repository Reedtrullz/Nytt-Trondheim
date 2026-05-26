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
  | "dsb"
  | "politiloggen";

export type GeographicScope = "trondheim" | "trondelag";
export type ArticleCategory =
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
  | "weather"
  | "rescue"
  | "service_disruption"
  | "other";

export type SituationLifecycle = "preliminary" | "active" | "resolved";
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
  relatedArticleIds: string[];
  evidence: EvidenceItem[];
  features: MapFeature[];
  timeline: TimelineEntry[];
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
  detail: string;
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
