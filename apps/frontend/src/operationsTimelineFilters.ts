import type {
  OperationsTimelineEventKind,
  OperationsTimelineEventRole,
  OperationsTimelineEventSeverity,
  OperationsTimelineQuery,
  Provenance,
  SituationLifecycle,
  SourceId,
} from "@nytt/shared";

export const operationsTimelineKindOptions = [
  { value: "situation_update", label: "Situasjon" },
  { value: "source_update", label: "Kilde" },
  { value: "collector_run", label: "Worker" },
  { value: "review_action", label: "Vurdering" },
  { value: "status_change", label: "Status" },
  { value: "severity_change", label: "Alvorlighet" },
  { value: "merge_decision", label: "Fletting" },
  { value: "split_decision", label: "Deling" },
  { value: "stale_warning", label: "Utdatert kilde" },
  { value: "private_annotation", label: "Privat" },
] as const satisfies ReadonlyArray<{ value: OperationsTimelineEventKind; label: string }>;

export const operationsTimelineSourceOptions = [
  { value: "nrk", label: "NRK" },
  { value: "adressa", label: "Adressa" },
  { value: "datex", label: "DATEX" },
  { value: "datex_travel_time", label: "Reisetid" },
  { value: "datex_weather", label: "Værstasjoner" },
  { value: "datex_cctv", label: "Kamera" },
  { value: "trafikkdata", label: "Trafikkdata" },
  { value: "vegvesen_traffic_info", label: "TrafficInfo" },
  { value: "entur", label: "Entur" },
  { value: "entur_vehicle_positions", label: "Kjøretøy" },
  { value: "entur_service_alerts", label: "Avvik" },
  { value: "politiloggen", label: "Politiloggen" },
  { value: "internal", label: "Internt" },
  { value: "private_annotations", label: "Privat" },
] as const satisfies ReadonlyArray<{ value: SourceId; label: string }>;

export const operationsTimelineProvenanceOptions = [
  { value: "official", label: "Offisiell" },
  { value: "reporting_estimate", label: "Rapportering" },
  { value: "preparedness_context", label: "Kontekst" },
  { value: "private_annotation", label: "Privat" },
] as const satisfies ReadonlyArray<{ value: Provenance; label: string }>;

export const operationsTimelineStatusOptions = [
  { value: "preliminary", label: "Foreløpig" },
  { value: "active", label: "Aktiv" },
  { value: "resolved", label: "Løst" },
  { value: "dismissed", label: "Avvist" },
] as const satisfies ReadonlyArray<{ value: SituationLifecycle; label: string }>;

export const operationsTimelineSeverityOptions = [
  { value: "critical", label: "Kritisk" },
  { value: "warning", label: "Varsel" },
  { value: "info", label: "Info" },
  { value: "muted", label: "Lav" },
] as const satisfies ReadonlyArray<{ value: OperationsTimelineEventSeverity; label: string }>;

export const operationsTimelineRoleOptions = [
  { value: "incident", label: "Hendelse" },
  { value: "context", label: "Kontekst" },
  { value: "telemetry", label: "Telemetri" },
  { value: "private", label: "Privat" },
  { value: "system", label: "System" },
] as const satisfies ReadonlyArray<{ value: OperationsTimelineEventRole; label: string }>;

export interface OperationsTimelineFilters extends OperationsTimelineQuery {
  selectedEvent?: string;
  selectedSituation?: string;
}

function parseCsv<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]) {
  const values = params
    .get(key)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values?.length) return undefined;
  const allowedSet = new Set<string>(allowed);
  return values.filter((value): value is T => allowedSet.has(value));
}

function setCsv(params: URLSearchParams, key: string, values: readonly string[] | undefined) {
  if (values?.length) params.set(key, values.join(","));
}

function trimmedValue(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() || undefined;
}

const sourceValues = operationsTimelineSourceOptions.map((option) => option.value);
const provenanceValues = operationsTimelineProvenanceOptions.map((option) => option.value);
const kindValues = operationsTimelineKindOptions.map((option) => option.value);
const statusValues = operationsTimelineStatusOptions.map((option) => option.value);
const severityValues = operationsTimelineSeverityOptions.map((option) => option.value);
const roleValues = operationsTimelineRoleOptions.map((option) => option.value);

export function parseOperationsTimelineFilters(search: string): OperationsTimelineFilters {
  const params = new URLSearchParams(search);
  const selectedSituation = trimmedValue(params, "s");
  return {
    q: trimmedValue(params, "q"),
    sources: parseCsv(params, "sources", sourceValues),
    provenances: parseCsv(params, "provenance", provenanceValues),
    kinds: parseCsv(params, "kind", kindValues),
    statuses: parseCsv(params, "status", statusValues),
    severities: parseCsv(params, "severity", severityValues),
    roles: parseCsv(params, "role", roleValues),
    includePrivateAnnotations: params.get("private") === "false" ? false : true,
    from: trimmedValue(params, "from"),
    to: trimmedValue(params, "to"),
    cursor: trimmedValue(params, "cursor"),
    sort: params.get("sort") === "asc" ? "asc" : "desc",
    selectedSituation,
    selectedEvent: trimmedValue(params, "e"),
  };
}

export function buildOperationsTimelineSearch(filters: OperationsTimelineFilters) {
  const params = new URLSearchParams();
  setCsv(params, "sources", filters.sources);
  setCsv(params, "provenance", filters.provenances);
  setCsv(params, "kind", filters.kinds);
  setCsv(params, "status", filters.statuses);
  setCsv(params, "severity", filters.severities);
  setCsv(params, "role", filters.roles);
  if (filters.includePrivateAnnotations === false) params.set("private", "false");
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.q) params.set("q", filters.q);
  if (filters.selectedSituation) params.set("s", filters.selectedSituation);
  if (filters.selectedEvent) params.set("e", filters.selectedEvent);
  if (filters.sort === "asc") params.set("sort", "asc");
  return params.toString();
}

export function operationsTimelineQueryFromFilters(
  filters: OperationsTimelineFilters,
): OperationsTimelineQuery {
  return {
    sources: filters.sources,
    provenances: filters.provenances,
    kinds: filters.kinds,
    situationIds: filters.selectedSituation ? [filters.selectedSituation] : undefined,
    statuses: filters.statuses,
    severities: filters.severities,
    roles: filters.roles,
    includePrivateAnnotations: filters.includePrivateAnnotations ?? true,
    from: filters.from,
    to: filters.to,
    q: filters.q,
    cursor: filters.cursor,
    sort: filters.sort ?? "desc",
    limit: 100,
  };
}

export function toggleTimelineFilterValue<T extends string>(
  values: readonly T[] | undefined,
  value: T,
) {
  return values?.includes(value)
    ? values.filter((item) => item !== value)
    : [...(values ?? []), value];
}
