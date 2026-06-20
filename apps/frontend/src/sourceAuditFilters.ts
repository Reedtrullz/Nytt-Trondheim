import type {
  SourceAuditFilterQuery,
  SourceAuditProviderGroup,
  SourceAuditRole,
  SourceContractCheckStatus,
  SourceFreshnessState,
  SourceHealthState,
  SourceId,
  SourceReliabilityLevel,
} from "@nytt/shared";

export const sourceAuditSourceOptions = [
  { value: "nrk", label: "NRK" },
  { value: "adressa", label: "Adressa" },
  { value: "vg", label: "VG" },
  { value: "dagbladet", label: "Dagbladet" },
  { value: "trondheim_kommune", label: "Trondheim kommune" },
  { value: "bane_nor", label: "Bane NOR" },
  { value: "met", label: "MET" },
  { value: "nve", label: "NVE" },
  { value: "datex", label: "DATEX" },
  { value: "datex_travel_time", label: "Reisetid" },
  { value: "datex_weather", label: "Værstasjoner" },
  { value: "datex_cctv", label: "Kamera" },
  { value: "trafikkdata", label: "Trafikkdata" },
  { value: "vegvesen_traffic_info", label: "TrafficInfo" },
  { value: "entur", label: "Entur" },
  { value: "entur_vehicle_positions", label: "Kjøretøy" },
  { value: "entur_service_alerts", label: "Avvik" },
  { value: "dsb", label: "DSB" },
  { value: "politiloggen", label: "Politiloggen" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "internal", label: "Internt" },
  { value: "private_annotations", label: "Privat" },
] as const satisfies ReadonlyArray<{ value: SourceId; label: string }>;

export const sourceAuditGroupOptions = [
  { value: "media", label: "Medier" },
  { value: "datex", label: "Vegvesen" },
  { value: "entur", label: "Entur" },
  { value: "politiloggen", label: "Politi" },
  { value: "internal", label: "Internt" },
  { value: "private_annotation", label: "Privat" },
  { value: "other", label: "Andre" },
] as const satisfies ReadonlyArray<{ value: SourceAuditProviderGroup; label: string }>;

export const sourceAuditRoleOptions = [
  { value: "incident_source", label: "Hendelseskilde" },
  { value: "context_source", label: "Kontekst" },
  { value: "telemetry_source", label: "Telemetri" },
  { value: "internal_analysis", label: "Intern analyse" },
  { value: "private_annotation", label: "Privat markering" },
] as const satisfies ReadonlyArray<{ value: SourceAuditRole; label: string }>;

export const sourceAuditHealthOptions = [
  { value: "ok", label: "OK" },
  { value: "degraded", label: "Degradert" },
  { value: "disabled", label: "Avslått" },
  { value: "awaiting_access", label: "Venter" },
] as const satisfies ReadonlyArray<{ value: SourceHealthState; label: string }>;

export const sourceAuditFreshnessOptions = [
  { value: "fresh", label: "Fersk" },
  { value: "lagging", label: "Treg" },
  { value: "stale", label: "Utdatert" },
  { value: "unknown", label: "Ukjent" },
] as const satisfies ReadonlyArray<{ value: SourceFreshnessState; label: string }>;

export const sourceAuditReliabilityOptions = [
  { value: "good", label: "God" },
  { value: "watch", label: "Følg med" },
  { value: "poor", label: "Svak" },
  { value: "unknown", label: "Ukjent" },
] as const satisfies ReadonlyArray<{ value: SourceReliabilityLevel; label: string }>;

export const sourceAuditContractOptions = [
  { value: "pass", label: "Bestått" },
  { value: "warn", label: "Varsel" },
  { value: "fail", label: "Brudd" },
  { value: "not_applicable", label: "Ikke relevant" },
] as const satisfies ReadonlyArray<{ value: SourceContractCheckStatus; label: string }>;

export interface SourceAuditFilters extends SourceAuditFilterQuery {
  selectedSource?: SourceId;
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

const sourceValues = sourceAuditSourceOptions.map((option) => option.value);
const groupValues = sourceAuditGroupOptions.map((option) => option.value);
const roleValues = sourceAuditRoleOptions.map((option) => option.value);
const healthValues = sourceAuditHealthOptions.map((option) => option.value);
const freshnessValues = sourceAuditFreshnessOptions.map((option) => option.value);
const reliabilityValues = sourceAuditReliabilityOptions.map((option) => option.value);
const contractValues = sourceAuditContractOptions.map((option) => option.value);

export function parseSourceAuditFilters(search: string): SourceAuditFilters {
  const params = new URLSearchParams(search);
  const selectedSource = parseCsv(params, "detail", sourceValues)?.[0];
  return {
    sources: parseCsv(params, "sources", sourceValues),
    groups: parseCsv(params, "groups", groupValues),
    roles: parseCsv(params, "roles", roleValues),
    healthStates: parseCsv(params, "health", healthValues),
    freshnessStates: parseCsv(params, "fresh", freshnessValues),
    reliabilityLevels: parseCsv(params, "reliability", reliabilityValues),
    contractStatuses: parseCsv(params, "contract", contractValues),
    staleOnly: params.get("stale") === "true" || undefined,
    includeDiagnostics: params.get("diag") === "false" ? false : true,
    q: params.get("q")?.trim() || undefined,
    cursor: params.get("cursor")?.trim() || undefined,
    selectedSource,
  };
}

export function buildSourceAuditSearch(filters: SourceAuditFilters) {
  const params = new URLSearchParams();
  setCsv(params, "sources", filters.sources);
  setCsv(params, "groups", filters.groups);
  setCsv(params, "roles", filters.roles);
  setCsv(params, "health", filters.healthStates);
  setCsv(params, "fresh", filters.freshnessStates);
  setCsv(params, "reliability", filters.reliabilityLevels);
  setCsv(params, "contract", filters.contractStatuses);
  if (filters.staleOnly) params.set("stale", "true");
  if (filters.includeDiagnostics === false) params.set("diag", "false");
  if (filters.q) params.set("q", filters.q);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.selectedSource) params.set("detail", filters.selectedSource);
  return params.toString();
}

export function sourceAuditQueryFromFilters(filters: SourceAuditFilters): SourceAuditFilterQuery {
  return {
    sources: filters.sources,
    groups: filters.groups,
    roles: filters.roles,
    healthStates: filters.healthStates,
    freshnessStates: filters.freshnessStates,
    reliabilityLevels: filters.reliabilityLevels,
    contractStatuses: filters.contractStatuses,
    staleOnly: filters.staleOnly,
    includeDiagnostics: filters.includeDiagnostics ?? true,
    q: filters.q,
    cursor: filters.cursor,
    limit: 80,
  };
}

export function toggleAuditFilterValue<T extends string>(
  values: readonly T[] | undefined,
  value: T,
) {
  return values?.includes(value)
    ? values.filter((item) => item !== value)
    : [...(values ?? []), value];
}
