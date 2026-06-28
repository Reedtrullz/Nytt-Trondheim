import type { ArticleCategory, SourceId, Situation, SituationType } from "./types.js";

export type ActivationSourceRole =
  | "activating_official"
  | "corroborating_official"
  | "reporting"
  | "context"
  | "telemetry"
  | "private"
  | "ignored";

export type ActivationDecision =
  | "no_situation"
  | "preliminary"
  | "active"
  | "official_event"
  | "context"
  | "resolved"
  | "dismissed"
  | "source_health_alert"
  | "no_effect"
  | "two_situations"
  | "no_loss_of_integrity"
  | "analyze";

export type ActivationRuleId =
  | "two_independent_reporting_sources"
  | "official_high_impact_exception"
  | "official_corroboration"
  | "official_resolution"
  | "context_only_source"
  | "telemetry_only_source"
  | "place_too_generic"
  | "place_outside_aoi"
  | "stale_or_duplicate"
  | "official_denial"
  | "private_not_causal"
  | "ai_not_causal"
  | "source_health_only";

export interface ActivationSourceContractTemplateColumn {
  key: string;
  label: string;
  required: boolean;
  guidance: string;
}

export const activationSourceContractTemplate = [
  {
    key: "sourceId",
    label: "SourceId",
    required: true,
    guidance: "Stabil intern kilde-ID fra SourceId-unionen.",
  },
  {
    key: "endpoint",
    label: "Endpoint / URL",
    required: true,
    guidance: "Publisert endepunkt, RSS eller API-URL. Ikke lagre hemmeligheter her.",
  },
  {
    key: "kind",
    label: "Kind",
    required: true,
    guidance: "RSS, JSON API, XML/DATEX, GraphQL, OGC eller intern avledet analyse.",
  },
  {
    key: "license",
    label: "Lisens / vilkar",
    required: true,
    guidance: "NLOD, CC BY, redaksjonelle vilkar eller intern begrensning.",
  },
  {
    key: "canActivate",
    label: "Kan aktivere?",
    required: true,
    guidance: "Ja, nei, eller kun som offisiell unntaksregel. Forklar terskelen.",
  },
  {
    key: "activationRole",
    label: "Aktiveringsrolle",
    required: true,
    guidance:
      "activating_official, corroborating_official, reporting, context, telemetry, private eller ignored.",
  },
  {
    key: "pollingInterval",
    label: "Polling",
    required: true,
    guidance: "Normal frekvens, If-Modified-Since/ETag og backoff-regel.",
  },
  {
    key: "retention",
    label: "Retensjon",
    required: true,
    guidance: "Hvor lenge metadata, rånyttelast og auditspor beholdes.",
  },
  {
    key: "forbiddenData",
    label: "Forbudte felt",
    required: true,
    guidance: "F.eks. full artikkeltekst, bilder, personnavn, bilskilt eller interne notater.",
  },
  {
    key: "fixtures",
    label: "Testfiksturer",
    required: true,
    guidance: "Minst en normal, en tom/utdatert, en duplikat og en feilformatert payload.",
  },
] as const satisfies ActivationSourceContractTemplateColumn[];

export interface SourceActivationPolicy {
  source: SourceId | "coverage_bundles";
  label: string;
  role: ActivationSourceRole;
  canCreateSourceItems: boolean;
  canCreateSituations: boolean;
  allowedRelationships: Array<"supports" | "contradicts" | "context" | "duplicate">;
  rule: string;
}

