import type { ArticleCategory, GeographicScope } from "@nytt/shared";

const trondheimTerms = [
  "bakklandet",
  "brattøra",
  "byåsen",
  "bymarka",
  "charlottenlund",
  "dragvoll",
  "elgeseter",
  "estenstadmarka",
  "flatåsen",
  "gløshaugen",
  "granåsen",
  "heimdal",
  "ila",
  "innherredsveien",
  "klett",
  "lade",
  "leangen",
  "lerkendal",
  "midtbyen",
  "moholt",
  "møllenberg",
  "nardo",
  "nidelva",
  "ntnu",
  "omkjøringsvegen",
  "ranheim",
  "risvollan",
  "romolslia",
  "rosenborg",
  "rotvoll",
  "samfundet",
  "saupstad",
  "singsaker",
  "sintef",
  "skansen",
  "sluppen",
  "stavne-leangen",
  "st. olavs",
  "st olavs",
  "sverresborg",
  "tiller",
  "trondheim",
  "trondheim s",
  "tyholt",
  "vikåsen",
];

const regionalTerms = [
  "arbeidets rett",
  "atb",
  "dovrebanen",
  "e14",
  "fosen",
  "frøya",
  "gauldalen",
  "hitra",
  "innherred",
  "kolstad håndball",
  "levanger",
  "malvik",
  "melhus",
  "meråker",
  "meråkerbanen",
  "metrobuss",
  "midt-norge",
  "namdalen",
  "namsos",
  "nordlandsbanen",
  "oppdal",
  "orkanger",
  "orkland",
  "ranheim fotball",
  "røros",
  "rørosbanen",
  "skaun",
  "ski-vm",
  "stjørdal",
  "steinkjer",
  "trønderbanen",
  "trøndelag",
  "trøndelag fylkeskommune",
  "verdalsøra",
  "verdal",
  "værnes",
];

const displayLabels: Record<string, string> = {
  atb: "AtB",
  e14: "E14",
  ntnu: "NTNU",
  sintef: "SINTEF",
  "ski-vm": "Ski-VM",
  "st olavs": "St. Olavs",
  "st. olavs": "St. Olavs",
  "trondheim s": "Trondheim S",
};

const categoryRules: Array<[ArticleCategory, string[]]> = [
  [
    "Hendelser",
    [
      "barnehage stengt",
      "brann",
      "driftsstans",
      "evaku",
      "politi",
      "politiaksjon",
      "ras",
      "redning",
      "savnet",
      "skole stengt",
      "skred",
      "strømbrudd",
      "ulykke",
      "vannlekkasje",
      "voldshendelse",
    ],
  ],
  [
    "Transport",
    [
      "atb",
      "bane",
      "bru",
      "buss",
      "e14",
      "e39",
      "e6",
      "metrobuss",
      "stengt",
      "sykkel",
      "tog",
      "trafikk",
      "vei",
      "veg",
    ],
  ],
  ["Byutvikling", ["bygg", "bolig", "regulering", "utbygg", "plan"]],
  ["Kultur", ["festival", "konsert", "olavsfest", "kultur", "museum", "samfundet"]],
  ["Politikk", ["byråd", "budsjett", "fylkesting", "formannskap", "kommunestyre", "politikk"]],
  ["Vær", ["farevarsel", "flom", "regn", "uvær", "vær", "vind"]],
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPlaceTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

function displayLabel(term: string): string {
  return displayLabels[term] ?? term.charAt(0).toLocaleUpperCase("nb") + term.slice(1);
}

export function detectScope(text: string): GeographicScope | undefined {
  const normalized = text.toLocaleLowerCase("nb");
  if (trondheimTerms.some((term) => containsPlaceTerm(normalized, term))) return "trondheim";
  if (regionalTerms.some((term) => containsPlaceTerm(normalized, term))) return "trondelag";
  return undefined;
}

export function categorize(text: string): ArticleCategory {
  const normalized = text.toLocaleLowerCase("nb");
  return (
    categoryRules.find(([, terms]) => terms.some((term) => normalized.includes(term)))?.[0] ??
    "Nyheter"
  );
}

export function extractPlaces(text: string): string[] {
  const normalized = text.toLocaleLowerCase("nb");
  return [...trondheimTerms, ...regionalTerms]
    .filter((term) => containsPlaceTerm(normalized, term))
    .map(displayLabel);
}
