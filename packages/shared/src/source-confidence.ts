import {
  sourceConfidenceLabels,
  type SourceConfidenceLevel,
  type SourceConfidenceSummary,
  type SourceId,
} from "./types.js";
import type { TrafficMapEventSource } from "./traffic-map.js";

export type SourceConfidenceSource = SourceId | TrafficMapEventSource | string;

type SourceConfidenceTier = "official" | "trusted_media" | "context" | "private" | "unknown";

export interface SourceConfidenceSignal {
  source: SourceConfidenceSource;
  tier: SourceConfidenceTier;
  weight: number;
}

export interface SourceMixConfidenceOptions {
  updatedAt?: string;
}

const officialSources = new Set<SourceConfidenceSource>([
  "datex",
  "vegvesen_traffic_info",
  "politiloggen",
  "trondheim_kommune",
  "met",
  "nve",
  "bane_nor",
  "dsb",
]);

const trustedMediaSources = new Set<SourceConfidenceSource>([
  "nrk",
  "adressa",
  "avisa_st",
  "snasningen",
  "merakerposten",
  "frostingen",
  "ytringen",
  "steinkjer_avisa",
  "innherred",
  "namdalsavisa",
  "malviknytt",
  "selbyggen",
  "fjell_ljom",
  "retten",
  "hitra_froya",
  "tronderbladet",
  "nidaros",
  "t_a",
  "vg",
  "dagbladet",
  "news_article",
]);

const contextSources = new Set<SourceConfidenceSource>([
  "datex_travel_time",
  "datex_weather",
  "datex_cctv",
  "trafikkdata",
  "entur",
  "entur_vehicle_positions",
  "entur_service_alerts",
]);

const privateSources = new Set<SourceConfidenceSource>([
  "deepseek",
  "internal",
  "private_annotations",
]);

const tierWeights: Record<SourceConfidenceTier, number> = {
  official: 0.88,
  trusted_media: 0.64,
  context: 0.46,
  private: 0.32,
  unknown: 0.22,
};

export function sourceConfidenceLevelFromScore(score?: number): SourceConfidenceLevel {
  if (score === undefined || !Number.isFinite(score)) return "uncertain";
  if (score >= 0.85) return "confirmed";
  if (score >= 0.65) return "likely";
  if (score >= 0.35) return "uncertain";
  return "speculative";
}

export function sourceConfidenceSignal(source: SourceConfidenceSource): SourceConfidenceSignal {
  const tier: SourceConfidenceTier = officialSources.has(source)
    ? "official"
    : trustedMediaSources.has(source)
      ? "trusted_media"
      : contextSources.has(source)
        ? "context"
        : privateSources.has(source)
          ? "private"
          : "unknown";
  return {
    source,
    tier,
    weight: tierWeights[tier],
  };
}

function sourceMixRationale(signals: SourceConfidenceSignal[]): string {
  const tiers = new Set(signals.map((signal) => signal.tier));
  const officialCount = signals.filter((signal) => signal.tier === "official").length;
  const mediaCount = signals.filter((signal) => signal.tier === "trusted_media").length;
  const contextCount = signals.filter((signal) => signal.tier === "context").length;

  if (officialCount > 0 && mediaCount > 0) {
    return "Offisielle kilder og redaksjonelle kilder peker mot samme område.";
  }
  if (officialCount > 1) {
    return "Flere offisielle kilder peker mot samme område.";
  }
  if (officialCount > 0) {
    return "Offisiell kilde gir det sterkeste signalet.";
  }
  if (mediaCount > 1) {
    return "Flere redaksjonelle kilder peker mot samme område.";
  }
  if (mediaCount > 0 && contextCount > 0) {
    return "Redaksjonell dekning støttes av kontekstsignaler.";
  }
  if (mediaCount > 0) {
    return "Bygget på redaksjonell dekning uten offisiell bekreftelse.";
  }
  if (contextCount > 0 && tiers.size === 1) {
    return "Kontekst- og telemetrikilder alene gir et forsiktig signal.";
  }
  return "Kildegrunnlaget er svakt eller internt og må tolkes forsiktig.";
}

export function sourceMixConfidenceSummary(
  sources: SourceConfidenceSource[],
  options: SourceMixConfidenceOptions = {},
): SourceConfidenceSummary {
  const uniqueSources = [...new Set(sources.filter((source) => source.trim().length > 0))];
  if (uniqueSources.length === 0) {
    return {
      level: "uncertain",
      label: sourceConfidenceLabels.uncertain,
      score: 0,
      sourceCount: 0,
      rationale: "Ingen kilder er koblet til signalet.",
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
    };
  }

  const signals = uniqueSources.map(sourceConfidenceSignal);
  const maxWeight = Math.max(...signals.map((signal) => signal.weight));
  const tiers = new Set(signals.map((signal) => signal.tier));
  const diversityBonus = Math.min(0.08, Math.max(0, uniqueSources.length - 1) * 0.025);
  const crossTierBonus = tiers.has("official") && tiers.has("trusted_media") ? 0.08 : 0;
  const mediaDepthBonus =
    signals.filter((signal) => signal.tier === "trusted_media").length > 1 ? 0.04 : 0;
  const score = Math.min(0.98, maxWeight + diversityBonus + crossTierBonus + mediaDepthBonus);
  const roundedScore = Math.round(score * 100) / 100;
  const level = sourceConfidenceLevelFromScore(roundedScore);

  return {
    level,
    label: sourceConfidenceLabels[level],
    score: roundedScore,
    sourceCount: uniqueSources.length,
    rationale: sourceMixRationale(signals),
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  };
}
