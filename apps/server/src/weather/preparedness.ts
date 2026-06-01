import type {
  OfficialEvent,
  RoadWeatherObservation,
  SourceHealth,
  WeatherCurrentSummary,
  WeatherHourlyPoint,
  WeatherImpactGroup,
  WeatherMapLayer,
  WeatherPreparednessAction,
  WeatherPreparednessPayload,
  WeatherRiskItem,
  WeatherRiskLevel,
  WeatherWarningSummary,
} from "@nytt/shared";

const TRONDHEIM_LAT = "63.4305";
const TRONDHEIM_LON = "10.3951";
const MET_LOCATIONFORECAST_URL = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${TRONDHEIM_LAT}&lon=${TRONDHEIM_LON}`;
const MET_USER_AGENT = "NyttTrondheim/0.1 kontakt@reidar.tech";

interface MetCompactResponse {
  properties?: {
    meta?: { updated_at?: string };
    timeseries?: MetTimeseriesPoint[];
  };
}

interface MetTimeseriesPoint {
  time?: string;
  data?: {
    instant?: { details?: Record<string, number | undefined> };
    next_1_hours?: {
      summary?: { symbol_code?: string };
      details?: Record<string, number | undefined>;
    };
  };
}

interface ForecastCacheEntry {
  expiresAt: number;
  payload: MetCompactResponse;
}

let forecastCache: ForecastCacheEntry | undefined;

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactTime(value: string | undefined): string {
  if (!value) return "Ikke oppgitt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function numericWarningLevel(severity: string | undefined): number | undefined {
  const match = `${severity ?? ""}`.match(/(?:nivå|nivaa|level)\s*(\d+)/i);
  if (!match) return undefined;
  const level = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(level) ? level : undefined;
}

function levelFromSeverity(severity: string | undefined): WeatherRiskLevel {
  const numericLevel = numericWarningLevel(severity);
  if (numericLevel !== undefined) {
    if (numericLevel >= 3) return "severe";
    if (numericLevel === 2) return "warning";
    return "normal";
  }
  const normalized = `${severity ?? ""}`.toLocaleLowerCase("nb");
  if (/red|rød|rod|extreme|ekstrem/.test(normalized)) return "severe";
  if (/orange|oransje|severe/.test(normalized)) return "severe";
  if (/yellow|gul|gult|moderate/.test(normalized)) return "warning";
  if (/minor|green|grønn|grønt|gront/.test(normalized)) return "watch";
  return "watch";
}

function officialLevelLabel(severity: string | undefined): string {
  const numericLevel = numericWarningLevel(severity);
  if (numericLevel !== undefined) {
    if (numericLevel >= 4) return "Rødt";
    if (numericLevel === 3) return "Oransje";
    if (numericLevel === 2) return "Gult";
    return "Grønt";
  }
  const normalized = `${severity ?? ""}`.toLocaleLowerCase("nb");
  if (/red|rød|rod|extreme|ekstrem/.test(normalized)) return "Rødt";
  if (/orange|oransje|severe/.test(normalized)) return "Oransje";
  if (/yellow|gul|gult|moderate/.test(normalized)) return "Gult";
  if (/minor|green|grønn|grønt|gront/.test(normalized)) return "Grønt";
  return severity ? severity : "Ukjent";
}

const riskLevelRank: Record<WeatherRiskLevel, number> = {
  normal: 0,
  watch: 1,
  warning: 2,
  severe: 3,
};

function moreSevere(a: WeatherRiskLevel, b: WeatherRiskLevel): WeatherRiskLevel {
  return riskLevelRank[b] > riskLevelRank[a] ? b : a;
}

function warningSeverityRank(severity: string | undefined): number {
  const numericLevel = numericWarningLevel(severity);
  if (numericLevel !== undefined) return numericLevel;
  const normalized = `${severity ?? ""}`.toLocaleLowerCase("nb");
  if (/red|rød|rod|extreme|ekstrem/.test(normalized)) return 4;
  if (/orange|oransje|severe/.test(normalized)) return 3;
  if (/yellow|gul|gult|moderate/.test(normalized)) return 2;
  if (/minor|green|grønn|grønt|gront/.test(normalized)) return 1;
  return 1;
}

function compareWarningsBySeverityThenRecency(a: OfficialEvent, b: OfficialEvent): number {
  const severityDiff = warningSeverityRank(b.severity) - warningSeverityRank(a.severity);
  if (severityDiff !== 0) return severityDiff;
  return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
}

function isRelevantWarning(event: OfficialEvent, now: Date): boolean {
  if (!["active", "updated"].includes(event.state)) return false;
  const validTo = Date.parse(event.validTo);
  return Number.isNaN(validTo) || validTo >= now.getTime();
}

function warningSourceLabel(event: OfficialEvent): string {
  if (event.source === "met") return "MET farevarsel";
  if (event.source === "nve" && event.eventType === "flood") return "NVE flomvarsel";
  if (event.source === "nve" && event.eventType === "landslide") return "NVE skredvarsel";
  if (event.source === "nve") return "NVE/Varsom";
  return "Statens vegvesen DATEX";
}

function symbolText(symbolCode: string | undefined): string {
  const normalized = `${symbolCode ?? ""}`.toLocaleLowerCase("nb");
  if (normalized.includes("rain")) return "regnbyger";
  if (normalized.includes("snow")) return "snø";
  if (normalized.includes("sleet")) return "sludd";
  if (normalized.includes("fog")) return "tåke";
  if (normalized.includes("cloud")) return "skyet";
  if (normalized.includes("clear") || normalized.includes("sun")) return "opphold";
  return "værdata";
}

export function parseMetLocationForecast(payload: MetCompactResponse): {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
} {
  const timeseries = payload.properties?.timeseries ?? [];
  const first = timeseries[0];
  const instant = first?.data?.instant?.details ?? {};
  const nextHour = first?.data?.next_1_hours;
  const updatedAt = payload.properties?.meta?.updated_at ?? first?.time ?? new Date().toISOString();
  const symbolCode = nextHour?.summary?.symbol_code;
  const precipitationNextHourMm = numberOrUndefined(nextHour?.details?.precipitation_amount);
  const airTemperatureC = numberOrUndefined(instant.air_temperature);
  const windSpeedMps = numberOrUndefined(instant.wind_speed);
  const windDirectionDeg = numberOrUndefined(instant.wind_from_direction);

  return {
    current: {
      summary: `MET Locationforecast: ${symbolText(symbolCode)} nå`,
      updatedAt,
      ...(airTemperatureC !== undefined ? { airTemperatureC } : {}),
      ...(windSpeedMps !== undefined ? { windSpeedMps } : {}),
      ...(windDirectionDeg !== undefined ? { windDirectionDeg } : {}),
      ...(precipitationNextHourMm !== undefined ? { precipitationNextHourMm } : {}),
      ...(symbolCode ? { symbolCode } : {}),
    },
    hourly: timeseries.slice(0, 8).map((point) => ({
      time: point.time ?? "",
      airTemperatureC: numberOrUndefined(point.data?.instant?.details?.air_temperature),
      windSpeedMps: numberOrUndefined(point.data?.instant?.details?.wind_speed),
      precipitationMm: numberOrUndefined(point.data?.next_1_hours?.details?.precipitation_amount),
      symbolCode: point.data?.next_1_hours?.summary?.symbol_code,
    })),
  };
}

export async function fetchMetLocationForecast(): Promise<{
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
}> {
  if (forecastCache && forecastCache.expiresAt > Date.now()) {
    return parseMetLocationForecast(forecastCache.payload);
  }
  const response = await fetch(MET_LOCATIONFORECAST_URL, {
    headers: { "User-Agent": MET_USER_AGENT },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error(`MET Locationforecast failed with ${response.status}`);
  }
  const payload = (await response.json()) as MetCompactResponse;
  const expiresHeader = response.headers.get("Expires") ?? response.headers.get("expires");
  const expiresAt = expiresHeader ? Date.parse(expiresHeader) : Date.now() + 15 * 60 * 1000;
  forecastCache = {
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 15 * 60 * 1000,
    payload,
  };
  return parseMetLocationForecast(payload);
}

function fallbackForecast(now: Date): {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
} {
  return {
    current: {
      summary: "MET Locationforecast: midlertidig utilgjengelig",
      updatedAt: now.toISOString(),
    },
    hourly: [],
  };
}

function firstWarning(events: OfficialEvent[], predicate: (event: OfficialEvent) => boolean) {
  return events.find(predicate);
}

function roadWeatherStatus(roadWeather: RoadWeatherObservation[]): WeatherRiskItem {
  const risky = roadWeather.filter((item) => {
    const raw = `${item.rawSummary ?? ""}`.toLocaleLowerCase("nb");
    return (
      raw.includes("våt") ||
      raw.includes("glatt") ||
      raw.includes("ice") ||
      raw.includes("snow") ||
      (item.roadSurfaceTemperatureC !== undefined && item.roadSurfaceTemperatureC <= 2) ||
      (item.precipitationMm !== undefined && item.precipitationMm > 0)
    );
  });
  const first = risky[0] ?? roadWeather[0];
  const level: WeatherRiskLevel = risky.length ? "watch" : "normal";
  return {
    key: "roadConditions",
    label: "Føre",
    status: risky.length
      ? `${risky.length} vegstasjon(er) med vått/glatt føre`
      : "Ingen særskilt føremelding",
    level,
    source: "Statens vegvesen DATEX",
    confidence: roadWeather.length ? "Middels" : "Lav",
    nextChange: roadWeather.length ? "Oppdateres fra vegstasjoner" : "Venter på DATEX værstasjoner",
    detail:
      first?.rawSummary ?? "Vegvesen road-weather stations brukes som kontekst for føre og sikt.",
  };
}

function buildWarnings(events: OfficialEvent[]): WeatherWarningSummary[] {
  return events.map((event) => ({
    id: event.id,
    sourceLabel: warningSourceLabel(event),
    title: event.title,
    area: event.areaLabel,
    level: officialLevelLabel(event.severity),
    validUntil: event.validTo,
    url: event.sourceUrl,
  }));
}

function buildActions(
  risks: WeatherRiskItem[],
  warnings: WeatherWarningSummary[],
): WeatherPreparednessAction[] {
  const actions: WeatherPreparednessAction[] = [];
  const precipitation = risks.find((risk) => risk.key === "precipitation");
  const flood = risks.find((risk) => risk.key === "floodLandslide");
  const severe = risks.some((risk) => risk.level === "severe");
  const rainWarning = warnings.find((warning) => /regn|rain/i.test(warning.title));
  const hasRainWarning = Boolean(rainWarning);
  const rainLevelLabel =
    rainWarning?.level ?? (precipitation?.level === "severe" ? "Oransje/rødt" : "Gult");

  if (hasRainWarning || precipitation?.level === "warning" || precipitation?.level === "severe") {
    actions.push({
      id: "rain-drains",
      title: "Rens sluk og hold avrenning åpen",
      detail: `${rainLevelLabel} regnvarsel: fjern løv fra sluk, sikre løse gjenstander og unngå utsatte underganger.`,
      source: "MET farevarsel + Trondheim klimatilpasning",
      level: precipitation?.level === "severe" ? "severe" : "warning",
    });
  }

  if (severe || flood?.level === "severe") {
    actions.push({
      id: "neighbours",
      title: "Sjekk sårbare naboer og egenberedskap",
      detail:
        "Ved oransje/rødt: følg offisielle varsler og forbered bortfall av strøm, vann, mobilnett og betalingsløsninger.",
      source: "DSB egenberedskap",
      level: "severe",
    });
  }

  if (!actions.length) {
    actions.push({
      id: "normal-awareness",
      title: "Følg offisielle varsler og lokale forhold",
      detail:
        "Ingen akutt værfare i datagrunnlaget, men sjekk MET, Varsom og trafikkart før utsatt ferdsel.",
      source: "MET/NVE/DSB",
      level: "normal",
    });
  }

  return actions;
}

function buildRisks(
  forecast: { current: WeatherCurrentSummary; hourly: WeatherHourlyPoint[] },
  warnings: WeatherWarningSummary[],
  officialEvents: OfficialEvent[],
  roadWeather: RoadWeatherObservation[],
): WeatherRiskItem[] {
  const rainWarning = firstWarning(
    officialEvents,
    (event) =>
      event.source === "met" && /regn|rain|flood|flom/i.test(`${event.title} ${event.detail}`),
  );
  const windWarning = firstWarning(
    officialEvents,
    (event) => event.source === "met" && /vind|wind|storm/i.test(`${event.title} ${event.detail}`),
  );
  const nveWarning = firstWarning(officialEvents, (event) => event.source === "nve");
  const forecastPrecip = forecast.current.precipitationNextHourMm ?? 0;
  const forecastWind = forecast.current.windSpeedMps ?? 0;
  const precipitationLevel = rainWarning
    ? levelFromSeverity(rainWarning.severity)
    : forecastPrecip >= 5
      ? "warning"
      : forecastPrecip > 0
        ? "watch"
        : "normal";
  const windLevel = windWarning
    ? levelFromSeverity(windWarning.severity)
    : forecastWind >= 15
      ? "warning"
      : forecastWind >= 8
        ? "watch"
        : "normal";
  const floodLevel = nveWarning ? levelFromSeverity(nveWarning.severity) : "normal";
  const roadRisk = roadWeatherStatus(roadWeather);
  const overall = [precipitationLevel, windLevel, floodLevel, roadRisk.level].reduce(
    (level, next) => moreSevere(level, next),
    "normal" as WeatherRiskLevel,
  );
  const severeWeather = overall === "severe";

  return [
    {
      key: "precipitation",
      label: "Nedbør",
      status: rainWarning
        ? `${warningSourceLabel(rainWarning)}: ${officialLevelLabel(rainWarning.severity)} ${rainWarning.title.replace(/^MET farevarsel:\s*/i, "")}`
        : forecastPrecip > 0
          ? `${forecastPrecip.toFixed(1)} mm neste time`
          : "Lite eller ingen nedbør meldt",
      level: precipitationLevel,
      source: rainWarning ? "MET Locationforecast + MET farevarsel" : "MET Locationforecast",
      confidence: rainWarning ? "Høy" : "Middels",
      nextChange: rainWarning
        ? `Gjelder til ${compactTime(rainWarning.validTo)}`
        : "Neste timesvarsel",
      detail:
        rainWarning?.detail ?? "Brukes til overvann, sluk og utsatte underganger i Trondheim.",
    },
    {
      key: "wind",
      label: "Vind",
      status: windWarning
        ? `${warningSourceLabel(windWarning)}: ${officialLevelLabel(windWarning.severity)}`
        : `${forecastWind.toFixed(1)} m/s`,
      level: windLevel,
      source: windWarning ? "MET Locationforecast + MET farevarsel" : "MET Locationforecast",
      confidence: windWarning ? "Høy" : "Middels",
      nextChange: windWarning
        ? `Gjelder til ${compactTime(windWarning.validTo)}`
        : "Neste timesvarsel",
      detail:
        windWarning?.detail ??
        "Vind vurderes mot løse gjenstander, eksponerte bruer og utearrangement.",
    },
    {
      key: "floodLandslide",
      label: "Flom/skred",
      status: nveWarning
        ? `${warningSourceLabel(nveWarning)}: ${officialLevelLabel(nveWarning.severity)}`
        : "Ingen aktivt NVE-varsel i datagrunnlaget",
      level: floodLevel,
      source: "NVE/Varsom",
      confidence: nveWarning ? "Høy" : "Middels",
      nextChange: nveWarning
        ? `Gjelder til ${compactTime(nveWarning.validTo)}`
        : "Følg Varsom ved nedbørendring",
      detail:
        nveWarning?.detail ?? "NVE/Varsom brukes for flom, jordskred og hydrologiske faresignaler.",
    },
    roadRisk,
    {
      key: "powerTelecom",
      label: "Strøm/tele",
      status: severeWeather ? "Forbered forstyrrelser" : "Normal egenberedskap",
      level: severeWeather ? "warning" : "normal",
      source: "DSB egenberedskap",
      confidence: "Råd",
      nextChange: severeWeather ? "Ved oransje/rødt varsel" : "Ved forverring",
      detail:
        "DSB anbefaler én uke grunnberedskap for bortfall av strøm, vann, internett/mobilnett og betalingssystemer.",
    },
    {
      key: "health",
      label: "Helse",
      status:
        (forecast.current.airTemperatureC ?? 8) <= -10
          ? "Kulderisiko for sårbare grupper"
          : (forecast.current.airTemperatureC ?? 8) >= 26
            ? "Varmerisiko for sårbare grupper"
            : "Ingen særskilt værhelserisiko",
      level:
        (forecast.current.airTemperatureC ?? 8) <= -10 ||
        (forecast.current.airTemperatureC ?? 8) >= 26
          ? "watch"
          : "normal",
      source: "MET/DSB",
      confidence: "Middels",
      nextChange: "Følg temperaturendringer",
      detail:
        "Vurder eldre, barn, kronisk syke og personer som må oppholde seg ute ved varme/kulde.",
    },
  ];
}

function buildImpactGroups(risks: WeatherRiskItem[]): WeatherImpactGroup[] {
  const riskByKey = new Map(risks.map((risk) => [risk.key, risk]));
  const precipitation = riskByKey.get("precipitation")!;
  const road = riskByKey.get("roadConditions")!;
  const health = riskByKey.get("health")!;
  const flood = riskByKey.get("floodLandslide")!;
  const power = riskByKey.get("powerTelecom")!;
  return [
    {
      group: "Innbyggere",
      status: precipitation.level === "normal" ? "Normal oppmerksomhet" : "Følg lokale råd",
      level: precipitation.level,
      detail:
        precipitation.level === "normal"
          ? "Ingen særskilte tiltak utover normal egenberedskap."
          : "Hold sluk åpne, sjekk utsatte kjellere og hjelp sårbare naboer ved forverring.",
      source: "DSB/Trondheim kommune",
    },
    {
      group: "Transport",
      status: road.status,
      level: road.level,
      detail: "Se trafikkart, kollektivmeldinger og Vegvesen-føredata før utsatt ferdsel.",
      source: "Statens vegvesen DATEX/AtB",
    },
    {
      group: "Helse",
      status: health.status,
      level: health.level,
      detail: health.detail,
      source: "MET/DSB",
    },
    {
      group: "Skole/arrangement",
      status:
        moreSevere(precipitation.level, road.level) === "normal"
          ? "Normal drift"
          : "Uteaktivitet bør vurderes",
      level: moreSevere(precipitation.level, road.level),
      detail:
        "Vurder eksponering for regn, vind og glatte flater ved utearrangement og skoleaktivitet.",
      source: "MET/Trondheim kommune",
    },
    {
      group: "Beredskap",
      status:
        flood.level === "severe" || power.level === "warning"
          ? "Følg offisielle varsler"
          : "Ingen offisiell eskalering i Nytt",
      level: moreSevere(flood.level, power.level),
      detail:
        "Nytt imiterer ikke Nødvarsel; akutte varsler besluttes og sendes av politiet eller Sivilforsvaret.",
      source: "Nødvarsel/DSB/Sivilforsvaret",
    },
  ];
}

const mapLayers: WeatherMapLayer[] = [
  {
    id: "met-warnings",
    title: "MET warning polygons",
    source: "MET",
    status: "planned",
    detail:
      "MetAlerts-varsel er kildegrunnlag; polygonlaget markeres først aktivt når varselgeometri tegnes i værkartet.",
  },
  {
    id: "nve-warning-areas",
    title: "NVE flood/landslide warning areas",
    source: "NVE/Varsom",
    status: "planned",
    detail: "Flom- og skredvarsel bør vises komplett og kilde-merket fra Varsom.",
  },
  {
    id: "trondheim-overvann",
    title: "Trondheim flood paths / overvann",
    source: "Trondheim kommune",
    status: "planned",
    detail:
      "Kommunale flomveier og overvannstema legges som kontekst når åpne lag er tilgjengelige.",
  },
  {
    id: "datex-road-weather",
    title: "Vegvesen road-weather stations",
    source: "Statens vegvesen DATEX",
    status: "available",
    detail: "Værstasjoner langs veg brukes for føre, sikt og våt/isete veibane.",
  },
  {
    id: "traffic-public-transport",
    title: "Traffic and public transport disruptions",
    source: "Nytt trafikkart/Entur/Vegvesen",
    status: "available",
    detail: "Eksisterende trafikk- og kollektivdata gir konsekvenskontekst.",
  },
];

export async function buildWeatherPreparednessPayload(input: {
  officialEvents: OfficialEvent[];
  roadWeather: RoadWeatherObservation[];
  sourceHealth: SourceHealth[];
  now?: Date;
  forecast?: { current: WeatherCurrentSummary; hourly: WeatherHourlyPoint[] };
}): Promise<WeatherPreparednessPayload> {
  const now = input.now ?? new Date();
  const forecast = input.forecast ?? fallbackForecast(now);
  const relevantOfficialEvents = input.officialEvents
    .filter(
      (event) =>
        (event.source === "met" || event.source === "nve") && isRelevantWarning(event, now),
    )
    .sort(compareWarningsBySeverityThenRecency);
  const warnings = buildWarnings(relevantOfficialEvents);
  const risks = buildRisks(forecast, warnings, relevantOfficialEvents, input.roadWeather);
  return {
    generatedAt: now.toISOString(),
    current: forecast.current,
    hourly: forecast.hourly,
    risks,
    actions: buildActions(risks, warnings),
    authority: {
      emergencyAlertStatus: "Nytt er ikke koblet til Nødvarsel. Følg Nødvarsel hvis du får det.",
      civilDefenceDetail:
        "Sivilforsvaret støtter politi, brann, helse, kommuner og frivillige ved større hendelser, blant annet konsekvenser av ekstremvær, flom og overvann.",
      links: [
        {
          label: "Nødvarsel",
          url: "https://www.nodvarsel.no/om-nodvarsel/",
          source: "Nødvarsel",
        },
        {
          label: "DSB egenberedskap",
          url: "https://www.dsb.no/sikkerhverdag/egenberedskap/",
          source: "DSB",
        },
        {
          label: "Varsom",
          url: "https://www.varsom.no/",
          source: "NVE/Varsom",
        },
        {
          label: "MET farevarsler",
          url: "https://www.yr.no/nb/farevarsler",
          source: "MET",
        },
        {
          label: "Trondheim klimatilpasning",
          url: "https://www.trondheim.kommune.no/tema/klima-miljo-og-naring/miljo/klimaloftene---kommunedelplan-for-energi-og-klima/klimatilpasning/",
          source: "Trondheim kommune",
        },
      ],
    },
    impactGroups: buildImpactGroups(risks),
    warnings,
    roadWeather: input.roadWeather.slice(0, 10),
    mapLayers,
    sources: input.sourceHealth.filter((source) =>
      [
        "met",
        "nve",
        "datex_weather",
        "datex",
        "datex_travel_time",
        "vegvesen_traffic_info",
        "entur_service_alerts",
      ].includes(source.source),
    ),
  };
}

export async function loadWeatherPreparedness(input: {
  officialEvents: OfficialEvent[];
  roadWeather: RoadWeatherObservation[];
  sourceHealth: SourceHealth[];
  now?: Date;
}): Promise<WeatherPreparednessPayload> {
  let forecast: { current: WeatherCurrentSummary; hourly: WeatherHourlyPoint[] } | undefined;
  try {
    forecast = await fetchMetLocationForecast();
  } catch {
    forecast = undefined;
  }
  return buildWeatherPreparednessPayload({ ...input, forecast });
}