export const sourceActivationPolicies = [
  {
    source: "nrk",
    label: "NRK Trondelag",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "adressa",
    label: "Adresseavisen",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "avisa_st",
    label: "Avisa Sor-Trondelag",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "snasningen",
    label: "Snasningen",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "merakerposten",
    label: "Merakerposten",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "frostingen",
    label: "Frostingen",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "ytringen",
    label: "Ytringen",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "steinkjer_avisa",
    label: "Steinkjer-Avisa",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "innherred",
    label: "Innherred",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "namdalsavisa",
    label: "Namdalsavisa",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "malviknytt",
    label: "Malviknytt",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "selbyggen",
    label: "Selbyggen",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "fjell_ljom",
    label: "Fjell-Ljom",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "retten",
    label: "Arbeidets Rett",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "hitra_froya",
    label: "Hitra-Froya",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "tronderbladet",
    label: "Tronderbladet",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "nidaros",
    label: "Nidaros",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "t_a",
    label: "Tronder-Avisa",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "vg",
    label: "VG",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "dagbladet",
    label: "Dagbladet",
    role: "reporting",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Kan bare aktivere sammen med en uavhengig kilde og et spesifikt felles sted.",
  },
  {
    source: "trondheim_kommune",
    label: "Trondheim kommune",
    role: "corroborating_official",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["supports", "context", "contradicts"],
    rule: "Kan bekrefte eller avklare en allerede spesifikk hendelse; generelle saker er kontekst.",
  },
  {
    source: "politiloggen",
    label: "Politiloggen",
    role: "activating_official",
    canCreateSourceItems: true,
    canCreateSituations: true,
    allowedRelationships: ["supports", "contradicts", "duplicate"],
    rule: "Aktive polititrader kan aktivere offisielle situasjoner; inaktive trader loser eller ignoreres.",
  },
  {
    source: "datex",
    label: "Statens vegvesen DATEX",
    role: "activating_official",
    canCreateSourceItems: true,
    canCreateSituations: true,
    allowedRelationships: ["supports", "context", "duplicate"],
    rule: "Bare matrise-godkjente hoy-impact hendelser kan aktivere; lav-impact og planlagt arbeid er kontekst.",
  },
  {
    source: "vegvesen_traffic_info",
    label: "Statens vegvesen TrafficInfo",
    role: "context",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context", "duplicate"],
    rule: "Persistente trafikkkartobjekter og offisiell kontekst; ikke situasjonsaktivator i v1.",
  },
  {
    source: "met",
    label: "MET farevarsel",
    role: "context",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Farevarsel er beredskapskontekst og bekrefter ikke at en lokal hendelse har skjedd.",
  },
  {
    source: "nve",
    label: "NVE / Varsom",
    role: "context",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Flom- og skredvarsel er beredskapskontekst og bekrefter ikke lokal hendelse alene.",
  },
  {
    source: "datex_travel_time",
    label: "DATEX reisetid",
    role: "telemetry",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Reisetid viser trafikkflyt, ikke en diskret hendelse.",
  },
  {
    source: "datex_weather",
    label: "Vegvesen vaerstasjoner",
    role: "telemetry",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Sensorobservasjoner er kartkontekst og kildehelse, ikke hendelsesbevis.",
  },
  {
    source: "datex_cctv",
    label: "Vegvesen kamera",
    role: "telemetry",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Kameraoversikt er operativ kontekst og skal ikke aktivere eller bekrefte.",
  },
  {
    source: "trafikkdata",
    label: "Trafikkdata",
    role: "telemetry",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Tellepunktdata beskriver volum og skal aldri skape kildebevis.",
  },
  {
    source: "entur_vehicle_positions",
    label: "Entur kjoretoyposisjoner",
    role: "telemetry",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Sanntidsposisjoner er kartlag og kildehelse, ikke hendelsesbevis.",
  },
  {
    source: "entur",
    label: "Entur service alerts",
    role: "context",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context", "duplicate"],
    rule: "Kollektivavvik kan vises som offisiell mobilitetskontekst, men aktiverer ikke situasjonsrom.",
  },
  {
    source: "entur_service_alerts",
    label: "Entur service alerts",
    role: "context",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context", "duplicate"],
    rule: "Alias for Entur-avvik; ikke situasjonsaktivator.",
  },
  {
    source: "bane_nor",
    label: "Bane NOR trafikkmeldinger",
    role: "context",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context", "duplicate"],
    rule: "Jernbanemeldinger er mobilitetskontekst til en senere eksplisitt promotering finnes.",
  },
  {
    source: "dsb",
    label: "DSB kartgrunnlag",
    role: "telemetry",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Kartgrunnlag og beredskapslag er health/context only.",
  },
  {
    source: "internal",
    label: "Internt system",
    role: "ignored",
    canCreateSourceItems: true,
    canCreateSituations: false,
    allowedRelationships: ["context", "duplicate"],
    rule: "Interne avledninger kan forklare, men ikke erstatte kildebevis.",
  },
  {
    source: "private_annotations",
    label: "Private markeringer",
    role: "private",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "Private notater er aldri offentlig kildebevis.",
  },
  {
    source: "deepseek",
    label: "Privat AI-analyse",
    role: "ignored",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["context"],
    rule: "AI kan oppsummere etter at deterministiske regler kvalifiserer; AI aktiverer aldri.",
  },
  {
    source: "coverage_bundles",
    label: "Dekningsbunter",
    role: "ignored",
    canCreateSourceItems: false,
    canCreateSituations: false,
    allowedRelationships: ["duplicate"],
    rule: "Avledet analyse; brukes til observabilitet og grupperingsforklaring, ikke kildebevis.",
  },
] as const satisfies SourceActivationPolicy[];

