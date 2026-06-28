import type {
  SourceItem,
  SourceItemInput,
  SourceItemKind,
  SourceItemRecord,
  SourceItemRelationship,
  SourceReliabilityTier,
} from "../src/types.js";

const kind: SourceItemKind = "article";
const relationship: SourceItemRelationship = "supports";
const reliability: SourceReliabilityTier = "trusted_media";

const publicItem: SourceItem = {
  id: "source:article:nrk:one",
  provider: "nrk",
  kind,
  externalId: "article-one",
  originalUrl: "https://example.test/article-one",
  title: "Brann i Bymarka",
  summary: "Røyk observert ved Bymarka.",
  publishedAt: "2026-05-28T10:00:00.000Z",
  fetchedAt: "2026-05-28T10:01:00.000Z",
  captureHash: "a".repeat(64),
  inputHash: "b".repeat(64),
  geoHint: { type: "Point", coordinates: [10.3, 63.4] },
  reliabilityTier: reliability,
  role: "reporting",
  linkedSituationIds: ["skogbrann-bymarka"],
};

const internalRecord: SourceItemRecord = {
  ...publicItem,
  rawPayload: { id: "article-one" },
  normalizedPayload: { title: "Brann i Bymarka" },
};

const input: SourceItemInput = {
  id: internalRecord.id,
  provider: internalRecord.provider,
  kind: internalRecord.kind,
  externalId: internalRecord.externalId,
  originalUrl: internalRecord.originalUrl,
  title: internalRecord.title,
  summary: internalRecord.summary,
  publishedAt: internalRecord.publishedAt,
  fetchedAt: internalRecord.fetchedAt,
  rawPayload: internalRecord.rawPayload,
  normalizedPayload: internalRecord.normalizedPayload,
  captureHash: internalRecord.captureHash,
  inputHash: internalRecord.inputHash,
  geoHint: internalRecord.geoHint,
  reliabilityTier: internalRecord.reliabilityTier,
  role: internalRecord.role,
};

void relationship;
void input;
