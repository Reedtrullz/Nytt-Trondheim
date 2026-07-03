import type {
  Article,
  BootstrapPayload,
  MapFeature,
  Situation,
  SituationWorkspace,
  SourceHealth,
  WorkspaceNote,
  WorkspaceTask,
} from "./types.js";
import { buildCityPulseStories } from "./article-bundles.js";
import { buildMorningBrief } from "./morning-brief.js";

const now = "2026-05-26T12:26:00.000Z";

export const sampleArticles: Article[] = [
  {
    id: "a-fire",
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: "Skogbrann ved Bymarka - ber publikum holde avstand",
    excerpt:
      "Nødetatene følger situasjonen vest for Granåsen. Flere medier melder om røyk i området.",
    url: "https://www.nrk.no/trondelag/",
    publishedAt: "2026-05-26T12:18:00.000Z",
    scope: "trondheim",
    category: "Hendelser",
    places: ["Bymarka", "Granåsen"],
    location: { lat: 63.4045, lng: 10.302, label: "Bymarka" },
    situationId: "skogbrann-bymarka",
  },
  {
    id: "a-bridge",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Ny bru over Nidelva åpnet for gående og syklende",
    excerpt: "Hundrevis tok turen da den nye forbindelsen ved Skansen åpnet i dag.",
    url: "https://www.adressa.no/nyheter/trondheim",
    publishedAt: "2026-05-26T10:18:00.000Z",
    scope: "trondheim",
    category: "Transport",
    places: ["Midtbyen", "Skansen"],
    location: { lat: 63.4303, lng: 10.3852, label: "Midtbyen" },
  },
  {
    id: "a-sluppen",
    source: "adressa",
    sourceLabel: "Adresseavisen",
    title: "Starter byggingen av 700 nye boliger på Sluppen",
    excerpt: "Utbyggerne forteller at første spadetak er tatt for det nye nabolaget.",
    url: "https://www.adressa.no/nyheter/trondheim",
    publishedAt: "2026-05-26T09:42:00.000Z",
    scope: "trondheim",
    category: "Byutvikling",
    places: ["Sluppen"],
    location: { lat: 63.3978, lng: 10.3995, label: "Sluppen" },
  },
  {
    id: "a-road",
    source: "trondheim_kommune",
    sourceLabel: "Trondheim kommune",
    title: "Varsel om veiarbeid i Innherredsveien fra mandag",
    excerpt: "Arbeidet påvirker kollektivtrafikk og biltrafikk. Se omkjøringsmuligheter.",
    url: "https://www.trondheim.kommune.no/aktuelt/nyheter/",
    publishedAt: "2026-05-26T09:15:00.000Z",
    scope: "trondheim",
    category: "Transport",
    places: ["Lade", "Innherredsveien"],
    location: { lat: 63.4402, lng: 10.437, label: "Lade" },
  },
  {
    id: "a-festival",
    source: "vg",
    sourceLabel: "VG",
    title: "Olavsfestdagene venter mange besøkende i Trondheim",
    excerpt: "Festivalarrangørene melder om stor interesse for årets program.",
    url: "https://www.vg.no/",
    publishedAt: "2026-05-26T08:33:00.000Z",
    scope: "trondheim",
    category: "Kultur",
    places: ["Midtbyen"],
  },
  {
    id: "a-regional",
    source: "dagbladet",
    sourceLabel: "Dagbladet",
    title: "Kraftig regn ventes flere steder i Trøndelag",
    excerpt: "Meteorologene ber bilister følge med på lokale forhold utover kvelden.",
    url: "https://www.dagbladet.no/",
    publishedAt: "2026-05-26T07:34:00.000Z",
    scope: "trondelag",
    category: "Vær",
    places: ["Trøndelag"],
  },
];

const situationFeatures: MapFeature[] = [
  {
    id: "feature-reported",
    type: "Feature",
    geometry: { type: "Point", coordinates: [10.302, 63.4045] },
    properties: {
      label: "Omtalt stedsnavn - geokodet anslag fra rapportering",
      provenance: "reporting_estimate",
      sourceLabel: "NRK Trøndelag / Adresseavisen",
      updatedAt: now,
    },
  },
  {
    id: "feature-warning",
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [10.25, 63.435],
          [10.36, 63.435],
          [10.36, 63.36],
          [10.25, 63.36],
          [10.25, 63.435],
        ],
      ],
    },
    properties: {
      label: "Farevarsel fra MET",
      provenance: "official",
      layer: "warning",
      sourceLabel: "MET farevarsel",
      source: "met",
      updatedAt: now,
    },
  },
];

