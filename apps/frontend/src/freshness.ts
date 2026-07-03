import type { SourceHealth } from "@nytt/shared";

const freshnessWindowMs = 15 * 60 * 1000;
const timeFormatter = new Intl.DateTimeFormat("nb-NO", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

function sourceAttentionText(count: number): string {
  return `${count} ${count === 1 ? "kilde" : "kilder"} trenger tilsyn`;
}

const publicFreshnessHiddenSources = new Set<SourceHealth["source"]>([
  "deepseek",
  "internal",
  "private_annotations",
  "web_push",
]);

const sourceStateLabels: Record<SourceHealth["state"], string> = {
  ok: "OK",
  degraded: "Delvis",
  disabled: "Pause",
  awaiting_access: "Avventer",
};

export interface PublicSourceHealthSummary {
  tone: "ok" | "attention" | "unknown";
  label: string;
  detail: string;
  freshnessLabel: string;
  publicSourceCount: number;
  attentionCount: number;
  hiddenSourceCount: number;
  sources: Array<Pick<SourceHealth, "source" | "label" | "state"> & { stateLabel: string }>;
}

function publicSourcesForFreshness(sources: SourceHealth[]): SourceHealth[] {
  return sources.filter((source) => !publicFreshnessHiddenSources.has(source.source));
}

export function headerFreshnessLabel(sources: SourceHealth[], now = new Date()): string {
  const publicSources = publicSourcesForFreshness(sources);
  const nonOkCount = publicSources.filter((source) => source.state !== "ok").length;
  const newest = publicSources
    .map((source) => (source.lastCheckedAt ? new Date(source.lastCheckedAt).getTime() : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  if (newest === undefined || !Number.isFinite(newest)) {
    return nonOkCount > 0 ? `Kildeavvik: ${sourceAttentionText(nonOkCount)}` : "Oppdatering ukjent";
  }

  const timestamp = new Date(newest);
  if (nonOkCount > 0) {
    return `Delvis oppdatert ${timeFormatter.format(timestamp)} · ${sourceAttentionText(nonOkCount)}`;
  }
  const prefix = now.getTime() - newest <= freshnessWindowMs ? "Oppdatert" : "Sist oppdatert";
  return `${prefix} ${timeFormatter.format(timestamp)}`;
}

export function publicSourceHealthSummary(
  sources: SourceHealth[],
  now = new Date(),
): PublicSourceHealthSummary {
  const publicSources = publicSourcesForFreshness(sources);
  const attentionSources = publicSources.filter((source) => source.state !== "ok");
  const freshnessLabel = headerFreshnessLabel(sources, now);
  const hiddenSourceCount = sources.length - publicSources.length;

  if (publicSources.length === 0) {
    return {
      tone: "unknown",
      label: "Kildestatus ukjent",
      detail: "Ingen åpne kilder rapporterer status i denne visningen.",
      freshnessLabel,
      publicSourceCount: 0,
      attentionCount: 0,
      hiddenSourceCount,
      sources: [],
    };
  }

  const tone = attentionSources.length ? "attention" : "ok";
  return {
    tone,
    label: attentionSources.length ? "Delvis kildegrunnlag" : "Kilder oppdatert",
    detail: attentionSources.length
      ? `${sourceAttentionText(attentionSources.length)} blant ${publicSources.length} åpne kilder.`
      : `Alle ${publicSources.length} åpne kilder rapporterer normal status.`,
    freshnessLabel,
    publicSourceCount: publicSources.length,
    attentionCount: attentionSources.length,
    hiddenSourceCount,
    sources: publicSources.slice(0, 6).map((source) => ({
      source: source.source,
      label: source.label,
      state: source.state,
      stateLabel: sourceStateLabels[source.state],
    })),
  };
}
