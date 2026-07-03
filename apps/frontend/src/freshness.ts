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

export function headerFreshnessLabel(sources: SourceHealth[], now = new Date()): string {
  const publicSources = sources.filter(
    (source) => !publicFreshnessHiddenSources.has(source.source),
  );
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
