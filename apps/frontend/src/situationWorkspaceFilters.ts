import type {
  Provenance,
  SourceConfidenceLevel,
  SourceId,
  SituationLifecycle,
  WorkspaceMapQueryInput,
} from "@nytt/shared";

export const workspaceStatusOptions: Array<{ value: SituationLifecycle; label: string }> = [
  { value: "preliminary", label: "Foreløpig" },
  { value: "active", label: "Pågår" },
  { value: "resolved", label: "Avsluttet" },
  { value: "dismissed", label: "Avvist" },
];

export const workspaceSourceOptions: Array<{ value: SourceId; label: string }> = [
  { value: "nrk", label: "NRK" },
  { value: "adressa", label: "Adresseavisen" },
  { value: "trondheim_kommune", label: "Trondheim kommune" },
  { value: "met", label: "MET" },
  { value: "nve", label: "NVE" },
  { value: "datex", label: "DATEX" },
  { value: "politiloggen", label: "Politiloggen" },
  { value: "entur_service_alerts", label: "Entur avvik" },
];

export const workspaceProvenanceOptions: Array<{ value: Provenance; label: string }> = [
  { value: "official", label: "Offisiell" },
  { value: "reporting_estimate", label: "Anslag" },
  { value: "preparedness_context", label: "Kontekst" },
  { value: "private_annotation", label: "Privat" },
];

export const workspaceConfidenceOptions: Array<{ value: SourceConfidenceLevel; label: string }> = [
  { value: "confirmed", label: "Bekreftet" },
  { value: "likely", label: "Sannsynlig" },
  { value: "uncertain", label: "Usikker" },
  { value: "speculative", label: "Spekulativ" },
];

export interface SituationWorkspaceFilters {
  q: string;
  statuses: SituationLifecycle[];
  sources: SourceId[];
  provenances: Provenance[];
  confidenceLevels: SourceConfidenceLevel[];
  includePrivateAnnotations: boolean;
  selectedSituationId?: string;
}

const defaultStatuses: SituationLifecycle[] = ["preliminary", "active"];
const statusSet = new Set<SituationLifecycle>(workspaceStatusOptions.map((option) => option.value));
const sourceSet = new Set<SourceId>(workspaceSourceOptions.map((option) => option.value));
const provenanceSet = new Set<Provenance>(workspaceProvenanceOptions.map((option) => option.value));
const confidenceSet = new Set<SourceConfidenceLevel>(
  workspaceConfidenceOptions.map((option) => option.value),
);

function parseCsv<T extends string>(value: string | null, allowed: Set<T>): T[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is T => allowed.has(item as T));
}

function sameSet<T extends string>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function writeCsv<T extends string>(
  parameters: URLSearchParams,
  key: string,
  values: T[],
  defaults: T[] = [],
) {
  if (values.length > 0 && !sameSet(values, defaults)) parameters.set(key, values.join(","));
}

export function parseSituationWorkspaceFilters(search: string): SituationWorkspaceFilters {
  const parameters = new URLSearchParams(search);
  const statuses = parseCsv(parameters.get("status"), statusSet);
  return {
    q: (parameters.get("q") ?? "").trim(),
    statuses: statuses.length ? statuses : defaultStatuses,
    sources: parseCsv(parameters.get("sources"), sourceSet),
    provenances: parseCsv(parameters.get("provenance"), provenanceSet),
    confidenceLevels: parseCsv(parameters.get("confidence"), confidenceSet),
    includePrivateAnnotations: parameters.get("private") !== "false",
    selectedSituationId: parameters.get("s") ?? undefined,
  };
}

export function buildSituationWorkspaceSearch(filters: SituationWorkspaceFilters): string {
  const parameters = new URLSearchParams();
  const query = filters.q.trim();
  if (query) parameters.set("q", query);
  writeCsv(parameters, "status", filters.statuses, defaultStatuses);
  writeCsv(parameters, "sources", filters.sources);
  writeCsv(parameters, "provenance", filters.provenances);
  writeCsv(parameters, "confidence", filters.confidenceLevels);
  if (!filters.includePrivateAnnotations) parameters.set("private", "false");
  if (filters.selectedSituationId) parameters.set("s", filters.selectedSituationId);
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}

export function workspaceQueryFromFilters(
  filters: SituationWorkspaceFilters,
): WorkspaceMapQueryInput {
  return {
    statuses: filters.statuses,
    sources: filters.sources.length ? filters.sources : undefined,
    provenances: filters.provenances.length ? filters.provenances : undefined,
    confidenceLevels: filters.confidenceLevels.length ? filters.confidenceLevels : undefined,
    includePrivateAnnotations: filters.includePrivateAnnotations,
    q: filters.q || undefined,
  };
}

export function toggleFilterValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
