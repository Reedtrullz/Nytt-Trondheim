import type { SourceHealth } from "@nytt/shared";

const freshnessWindowMs = 15 * 60 * 1000;
const timeFormatter = new Intl.DateTimeFormat("nb-NO", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

export function headerFreshnessLabel(sources: SourceHealth[], now = new Date()): string {
  const newest = sources
    .map((source) => (source.lastCheckedAt ? new Date(source.lastCheckedAt).getTime() : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  if (newest === undefined || !Number.isFinite(newest)) return "Oppdatering ukjent";

  const timestamp = new Date(newest);
  const prefix = now.getTime() - newest <= freshnessWindowMs ? "Oppdatert" : "Sist oppdatert";
  return `${prefix} ${timeFormatter.format(timestamp)}`;
}