export const sampleSituation: Situation = {
  id: "skogbrann-bymarka",
  type: "fire",
  title: "Skogbrann ved Bymarka",
  summary: "Samlet oversikt fra åpne, publiserte kilder. Områder kan være omtrentlige.",
  status: "active",
  verificationStatus: "Foreløpig fra rapportering",
  importance: "high",
  updatedAt: now,
  createdAt: "2026-05-26T11:06:00.000Z",
  locationLabel: "Bymarka / Granåsen",
  incidentSignature: "fire:bymarka",
  detectionVersion: "2",
  activationBasis: {
    rule: "two_independent_sources",
    sourceIds: ["nrk", "adressa"],
    articleIds: ["a-fire"],
    activatedAt: "2026-05-26T11:06:00.000Z",
  },
  relatedArticleIds: ["a-fire"],
  features: situationFeatures,
  evidence: [
    {
      id: "e1",
      situationId: "skogbrann-bymarka",
      source: "nrk",
      sourceLabel: "NRK Trøndelag",
      sourceUrl: "https://www.nrk.no/trondelag/",
      supportingSnippet: "Nødetatene følger situasjonen vest for Granåsen.",
      claim: "Det er meldt om brann i området ved Bymarka.",
      claimType: "incident",
      provenance: "reporting_estimate",
      confidence: 0.8,
      extractedAt: now,
      publishedAt: "2026-05-26T12:18:00.000Z",
    },
  ],
  timeline: [
    {
      id: "t1",
      situationId: "skogbrann-bymarka",
      timestamp: "2026-05-26T11:06:00.000Z",
      title: "Første melding om røyk",
      detail: "Medier omtaler røykutvikling vest for Granåsen.",
      sourceLabel: "NRK Trøndelag",
      source: "nrk",
      sourceUrl: "https://www.nrk.no/trondelag/",
      official: false,
    },
    {
      id: "t2",
      situationId: "skogbrann-bymarka",
      timestamp: "2026-05-26T12:18:00.000Z",
      title: "Publikum bes holde avstand",
      detail: "Oppdateringen er lenket til originalkilden.",
      sourceLabel: "Adresseavisen",
      source: "adressa",
      sourceUrl: "https://www.adressa.no/",
      official: false,
    },
  ],
};

export const sampleTasks: WorkspaceTask[] = [
  {
    id: "task-1",
    situationId: sampleSituation.id,
    text: "Følg nye offentlige oppdateringer",
    completed: true,
    createdAt: now,
  },
  {
    id: "task-2",
    situationId: sampleSituation.id,
    text: "Sjekk berørte turstier før kveldstur",
    completed: false,
    createdAt: now,
  },
];

export const sampleNotes: WorkspaceNote[] = [];

export const sampleSourceHealth: SourceHealth[] = [
  { source: "nrk", label: "NRK Trøndelag", state: "ok", lastCheckedAt: now, detail: "RSS" },
  { source: "adressa", label: "Adresseavisen", state: "ok", lastCheckedAt: now, detail: "RSS" },
  { source: "vg", label: "VG", state: "ok", lastCheckedAt: now, detail: "RSS" },
  { source: "dagbladet", label: "Dagbladet", state: "ok", lastCheckedAt: now, detail: "RSS" },
  {
    source: "trondheim_kommune",
    label: "Trondheim kommune",
    state: "ok",
    lastCheckedAt: now,
    detail: "Aktuelt",
  },
  {
    source: "datex",
    label: "Vegvesen DATEX",
    state: "awaiting_access",
    detail: "Venter på DATEX Basic Auth-brukernavn og passord",
  },
  {
    source: "politiloggen",
    label: "Politiloggen",
    state: "disabled",
    detail: "Eksperimentell adapter er slått av",
  },
];

export const sampleBootstrap: BootstrapPayload = {
  articles: sampleArticles,
  stories: buildCityPulseStories(sampleArticles),
  situations: [
    {
      id: sampleSituation.id,
      title: sampleSituation.title,
      summary: sampleSituation.summary,
      status: sampleSituation.status,
      verificationStatus: sampleSituation.verificationStatus,
      updatedAt: sampleSituation.updatedAt,
      createdAt: sampleSituation.createdAt,
      locationLabel: sampleSituation.locationLabel,
    },
  ],
  sourceHealth: sampleSourceHealth,
};

sampleBootstrap.morningBrief = buildMorningBrief({
  articles: sampleBootstrap.articles,
  situations: sampleBootstrap.situations,
  sourceHealth: sampleBootstrap.sourceHealth,
  generatedAt: now,
});

export const sampleWorkspace: SituationWorkspace = {
  situation: sampleSituation,
  relatedArticles: sampleArticles.filter((article) => article.situationId === sampleSituation.id),
  tasks: sampleTasks,
  notes: sampleNotes,
  attachments: [],
};
