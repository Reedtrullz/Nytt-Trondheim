import type { Situation } from "@nytt/shared";

const osloDateTime = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Oslo",
});

export function formatSituationTimestamp(value: string) {
  return osloDateTime.format(new Date(value));
}

export function situationTimeMeta({
  createdAt,
  updatedAt,
}: Pick<Situation, "createdAt" | "updatedAt">) {
  return `Hendelsen startet ${formatSituationTimestamp(createdAt)} · Oppdatert ${formatSituationTimestamp(
    updatedAt,
  )}`;
}