function isSourceId(source: SourceId | "coverage_bundles"): source is SourceId {
  return source !== "coverage_bundles";
}

export const contextOnlyActivationSources: SourceId[] = sourceActivationPolicies
  .filter((policy) => policy.role === "context" || policy.role === "telemetry")
  .map((policy) => policy.source)
  .filter(isSourceId);

export const telemetryOnlySources: SourceId[] = sourceActivationPolicies
  .filter((policy) => policy.role === "telemetry")
  .map((policy) => policy.source)
  .filter(isSourceId);

export function activationPolicyForSource(
  source: SourceId | "coverage_bundles",
): SourceActivationPolicy {
  return (
    sourceActivationPolicies.find((policy) => policy.source === source) ?? {
      source,
      label: source,
      role: "ignored",
      canCreateSourceItems: false,
      canCreateSituations: false,
      allowedRelationships: ["context"],
      rule: "Ukjent kilde er ikke aktiverende for den er kontraktsfestet.",
    }
  );
}

export type DatexPromotionAction = "official_situation" | "context_only" | "ignore";

export interface DatexPromotionMatrixRow {
  recordKind: string;
  example: string;
  action: DatexPromotionAction;
  rule: string;
}

export const datexPromotionMatrix = [
  {
    recordKind: "Accident",
    example: "Trafikkulykke med stengt felt eller personskade pa E6",
    action: "official_situation",
    rule: "Promoter nar DATEX impact er high eller teksten beskriver stengt veg/felt/personskade.",
  },
  {
    recordKind: "Obstruction",
    example: "Havarert kjoretoy eller hindring som blokkerer felt",
    action: "official_situation",
    rule: "Promoter bare nar hindringen stenger veg/felt eller har high impact.",
  },
  {
    recordKind: "EnvironmentalObstruction",
    example: "Steinskred, flom eller dyr i vegbanen",
    action: "official_situation",
    rule: "Promoter naturfare nar vegen er stengt eller impact er high; dyr/lav alvorlighet er kontekst.",
  },
  {
    recordKind: "RoadOrCarriagewayOrLaneManagement",
    example: "Akutt stenging eller manuell dirigering",
    action: "official_situation",
    rule: "Promoter akutt/uplanlagt stenging; planlagt styring er kontekst.",
  },
  {
    recordKind: "MaintenanceWorks",
    example: "Planlagt vegarbeid eller kantklipp",
    action: "context_only",
    rule: "Planlagt arbeid er trafikkontekst, ikke situasjonsrom.",
  },
  {
    recordKind: "Roadworks",
    example: "Nattarbeid med omkjoring",
    action: "context_only",
    rule: "Behold i trafikkartet og som kontekst; ikke automatisk situasjon.",
  },
  {
    recordKind: "NetworkManagement",
    example: "Omkjoring skiltet for en annen hovedhendelse",
    action: "context_only",
    rule: "Kan inngaa som evidensdel i samme DATEX-situasjon, men skal ikke bli egen situasjon.",
  },
  {
    recordKind: "ReroutingManagement",
    example: "Omkjoring er skiltet",
    action: "context_only",
    rule: "Knyttes til primar DATEX-hendelse via situationId; ikke egen aktivator.",
  },
  {
    recordKind: "TravelTimeMeasurement",
    example: "Reisetid +10 minutter",
    action: "ignore",
    rule: "Reisetid er telemetry/context only og skal ikke inn i source_items.",
  },
  {
    recordKind: "Unknown",
    example: "Ukjent eller uparsbar DATEX-type",
    action: "ignore",
    rule: "Logg parser/source-health og ignorer til kontrakt er oppdatert.",
  },
] as const satisfies DatexPromotionMatrixRow[];

export interface ActivationRegressionFixture {
  id: number;
  name: string;
  category:
    | "media"
    | "official"
    | "datex"
    | "warning"
    | "telemetry"
    | "place"
    | "lifecycle"
    | "ai"
    | "audit"
    | "sports";
  sources: Array<SourceId | "coverage_bundles" | "external_blog" | "social_media">;
  expected: ActivationDecision;
  rule: ActivationRuleId;
  notes: string;
  articleCategory?: ArticleCategory;
  situationType?: SituationType;
}

