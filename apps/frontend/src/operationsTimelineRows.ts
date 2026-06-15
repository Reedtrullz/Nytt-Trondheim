import {
  operationsTimelineEventKindLabels,
  provenanceLabels,
  sourceConfidenceLabels,
  type OperationsTimelineEvent,
  type OperationsTimelineEventRole,
  type OperationsTimelineEventSeverity,
  type SituationLifecycle,
} from "@nytt/shared";

const osloDayFormatter = new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "full",
  timeZone: "Europe/Oslo",
});

const osloDateKeyFormatter = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeZone: "Europe/Oslo",
});

export const osloTimeFormatter = new Intl.DateTimeFormat("nb-NO", {
  timeStyle: "short",
  timeZone: "Europe/Oslo",
});

export function osloDayKey(value: string) {
  return osloDateKeyFormatter.format(new Date(value));
}

export function osloDayLabel(value: string) {
  return osloDayFormatter.format(new Date(value));
}

export interface OperationsTimelineDayGroup {
  key: string;
  label: string;
  events: OperationsTimelineEvent[];
}

export function groupOperationsTimelineEvents(
  events: OperationsTimelineEvent[],
): OperationsTimelineDayGroup[] {
  const groups = new Map<string, OperationsTimelineDayGroup>();
  for (const event of events) {
    const key = osloDayKey(event.timestamp);
    const group = groups.get(key) ?? { key, label: osloDayLabel(event.timestamp), events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function operationsTimelineKindLabel(kind: OperationsTimelineEvent["kind"]) {
  return operationsTimelineEventKindLabels[kind];
}

export function operationsTimelineSeverityLabel(severity: OperationsTimelineEventSeverity) {
  const labels: Record<OperationsTimelineEventSeverity, string> = {
    critical: "Kritisk",
    warning: "Varsel",
    info: "Info",
    muted: "Lav",
  };
  return labels[severity];
}

export function operationsTimelineRoleLabel(role: OperationsTimelineEventRole) {
  const labels: Record<OperationsTimelineEventRole, string> = {
    incident: "Hendelse",
    context: "Kontekst",
    telemetry: "Telemetri",
    private: "Privat",
    system: "System",
  };
  return labels[role];
}

export function operationsTimelineStatusLabel(status?: SituationLifecycle) {
  if (!status) return "Uten status";
  const labels: Record<SituationLifecycle, string> = {
    preliminary: "Foreløpig",
    active: "Aktiv",
    resolved: "Løst",
    dismissed: "Avvist",
  };
  return labels[status];
}

export function operationsTimelineConfidenceLabel(event: OperationsTimelineEvent) {
  const level = event.confidence?.level ?? "uncertain";
  return event.confidence?.label ?? sourceConfidenceLabels[level];
}

export function operationsTimelineProvenanceLabel(event: OperationsTimelineEvent) {
  return event.provenance ? provenanceLabels[event.provenance] : "Uten proveniens";
}
