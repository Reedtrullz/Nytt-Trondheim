import type {
  SourceId,
  SourceItemKind,
  SourceItemRelationship,
  SourceReliabilityTier,
} from "./types.js";

export const sourceIdLabels = {
  nrk: "NRK",
  adressa: "Adresseavisen",
  avisa_st: "Avisa Sør-Trøndelag",
  vg: "VG",
  dagbladet: "Dagbladet",
  trondheim_kommune: "Trondheim kommune",
  bane_nor: "Bane NOR",
  met: "MET",
  nve: "NVE / Varsom",
  datex: "Statens vegvesen DATEX",
  datex_travel_time: "DATEX reisetid",
  datex_weather: "Vegvesen værstasjoner",
  datex_cctv: "Vegvesen kamera",
  trafikkdata: "Trafikkdata",
  vegvesen_traffic_info: "Statens vegvesen trafikk",
  entur: "Entur",
  entur_vehicle_positions: "Entur kjøretøyposisjoner",
  entur_service_alerts: "Entur avvik",
  dsb: "DSB",
  politiloggen: "Politiloggen",
  internal: "Internt",
  private_annotations: "Private markeringer",
  deepseek: "Privat AI-analyse",
} as const satisfies Record<SourceId, string>;

export const sourceItemKindLabels = {
  article: "Nyhetssak",
  official_event: "Offisiell hendelse",
  warning: "Farevarsel",
  reporter_note: "Redaksjonell merknad",
  reader_tip: "Lesertips",
  media_asset: "Medieelement",
} as const satisfies Record<SourceItemKind, string>;

export const sourceReliabilityTierLabels = {
  official: "Offisiell",
  trusted_media: "Redaksjonell kilde",
  internal: "Internt",
  unverified: "Ubekreftet",
} as const satisfies Record<SourceReliabilityTier, string>;

export const sourceItemRelationshipLabels = {
  supports: "Underbygger",
  contradicts: "Motsier",
  context: "Kontekst",
  duplicate: "Duplikat",
} as const satisfies Record<SourceItemRelationship, string>;

export function sourceIdLabel(source: SourceId | string): string {
  return sourceIdLabels[source as SourceId] ?? source;
}

export function sourceItemKindLabel(kind: SourceItemKind | string): string {
  return sourceItemKindLabels[kind as SourceItemKind] ?? kind;
}

export function sourceReliabilityTierLabel(tier: SourceReliabilityTier | string): string {
  return sourceReliabilityTierLabels[tier as SourceReliabilityTier] ?? tier;
}

export function sourceItemRelationshipLabel(relationship: SourceItemRelationship | string): string {
  return sourceItemRelationshipLabels[relationship as SourceItemRelationship] ?? relationship;
}