export const activationRegressionFixtures = [
  {
    id: 1,
    name: "En redaksjonell sak om mindre ulykke",
    category: "media",
    sources: ["adressa"],
    expected: "no_situation",
    rule: "two_independent_reporting_sources",
    notes: "En kilde alene er kandidat, ikke situasjon.",
    situationType: "traffic",
  },
  {
    id: 2,
    name: "Adresseavisen og NRK om samme kollisjon pa Tiller",
    category: "media",
    sources: ["adressa", "nrk"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "To uavhengige redaksjoner og spesifikt sted.",
    situationType: "traffic",
  },
  {
    id: 3,
    name: "To medier bruker Tillerveien og Tillerkrysset om samme ulykke",
    category: "place",
    sources: ["adressa", "nrk"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "Lokale aliaser/geokoding kan samle nar hendelsestype og tid matcher.",
    situationType: "traffic",
  },
  {
    id: 4,
    name: "Lav-impact Politiloggen om savnet person",
    category: "official",
    sources: ["politiloggen"],
    expected: "no_situation",
    rule: "official_high_impact_exception",
    notes: "Offisiell kilde alene ma vaere kvalifisert hoy-impact.",
    situationType: "missing_person",
  },
  {
    id: 5,
    name: "Politiloggen personskadeulykke pa E6",
    category: "official",
    sources: ["politiloggen"],
    expected: "official_event",
    rule: "official_high_impact_exception",
    notes: "Hoy-impact politiloggen aktiverer offisielt.",
    situationType: "traffic",
  },
  {
    id: 6,
    name: "NRK brann og Politiloggen bekrefter",
    category: "official",
    sources: ["nrk", "politiloggen"],
    expected: "official_event",
    rule: "official_corroboration",
    notes: "Rapportering pluss offisiell bekreftelse.",
    situationType: "fire",
  },
  {
    id: 7,
    name: "Politiloggen og DATEX bekrefter samme trafikkulykke",
    category: "official",
    sources: ["politiloggen", "datex"],
    expected: "official_event",
    rule: "official_corroboration",
    notes: "To offisielle kilder med felles sted.",
    situationType: "traffic",
  },
  {
    id: 8,
    name: "DATEX alvorlig ulykke alene",
    category: "datex",
    sources: ["datex"],
    expected: "official_event",
    rule: "official_high_impact_exception",
    notes: "Matrise: Accident/high.",
    situationType: "traffic",
  },
  {
    id: 9,
    name: "DATEX mindre ulykke alene",
    category: "datex",
    sources: ["datex"],
    expected: "context",
    rule: "official_high_impact_exception",
    notes: "Lav-impact uten stenging holdes i trafikkontekst.",
    situationType: "traffic",
  },
  {
    id: 10,
    name: "DATEX vegarbeid og nyhet om ko",
    category: "datex",
    sources: ["datex", "adressa"],
    expected: "context",
    rule: "context_only_source",
    notes: "Planlagt vegarbeid aktiverer ikke selv med omtale.",
    situationType: "traffic",
  },
  {
    id: 11,
    name: "DATEX TravelTime-spike alene",
    category: "telemetry",
    sources: ["datex_travel_time"],
    expected: "no_situation",
    rule: "telemetry_only_source",
    notes: "Reisetid er telemetry.",
    situationType: "traffic",
  },
  {
    id: 12,
    name: "Nyhet om stenging og DATEX akutt stenging",
    category: "datex",
    sources: ["adressa", "datex"],
    expected: "official_event",
    rule: "official_corroboration",
    notes: "Akutt stenging kan bekrefte trafikkhendelse.",
    situationType: "traffic",
  },
  {
    id: 13,
    name: "Dekningsbunt som kilde",
    category: "audit",
    sources: ["coverage_bundles"],
    expected: "no_situation",
    rule: "ai_not_causal",
    notes: "Avledet analyse er aldri kildebevis.",
  },
  {
    id: 14,
    name: "Duplikat av samme Adresseavisen-artikkel",
    category: "media",
    sources: ["adressa", "adressa"],
    expected: "no_situation",
    rule: "stale_or_duplicate",
    notes: "Samme provider/input_hash teller ikke som uavhengig.",
  },
  {
    id: 15,
    name: "Bare Trondelag i artikkelen",
    category: "place",
    sources: ["dagbladet"],
    expected: "no_situation",
    rule: "place_too_generic",
    notes: "Region er ikke stedfestet hendelse.",
  },
  {
    id: 16,
    name: "Uoffisiell sosial melding om Sentrum",
    category: "media",
    sources: ["social_media"],
    expected: "no_situation",
    rule: "place_too_generic",
    notes: "Ukontrahert sosial kilde kan ikke aktivere.",
  },
  {
    id: 17,
    name: "Lokalavis og ekstern blogg om brann",
    category: "media",
    sources: ["adressa", "external_blog"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "Kun hvis blogg senere kontraktsfestes; ellers avvises av ukjent-kilde-regel.",
    situationType: "fire",
  },
  {
    id: 18,
    name: "Offisiell avkreftelse etter eksplosjonsrykte",
    category: "lifecycle",
    sources: ["nrk", "politiloggen"],
    expected: "dismissed",
    rule: "official_denial",
    notes: "Offisiell motmelding avviser kandidat.",
    situationType: "other",
  },
  {
    id: 19,
    name: "AI sammendrag finner pa ny hendelse",
    category: "ai",
    sources: ["deepseek"],
    expected: "no_situation",
    rule: "ai_not_causal",
    notes: "AI uten kildebevis ignoreres.",
  },
  {
    id: 20,
    name: "MET gult vindvarsel alene",
    category: "warning",
    sources: ["met"],
    expected: "no_situation",
    rule: "context_only_source",
    notes: "Farevarsel er kontekst.",
    situationType: "weather",
  },
  {
    id: 21,
    name: "NVE flomvarsel alene",
    category: "warning",
    sources: ["nve"],
    expected: "no_situation",
    rule: "context_only_source",
    notes: "Varsel er ikke lokal hendelse.",
    situationType: "flood",
  },
  {
    id: 22,
    name: "MET rodt varsel og nyhet om trar over veg",
    category: "warning",
    sources: ["met", "adressa"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "Varsel er kontekst; nyheten ma ha egen bekreftelse for aktiv situasjon.",
    situationType: "weather",
  },
  {
    id: 23,
    name: "TravelTime forsinkelse uten hendelse",
    category: "telemetry",
    sources: ["datex_travel_time"],
    expected: "no_situation",
    rule: "telemetry_only_source",
    notes: "Ko alene er ikke diskret hendelse.",
    situationType: "traffic",
  },
  {
    id: 24,
    name: "TravelTime og blogg om ko",
    category: "telemetry",
    sources: ["datex_travel_time", "external_blog"],
    expected: "no_situation",
    rule: "telemetry_only_source",
    notes: "Telemetry kan ikke bli uavhengig kilde.",
    situationType: "traffic",
  },
  {
    id: 25,
    name: "Tips i sosiale medier og NRK om lysstolpe pa Lade",
    category: "media",
    sources: ["social_media", "nrk"],
    expected: "no_situation",
    rule: "two_independent_reporting_sources",
    notes: "Sosiale medier er ikke kontraktsfestet i v1.",
    situationType: "traffic",
  },
  {
    id: 26,
    name: "Adresseavisen sier bare Sentrum",
    category: "place",
    sources: ["adressa"],
    expected: "no_situation",
    rule: "place_too_generic",
    notes: "Bare sentrum uten Trondheim/konkret objekt er for svakt.",
  },
  {
    id: 27,
    name: "Samme kollisjon omtalt tre timer senere",
    category: "media",
    sources: ["adressa", "nrk"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "Innen 12 timer kan samme hendelse samles.",
    situationType: "traffic",
  },
  {
    id: 28,
    name: "To nyheter om gasslekkasje med generisk Trondheim",
    category: "place",
    sources: ["vg", "dagbladet"],
    expected: "no_situation",
    rule: "place_too_generic",
    notes: "Alvorlig type hjelper ikke uten spesifikt sted.",
    situationType: "other",
  },
  {
    id: 29,
    name: "Samme sted neste dag",
    category: "lifecycle",
    sources: ["adressa", "nrk"],
    expected: "two_situations",
    rule: "stale_or_duplicate",
    notes: "Ny dag uten kontinuitet er ny hendelse.",
    situationType: "traffic",
  },
  {
    id: 30,
    name: "Gammel cached brannartikkel",
    category: "lifecycle",
    sources: ["adressa"],
    expected: "no_situation",
    rule: "stale_or_duplicate",
    notes: "Utenfor vindu/retensjon brukes ikke.",
    situationType: "fire",
  },
  {
    id: 31,
    name: "DATEX ulykke forsvinner fra snapshot",
    category: "lifecycle",
    sources: ["datex"],
    expected: "resolved",
    rule: "official_resolution",
    notes: "Ferskt snapshot uten posten loser DATEX-situasjon.",
    situationType: "traffic",
  },
  {
    id: 32,
    name: "Privat operatornotat",
    category: "audit",
    sources: ["private_annotations"],
    expected: "no_situation",
    rule: "private_not_causal",
    notes: "Private notater er ikke offentlig evidens.",
  },
  {
    id: 33,
    name: "Politiloggen pluss AI legger til stengte gater",
    category: "ai",
    sources: ["politiloggen", "deepseek"],
    expected: "no_situation",
    rule: "ai_not_causal",
    notes: "AI-pastand uten kilde ignoreres; politiloggen vurderes etter egen terskel.",
  },
  {
    id: 34,
    name: "Adresseavisen nede og kommer tilbake",
    category: "audit",
    sources: ["adressa"],
    expected: "source_health_alert",
    rule: "source_health_only",
    notes: "Kildehelse endres; situasjonslogikk uendret.",
  },
  {
    id: 35,
    name: "MET forsinket 60 minutter",
    category: "warning",
    sources: ["met"],
    expected: "source_health_alert",
    rule: "source_health_only",
    notes: "Degrader kildehelse; ikke aktiver.",
  },
  {
    id: 36,
    name: "Duplikat DATEX-ID",
    category: "datex",
    sources: ["datex", "datex"],
    expected: "official_event",
    rule: "stale_or_duplicate",
    notes: "Samles som en situasjon via upstream situationId.",
    situationType: "traffic",
  },
  {
    id: 37,
    name: "Artikkel korrigerer Nydalen til Nardo",
    category: "lifecycle",
    sources: ["adressa"],
    expected: "no_situation",
    rule: "official_corroboration",
    notes: "Korreksjon justerer kandidat, men en kilde alene aktiverer ikke.",
    situationType: "fire",
  },
  {
    id: 38,
    name: "AI tjeneste timeout",
    category: "ai",
    sources: ["deepseek"],
    expected: "no_effect",
    rule: "ai_not_causal",
    notes: "Datadrevet flyt fortsetter uten AI.",
  },
  {
    id: 39,
    name: "Lokalnett brukerinnrapportert brann",
    category: "media",
    sources: ["external_blog"],
    expected: "no_situation",
    rule: "two_independent_reporting_sources",
    notes: "Svak ukjent kilde alene aktiverer ikke.",
    situationType: "fire",
  },
  {
    id: 40,
    name: "Blogg sier ulykke, politiet avkrefter",
    category: "lifecycle",
    sources: ["external_blog", "politiloggen"],
    expected: "dismissed",
    rule: "official_denial",
    notes: "Offisiell avkreftelse vinner.",
  },
  {
    id: 41,
    name: "Parade og rykte om tagass",
    category: "media",
    sources: ["trondheim_kommune", "social_media"],
    expected: "no_situation",
    rule: "official_denial",
    notes: "Planlagt arrangement + rykte er ikke hendelse.",
  },
  {
    id: 42,
    name: "NVE-varsel utenfor Trondheim",
    category: "place",
    sources: ["nve"],
    expected: "no_situation",
    rule: "place_outside_aoi",
    notes: "Utenfor AOI ignoreres.",
  },
  {
    id: 43,
    name: "Privat redaktor-notat om varsel",
    category: "audit",
    sources: ["private_annotations"],
    expected: "no_situation",
    rule: "private_not_causal",
    notes: "Private vurderinger kan ikke aktivere.",
  },
  {
    id: 44,
    name: "DATEX snofokk uten stenging",
    category: "datex",
    sources: ["datex"],
    expected: "context",
    rule: "context_only_source",
    notes: "Weather/environment low-impact er kontekst.",
    situationType: "weather",
  },
  {
    id: 45,
    name: "Moholt og Lerkendal om samme bygningsbrann",
    category: "place",
    sources: ["nrk", "adressa"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "Kan samles hvis geokoding viser samme lokale punkt.",
    situationType: "fire",
  },
  {
    id: 46,
    name: "Tunnel stengt og senere apnet",
    category: "lifecycle",
    sources: ["adressa"],
    expected: "resolved",
    rule: "official_resolution",
    notes: "Eksplisitt apnet-oppdatering loser eksisterende sak.",
    situationType: "traffic",
  },
  {
    id: 47,
    name: "Politiloggen oppdatering: mistenkt pagrepet",
    category: "lifecycle",
    sources: ["politiloggen"],
    expected: "resolved",
    rule: "official_resolution",
    notes: "Samme thread oppdateres, ikke ny situasjon.",
  },
  {
    id: 48,
    name: "To medier om arbeidsulykke",
    category: "media",
    sources: ["adressa", "nrk"],
    expected: "preliminary",
    rule: "two_independent_reporting_sources",
    notes: "To uavhengige kilder og spesifikt sted.",
    situationType: "other",
  },
  {
    id: 49,
    name: "DATEX og NRK samme E6-ulykke",
    category: "datex",
    sources: ["datex", "nrk"],
    expected: "official_event",
    rule: "official_corroboration",
    notes: "Offisiell DATEX + rapportering gir offisiell situasjon.",
    situationType: "traffic",
  },
  {
    id: 50,
    name: "Nyhet sier ras i Trondheim, NVE bare regionvarsel",
    category: "warning",
    sources: ["nrk", "nve"],
    expected: "no_situation",
    rule: "context_only_source",
    notes: "Regionvarsel bekrefter ikke lokal hendelse.",
    situationType: "landslide",
  },
  {
    id: 51,
    name: "Operatornotat motsier redaksjonell sak",
    category: "audit",
    sources: ["adressa", "private_annotations"],
    expected: "no_situation",
    rule: "private_not_causal",
    notes: "Privat note kan ikke alene avvise offentlig for brukere; krever offisiell avklaring.",
  },
  {
    id: 52,
    name: "Samme avis reposter brann fem timer senere",
    category: "lifecycle",
    sources: ["adressa", "adressa"],
    expected: "no_situation",
    rule: "stale_or_duplicate",
    notes: "Ikke uavhengig kilde.",
    situationType: "fire",
  },
  {
    id: 53,
    name: "Ulykke i Malvik",
    category: "place",
    sources: ["adressa"],
    expected: "no_situation",
    rule: "place_outside_aoi",
    notes: "Utenfor Trondheim AOI.",
  },
  {
    id: 54,
    name: "Restore reingester samme metadata",
    category: "audit",
    sources: ["internal"],
    expected: "no_loss_of_integrity",
    rule: "stale_or_duplicate",
    notes: "capture_hash og upstream ID hindrer duplikater.",
  },
  {
    id: 55,
    name: "Ukjent stedsnavn",
    category: "place",
    sources: ["nrk"],
    expected: "no_situation",
    rule: "place_too_generic",
    notes: "Geokodefeil skal stoppe aktivering.",
  },
  {
    id: 56,
    name: "MET varsel nedgraderes",
    category: "warning",
    sources: ["met"],
    expected: "context",
    rule: "context_only_source",
    notes: "Oppdaterer kontekstlaget, ikke situasjon.",
  },
  {
    id: 57,
    name: "Ukentlig hendelsesoppsummering",
    category: "media",
    sources: ["adressa"],
    expected: "no_situation",
    rule: "stale_or_duplicate",
    notes: "Digest skal ikke aktivere uten originaltidspunkter.",
  },
  {
    id: 58,
    name: "VG omtaler Trondelag-hendelse uten lokal kontekst",
    category: "place",
    sources: ["vg"],
    expected: "no_situation",
    rule: "place_too_generic",
    notes: "Uklart/utenfor lokal AOI.",
  },
  {
    id: 59,
    name: "E6 apnet igjen etter eksisterende brann",
    category: "lifecycle",
    sources: ["adressa"],
    expected: "resolved",
    rule: "official_resolution",
    notes: "Knytter til eksisterende aktiv sak og loser den.",
    situationType: "traffic",
  },
  {
    id: 60,
    name: "Uklassifisert hoy false-negative analysecase",
    category: "audit",
    sources: ["internal"],
    expected: "analyze",
    rule: "source_health_only",
    notes: "Brukes til manuell hulljakt, ikke automatisk aktivering.",
  },
  {
    id: 61,
    name: "Rosenborg ansetter trener",
    category: "sports",
    sources: ["adressa", "vg"],
    expected: "context",
    rule: "context_only_source",
    notes: "Sportsdekning bundles som tema, ikke hendelsessituasjon.",
    articleCategory: "Sport",
  },
  {
    id: 62,
    name: "Rosenborg mot Brann pa Lerkendal",
    category: "sports",
    sources: ["nrk", "adressa"],
    expected: "context",
    rule: "context_only_source",
    notes: "Fotballklubben Brann er ikke brannhendelse.",
    articleCategory: "Sport",
  },
] as const satisfies ActivationRegressionFixture[];

export const activationUiMicrocopy = {
  whyVisibleTitle: "Hvorfor ser jeg dette?",
  createdByTwoSources:
    "Saken vises fordi minst to uavhengige kilder omtaler samme hendelse pa et spesifikt sted.",
  officialConfirmation:
    "Saken er offentlig bekreftet av politiet eller Statens vegvesen etter en eksplisitt aktiveringsregel.",
  contextOnly:
    "Dette er kontekst. Det beskriver varsel, malinger eller trafikkstatus, men bekrefter ikke en lokal hendelse alene.",
  telemetryOnly:
    "Dette er et malepunkt eller en sensorverdi. Det kan forklare situasjonen, men kan ikke opprette en situasjon.",
  privateOnly: "Private notater er bare synlige for deg og brukes ikke som offentlig kildebevis.",
  estimatedPlace: "Stedsangivelsen er estimert fra rapportering og kan vaere upresis.",
  staleCandidate: "Kandidaten ble ikke aktivert fordi kildene var for gamle eller ikke uavhengige.",
  dismissed: "Saken er avvist fordi en offisiell kilde avkreftet eller korrigerte grunnlaget.",
} as const;

export const activationAuditRequirements = [
  "Alle aktiveringer skal lagre activation_rule_id eller activationBasis.rule.",
  "Alle aktiveringer skal peke til kilde-IDer og source_item/evidence-IDer som kan rekonstrueres.",
  "Kontekst- og telemetry-kilder skal kunne logges, men aldri lagres som supports-relasjon.",
  "AI-resultater skal logges som behandling eller sammendrag, ikke som aktiverende kilde.",
  "Dismiss, resolve, merge og split skal ha actor, tidspunkt, grunn og berorte kilde-IDer.",
  "Kildehelse skal logge siste suksess, siste feil, state, score og forklaring.",
  "Radata med lisens- eller personvernrisiko skal utelates fra source_items og audit-payloads.",
  "Retensjon ma vare lang nok til a gjenskape beslutningen, men ikke lagre full redaksjonell tekst.",
] as const;

export const activationEdgeCaseMitigations = [
  "Sted som bare er Trondheim eller Trondelag er feed-relevans, ikke hendelsesidentitet.",
  "Samme sted og type er ikke nok nar tekst beskriver ulike konkrete hendelser.",
  "Resolved/dismissed situasjoner kan ikke absorbere senere nye hendelser uten ny kvalifisering.",
  "Open-ended aktive TrafficInfo/DATEX-poster ma ha stale-timeout eller ferskt snapshotgrunnlag.",
  "MET/NVE-varsler kan berike kart og tidslinje, men skal ikke telle som uavhengig hendelseskilde.",
  "DATEX record-deler ma dedupliseres pa upstream situationId for a unnga flere rom for samme vegsak.",
  "Sportsordet Brann ma aldri tolkes som brannhendelse uten noytral hendelsestekst.",
  "Kildeformatdrift skal degradere source_health for adapteren og stoppe aktiverende bruk.",
] as const;

export function expectedFixtureCount(): number {
  return activationRegressionFixtures.length;
}

export function assertSituationActivationBasis(situation: Situation): string[] {
  const issues: string[] = [];
  const basis = situation.activationBasis;
  if (situation.status === "active" || situation.status === "preliminary") {
    if (!basis) issues.push("Mangler activationBasis for aktiv/forelopig situasjon.");
  }
  if (basis?.rule === "two_independent_sources") {
    const uniqueSources = new Set(basis.sourceIds);
    if (uniqueSources.size < 2) {
      issues.push("To-kilde-regel mangler minst to uavhengige sourceIds.");
    }
    const blocked = basis.sourceIds.filter((source) =>
      contextOnlyActivationSources.includes(source),
    );
    if (blocked.length > 0) {
      issues.push(`Kontekst/telemetry-kilder kan ikke aktivere: ${blocked.join(", ")}`);
    }
    if (basis.articleIds.length < 2) {
      issues.push("To-kilde-regel mangler minst to articleIds.");
    }
  }
  if (basis?.rule === "official_source") {
    const allowed = basis.sourceIds.every(
      (source) => source === "datex" || source === "politiloggen",
    );
    if (!allowed) {
      issues.push("Official-source-regel tillater bare datex eller politiloggen.");
    }
  }
  return issues;
}
