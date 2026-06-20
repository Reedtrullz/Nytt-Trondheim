import type { ArticleCategory, ArticleTopic, GeographicScope } from "@nytt/shared";

const trondheimTerms = [
  "kroppanbrua",
  "kroppan bru",
  "kyvatnet",
  "kyvannet",
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
  "solsiden",
  "skansen",
  "sluppen",
  "stavne-leangen",
  "st. olavs",
  "st olavs",
  "sverresborg",
  "tiller",
  "trondheim sentrum",
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
  kyvatnet: "Kyvannet",
  "trondheim sentrum": "Sentrum",
  "trondheim s": "Trondheim S",
};

const placeAliases = new Map<string, string>([
  ["kroppanbrua", "Kroppan Bru"],
  ["kroppan bru", "Kroppan Bru"],
  ["kyvatnet", "Kyvannet"],
  ["trondheim sentrum", "Sentrum"],
]);

type CategoryMatcher = string | RegExp;

const categoryRules: Array<[ArticleCategory, CategoryMatcher[]]> = [
  [
    "Sport",
    [
      "fotball",
      "hovedtrener",
      "håndball",
      "kolstad håndball",
      "rbk",
      "ranheim fotball",
      /\b(?:rosenborgs?\b.*\b(?:ansatt|eliteserien|fotball|hovedtrener|kamp|m[øo]ter|presentert|samtaler|spiller|tapte|trener\w*|vant)\b|(?:ansatt|eliteserien|fotball|hovedtrener|kamp|m[øo]ter|presentert|samtaler|spiller|tapte|trener\w*|vant)\b.*\brosenborgs?\b)/u,
      "ski-vm",
      "trenerjobb",
      "vm-jubel",
    ],
  ],
  [
    "Krim",
    [
      /\b(?:anmeld\w*|arrest\w*|bortvist\w*|innbrudd\w*|innbruddsfors[øo]k\w*|ordensforstyrrelse\w*|p[åa]grip\w*|politibil\w*|ran|rans\w*|ro\s+og\s+orden|slagsm[åa]l\w*|sl[åa]ss\w*|sloss\w*|stj(?:e|å|a)l\w*|tjuv\w*|tyv\w*|tyveri\w*|tyvgods|vold\w*)\b/u,
    ],
  ],
  [
    "Transport",
    [
      "atb",
      /\b(?:bane|banen|baner|banene)\b/u,
      /\bbru(?:a|en)?\b/u,
      "buss",
      "e14",
      "e39",
      "e6",
      "kollisjon",
      "metrobuss",
      "omkjør",
      "påkjør",
      "sammenstøt",
      "syklist",
      "sykkel",
      "tog",
      "trafikk",
      "trafikkhendelse",
      "trafikkulykke",
      "veiarbeid",
      /\b(?:e\d+|fylkesvei\w*|riksvei\w*|tunnel\w*|tog\w*|trikk\w*|vei(?:en|er|ene)?|veg(?:en|er|ene)?)\b.{0,48}\bstengt\b/u,
      /\bstengt\b.{0,48}\b(?:e\d+|fylkesvei\w*|riksvei\w*|tunnel\w*|tog\w*|trikk\w*|vei(?:en|er|ene)?|veg(?:en|er|ene)?)\b/u,
      /\bvei(?:en|er|ene)?\b/u,
      /\bveg(?:en|er|ene)?\b/u,
    ],
  ],
  [
    "Hendelser",
    [
      "barnehage stengt",
      "brann",
      "driftsstans",
      "drukn",
      "evaku",
      "hjerte- og lungeredning",
      "livløs under vann",
      "nødetatene",
      "politiaksjon",
      /\bpolitiet\s+rykker\s+ut\b/u,
      "ras",
      "redning",
      "redningsaksjon",
      "røyk",
      "røykutvikling",
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
    "Byutvikling",
    [
      "bolig",
      "bygg",
      "byplan",
      "områdeplan",
      "planforslag",
      "regulering",
      "reguleringsplan",
      "utbygg",
    ],
  ],
  ["Kultur", ["festival", "konsert", "olavsfest", "kultur", "museum", "samfundet"]],
  ["Politikk", ["byråd", "budsjett", "fylkesting", "formannskap", "kommunestyre", "politikk"]],
  ["Vær", ["farevarsel", "flom", "regn", "uvær", /\bvær\b/u, "vind"]],
];

const rosenborgClubContext =
  /\b(?:rbk|rosenborgs?\b.*\b(?:ansatt|eliteserien|fotball|hovedtrener|kamp|m[øo]ter|presentert|samtaler|spiller|tapte|trener\w*|vant)\b|(?:ansatt|eliteserien|fotball|hovedtrener|kamp|m[øo]ter|presentert|samtaler|spiller|tapte|trener\w*|vant)\b.*\brosenborgs?\b)/u;
const rosenborgDistrictContext =
  /\b(?:(?:på|til|ved)\s+rosenborg|i\s+rosenborg\s+(?:bydel|området)|rosenborg\s+(?:barnehage|bydel|gate|kirke|området|park|skole))\b/u;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPlaceTerm(text: string, term: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

function displayLabel(term: string): string {
  return displayLabels[term] ?? term.charAt(0).toLocaleUpperCase("nb") + term.slice(1);
}

function normalizePlaceAliasKey(place: string): string {
  return place.trim().toLocaleLowerCase("nb").replaceAll(/\s+/g, " ");
}

export function canonicalPlaceName(place: string): string {
  return placeAliases.get(normalizePlaceAliasKey(place)) ?? place.trim();
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
    categoryRules.find(([, terms]) =>
      terms.some((term) =>
        typeof term === "string" ? normalized.includes(term) : term.test(normalized),
      ),
    )?.[0] ?? "Nyheter"
  );
}

export function articleTopics(
  text: string,
  category: ArticleCategory = categorize(text),
): ArticleTopic[] {
  if (category !== "Sport") return [];
  const normalized = text.toLocaleLowerCase("nb");
  return rosenborgClubContext.test(normalized) ? ["rosenborg"] : [];
}

export function extractPlaces(text: string): string[] {
  const normalized = text.toLocaleLowerCase("nb");
  return [...trondheimTerms, ...regionalTerms]
    .filter((term) => containsPlaceTerm(normalized, term))
    .filter(
      (term) =>
        term !== "rosenborg" ||
        !rosenborgClubContext.test(normalized) ||
        rosenborgDistrictContext.test(normalized),
    )
    .map(displayLabel);
}
