import {
  isFreshRoadWeatherObservation,
  moreSevereWeatherRiskLevel,
  roadWeatherObservationLevel,
} from "@nytt/shared";
import type {
  OfficialEvent,
  RoadWeatherObservation,
  SourceHealth,
  WeatherCacheStatus,
  WeatherCurrentSummary,
  WeatherDataStatus,
  WeatherForecastLocation,
  WeatherForecastMetadata,
  WeatherForecastOverview,
  WeatherForecastProduct,
  WeatherForecastZone,
  WeatherHourlyPoint,
  WeatherImpactGroup,
  WeatherMapLayer,
  WeatherQualitySummary,
  WeatherPreparednessAction,
  WeatherPreparednessPayload,
  WeatherRiskItem,
  WeatherRiskLevel,
  WeatherWarningSummary,
} from "@nytt/shared";

const MET_USER_AGENT = "NyttTrondheim/0.1 kontakt@reidar.tech";
const PRIMARY_LOCATION_ID = "sentrum";
const ROAD_WEATHER_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const weatherForecastLocations: WeatherForecastLocation[] = [
  {
    id: PRIMARY_LOCATION_ID,
    label: "Sentrum",
    latitude: 63.4305,
    longitude: 10.3951,
    description: "Midtbyen, Solsiden og sentrale Trondheim.",
  },
  {
    id: "bymarka",
    label: "Byåsen/Bymarka",
    latitude: 63.418,
    longitude: 10.283,
    description: "Høyere og mer utsatte områder vest i byen.",
  },
  {
    id: "heimdal-klett",
    label: "Heimdal/Klett",
    latitude: 63.353,
    longitude: 10.358,
    description: "Sørlige bydeler, E6/E39 og lavere temperaturmargin.",
  },
  {
    id: "lade-ranheim",
    label: "Lade/Ranheim",
    latitude: 63.446,
    longitude: 10.505,
    description: "Østlige bydeler og fjordnære forhold.",
  },
];

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
  fetchedAt: string;
  payload: MetCompactResponse;
}

type ForecastProductFetch = {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
  metadata: WeatherForecastMetadata;
};

type ForecastBundle = Pick<
  WeatherPreparednessPayload,
  "location" | "current" | "hourly" | "forecast" | "quality"
>;

type LegacyForecastInput = {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
};

const forecastCache = new Map<string, ForecastCacheEntry>();

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metProductUrl(location: WeatherForecastLocation, product: WeatherForecastProduct): string {
  const lat = location.latitude.toFixed(4);
  const lon = location.longitude.toFixed(4);
  if (product === "nowcast") {
    return `https://api.met.no/weatherapi/nowcast/2.0/complete?lat=${lat}&lon=${lon}`;
  }
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
}

function forecastCacheKey(location: WeatherForecastLocation, product: WeatherForecastProduct) {
  return `${product}:${location.id}`;
}

function isoFromTime(value: number | undefined): string | undefined {
  return value !== undefined && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
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

function moreSevere(a: WeatherRiskLevel, b: WeatherRiskLevel): WeatherRiskLevel {
  return moreSevereWeatherRiskLevel(a, b);
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

function parseMetForecast(
  payload: MetCompactResponse,
  product: WeatherForecastProduct,
): {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
  updatedAt: string;
} {
  const timeseries = (payload.properties?.timeseries ?? []).filter(
    (point) => Boolean(point.time) && Boolean(point.data?.instant?.details),
  );
  const first = timeseries[0];
  if (!first?.time) {
    throw new Error(`MET ${product} payload mangler gyldig timeserie`);
  }

  const instant = first.data?.instant?.details ?? {};
  const nextHour = first.data?.next_1_hours;
  const updatedAt = payload.properties?.meta?.updated_at ?? first.time;
  const symbolCode = nextHour?.summary?.symbol_code;
  const precipitationNextHourMm = numberOrUndefined(nextHour?.details?.precipitation_amount);
  const airTemperatureC = numberOrUndefined(instant.air_temperature);
  const windSpeedMps = numberOrUndefined(instant.wind_speed);
  const windDirectionDeg = numberOrUndefined(instant.wind_from_direction);
  const productLabel = product === "nowcast" ? "MET Nowcast" : "MET Locationforecast";

  return {
    current: {
      summary: `${productLabel}: ${symbolText(symbolCode)} nå`,
      updatedAt,
      ...(airTemperatureC !== undefined ? { airTemperatureC } : {}),
      ...(windSpeedMps !== undefined ? { windSpeedMps } : {}),
      ...(windDirectionDeg !== undefined ? { windDirectionDeg } : {}),
      ...(precipitationNextHourMm !== undefined ? { precipitationNextHourMm } : {}),
      ...(symbolCode ? { symbolCode } : {}),
      dataStatus: "ok",
      sourceLabel: productLabel,
    },
    hourly: timeseries.slice(0, product === "nowcast" ? 4 : 24).map((point) => ({
      time: point.time ?? "",
      airTemperatureC: numberOrUndefined(point.data?.instant?.details?.air_temperature),
      windSpeedMps: numberOrUndefined(point.data?.instant?.details?.wind_speed),
      windDirectionDeg: numberOrUndefined(point.data?.instant?.details?.wind_from_direction),
      precipitationMm: numberOrUndefined(point.data?.next_1_hours?.details?.precipitation_amount),
      symbolCode: point.data?.next_1_hours?.summary?.symbol_code,
      sourceProduct: product,
    })),
    updatedAt,
  };
}

export function parseMetLocationForecast(payload: MetCompactResponse): {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
} {
  const parsed = parseMetForecast(payload, "locationforecast");
  return { current: parsed.current, hourly: parsed.hourly.slice(0, 8) };
}

async function fetchMetProduct(
  location: WeatherForecastLocation,
  product: WeatherForecastProduct,
): Promise<ForecastProductFetch> {
  const cacheKey = forecastCacheKey(location, product);
  const now = new Date();
  const cached = forecastCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const parsed = parseMetForecast(cached.payload, product);
    return {
      current: parsed.current,
      hourly: parsed.hourly,
      metadata: {
        source: "met",
        product,
        locationId: location.id,
        fetchedAt: cached.fetchedAt,
        updatedAt: parsed.updatedAt,
        expiresAt: isoFromTime(cached.expiresAt),
        cacheStatus: "hit",
        dataStatus: "ok",
        detail: `${product === "nowcast" ? "Nowcast" : "Locationforecast"} hentet fra mellomlager.`,
      },
    };
  }

  const response = await fetch(metProductUrl(location, product), {
    headers: { "User-Agent": MET_USER_AGENT },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error(`MET ${product} failed with ${response.status}`);
  }
  const payload = (await response.json()) as MetCompactResponse;
  const parsed = parseMetForecast(payload, product);
  const expiresHeader = response.headers.get("Expires") ?? response.headers.get("expires");
  const expiresAt = expiresHeader ? Date.parse(expiresHeader) : Date.now() + 15 * 60 * 1000;
  const safeExpiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 15 * 60 * 1000;
  const fetchedAt = now.toISOString();
  forecastCache.set(cacheKey, {
    expiresAt: safeExpiresAt,
    fetchedAt,
    payload,
  });
  return {
    current: parsed.current,
    hourly: parsed.hourly,
    metadata: {
      source: "met",
      product,
      locationId: location.id,
      fetchedAt,
      updatedAt: parsed.updatedAt,
      expiresAt: isoFromTime(safeExpiresAt),
      cacheStatus: "miss",
      dataStatus: "ok",
      detail: `${product === "nowcast" ? "Nowcast" : "Locationforecast"} hentet direkte fra MET.`,
    },
  };
}

export async function fetchMetLocationForecast(): Promise<{
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
}> {
  const result = await fetchMetProduct(weatherForecastLocations[0]!, "locationforecast");
  return { current: result.current, hourly: result.hourly.slice(0, 8) };
}

function failedProductMetadata(
  location: WeatherForecastLocation,
  product: WeatherForecastProduct,
  now: Date,
  error: unknown,
): WeatherForecastMetadata {
  return {
    source: "met",
    product,
    locationId: location.id,
    fetchedAt: now.toISOString(),
    cacheStatus: "fallback",
    dataStatus: "unavailable",
    detail: `${product === "nowcast" ? "Nowcast" : "Locationforecast"} er midlertidig utilgjengelig: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

function mergeNowcastIntoHourly(
  locationforecast: WeatherHourlyPoint[],
  nowcast: WeatherHourlyPoint[],
): WeatherHourlyPoint[] {
  if (!nowcast.length) return locationforecast;
  const nowcastByHour = new Map(nowcast.map((point) => [point.time, point]));
  return locationforecast.map((point) => {
    const nearTerm = nowcastByHour.get(point.time);
    if (!nearTerm) return point;
    return {
      ...point,
      precipitationMm: nearTerm.precipitationMm ?? point.precipitationMm,
      symbolCode: nearTerm.symbolCode ?? point.symbolCode,
      sourceProduct: "nowcast",
    };
  });
}

function fallbackZone(
  location: WeatherForecastLocation,
  now: Date,
  metadata: WeatherForecastMetadata[],
): WeatherForecastZone {
  const current: WeatherCurrentSummary = {
    summary: "MET Locationforecast: midlertidig utilgjengelig",
    updatedAt: now.toISOString(),
    dataStatus: "unavailable",
    sourceLabel: "MET Locationforecast",
  };
  return {
    location,
    current,
    hourly: [],
    nowcast: [],
    metadata,
    dataStatus: "unavailable",
    summary: "Værdata er midlertidig utilgjengelig for dette området.",
  };
}

async function fetchWeatherForecastZone(
  location: WeatherForecastLocation,
  now: Date,
): Promise<WeatherForecastZone> {
  const [locationResult, nowcastResult] = await Promise.allSettled([
    fetchMetProduct(location, "locationforecast"),
    fetchMetProduct(location, "nowcast"),
  ]);
  const metadata: WeatherForecastMetadata[] = [];
  let locationforecast: ForecastProductFetch | undefined;
  let nowcast: ForecastProductFetch | undefined;

  if (locationResult.status === "fulfilled") {
    locationforecast = locationResult.value;
    metadata.push(locationResult.value.metadata);
  } else {
    metadata.push(failedProductMetadata(location, "locationforecast", now, locationResult.reason));
  }

  if (nowcastResult.status === "fulfilled") {
    nowcast = nowcastResult.value;
    metadata.push(nowcastResult.value.metadata);
  } else {
    metadata.push(failedProductMetadata(location, "nowcast", now, nowcastResult.reason));
  }

  if (!locationforecast) return fallbackZone(location, now, metadata);

  const hourly = mergeNowcastIntoHourly(locationforecast.hourly, nowcast?.hourly ?? []);
  const current = {
    ...locationforecast.current,
    precipitationNextHourMm:
      nowcast?.current.precipitationNextHourMm ?? locationforecast.current.precipitationNextHourMm,
    symbolCode: nowcast?.current.symbolCode ?? locationforecast.current.symbolCode,
    dataStatus: nowcast ? "ok" : ("partial" as WeatherDataStatus),
    sourceLabel: nowcast ? "MET Locationforecast + Nowcast" : "MET Locationforecast",
  };
  const dataStatus: WeatherDataStatus = metadata.every((item) => item.dataStatus === "ok")
    ? "ok"
    : "partial";
  return {
    location,
    current,
    hourly,
    nowcast: nowcast?.hourly ?? [],
    metadata,
    dataStatus,
    summary: `${symbolText(current.symbolCode)} nå, ${formatForecastTemp(current.airTemperatureC)} og ${formatForecastPrecip(current.precipitationNextHourMm)} neste time.`,
  };
}

function formatForecastTemp(value: number | undefined): string {
  return value === undefined ? "ukjent temperatur" : `${Math.round(value)}°`;
}

function formatForecastPrecip(value: number | undefined): string {
  if (value === undefined) return "ukjent nedbør";
  if (value === 0) return "ingen nedbør";
  return `${Math.round(value * 10) / 10} mm`;
}

function aggregateCacheStatus(products: WeatherForecastMetadata[]): WeatherCacheStatus {
  if (products.some((product) => product.cacheStatus === "fallback")) return "fallback";
  if (products.length && products.every((product) => product.cacheStatus === "hit")) return "hit";
  return "miss";
}

function aggregateDataStatus(products: WeatherForecastMetadata[]): WeatherDataStatus {
  if (!products.length || products.every((product) => product.dataStatus === "unavailable")) {
    return "unavailable";
  }
  if (products.every((product) => product.dataStatus === "ok")) return "ok";
  if (products.some((product) => product.dataStatus === "stale")) return "stale";
  return "partial";
}

async function fetchWeatherForecastBundle(now: Date): Promise<ForecastBundle> {
  const zones = await Promise.all(
    weatherForecastLocations.map((location) => fetchWeatherForecastZone(location, now)),
  );
  const primary = zones.find((zone) => zone.location.id === PRIMARY_LOCATION_ID) ?? zones[0]!;
  const products = zones.flatMap((zone) => zone.metadata);
  const forecast: WeatherForecastOverview = {
    primaryLocationId: primary.location.id,
    generatedAt: now.toISOString(),
    zones,
    sourceDetail:
      "MET Locationforecast gir ordinær prognose. MET Nowcast brukes for nærmeste nedbør der den er tilgjengelig.",
  };
  const quality: WeatherQualitySummary = {
    dataStatus: aggregateDataStatus(products),
    cacheStatus: aggregateCacheStatus(products),
    fetchedAt: now.toISOString(),
    expiresAt: products
      .map((product) => product.expiresAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0],
    detail:
      aggregateDataStatus(products) === "ok"
        ? "Værdata er fersk fra MET for alle lokale soner."
        : "Noen værprodukter mangler eller er degradert; Nytt viser beste tilgjengelige prognose.",
    products,
    roadWeatherFreshCount: 0,
    roadWeatherStaleCount: 0,
  };
  return {
    location: primary.location,
    current: primary.current,
    hourly: primary.hourly.slice(0, 24),
    forecast,
    quality,
  };
}

function fallbackForecast(now: Date): {
  current: WeatherCurrentSummary;
  hourly: WeatherHourlyPoint[];
} {
  return {
    current: {
      summary: "MET Locationforecast: midlertidig utilgjengelig",
      updatedAt: now.toISOString(),
      dataStatus: "unavailable",
      sourceLabel: "MET Locationforecast",
    },
    hourly: [],
  };
}

function firstWarning(events: OfficialEvent[], predicate: (event: OfficialEvent) => boolean) {
  return events.find(predicate);
}

function roadWeatherStatus(
  freshRoadWeather: RoadWeatherObservation[],
  staleRoadWeatherCount: number,
): WeatherRiskItem {
  const risky = freshRoadWeather.filter((item) => roadWeatherObservationLevel(item) !== "normal");
  const first = risky[0] ?? freshRoadWeather[0];
  const worstLevel = risky.reduce(
    (level, item) => moreSevere(level, roadWeatherObservationLevel(item)),
    "normal" as WeatherRiskLevel,
  );
  const level: WeatherRiskLevel =
    worstLevel !== "normal" ? worstLevel : staleRoadWeatherCount > 0 ? "watch" : "normal";
  return {
    key: "roadConditions",
    label: "Føre",
    status: risky.length
      ? `${risky.length} ferske vegstasjon(er) med krevende føre`
      : staleRoadWeatherCount > 0 && freshRoadWeather.length === 0
        ? "Venter på ferske vegværmålinger"
        : "Ingen særskilt føremelding",
    level,
    source: "Statens vegvesen DATEX",
    confidence: freshRoadWeather.length ? "Middels" : "Lav",
    nextChange: freshRoadWeather.length
      ? "Oppdateres fra vegstasjoner"
      : "Venter på DATEX værstasjoner",
    detail:
      first?.rawSummary ??
      (staleRoadWeatherCount > 0
        ? `${staleRoadWeatherCount} eldre vegværmåling(er) holdes utenfor risikovurderingen.`
        : "Vegvesen road-weather stations brukes som kontekst for føre og sikt."),
    dataStatus:
      freshRoadWeather.length > 0 ? "ok" : staleRoadWeatherCount > 0 ? "stale" : "unavailable",
    freshness: freshRoadWeather.length
      ? `${freshRoadWeather.length} ferske stasjoner`
      : staleRoadWeatherCount > 0
        ? "Kun eldre stasjonsdata"
        : "Ingen stasjonsdata",
  };
}

function buildWarnings(events: OfficialEvent[]): WeatherWarningSummary[] {
  return events.map((event) => ({
    id: event.id,
    source: event.source === "met" ? "met" : "nve",
    sourceLabel: warningSourceLabel(event),
    title: event.title,
    area: event.areaLabel,
    level: officialLevelLabel(event.severity),
    severityRank: warningSeverityRank(event.severity),
    eventType: event.eventType,
    state: event.state,
    validFrom: event.validFrom,
    validUntil: event.validTo,
    url: event.sourceUrl,
    ...(event.geometry ? { geometry: event.geometry } : {}),
  }));
}

function buildActions(
  risks: WeatherRiskItem[],
  warnings: WeatherWarningSummary[],
): WeatherPreparednessAction[] {
  const actions: WeatherPreparednessAction[] = [];
  const precipitation = risks.find((risk) => risk.key === "precipitation");
  const wind = risks.find((risk) => risk.key === "wind");
  const flood = risks.find((risk) => risk.key === "floodLandslide");
  const severeWeather = [precipitation, wind, flood].some((risk) => risk?.level === "severe");
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

  if (severeWeather) {
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
  freshRoadWeather: RoadWeatherObservation[],
  staleRoadWeatherCount: number,
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
  const forecastUnavailable = forecast.current.dataStatus === "unavailable";
  const forecastPrecip = forecast.current.precipitationNextHourMm ?? 0;
  const forecastWind = forecast.current.windSpeedMps ?? 0;
  const precipitationLevel = rainWarning
    ? levelFromSeverity(rainWarning.severity)
    : forecastUnavailable
      ? "watch"
      : forecastPrecip >= 5
        ? "warning"
        : forecastPrecip > 0
          ? "watch"
          : "normal";
  const windLevel = windWarning
    ? levelFromSeverity(windWarning.severity)
    : forecastUnavailable
      ? "watch"
      : forecastWind >= 15
        ? "warning"
        : forecastWind >= 8
          ? "watch"
          : "normal";
  const floodLevel = nveWarning ? levelFromSeverity(nveWarning.severity) : "normal";
  const roadRisk = roadWeatherStatus(freshRoadWeather, staleRoadWeatherCount);
  const weatherOnlyOverall = [precipitationLevel, windLevel, floodLevel].reduce(
    (level, next) => moreSevere(level, next),
    "normal" as WeatherRiskLevel,
  );
  const severeWeather = weatherOnlyOverall === "severe";

  return [
    {
      key: "precipitation",
      label: "Nedbør",
      status: rainWarning
        ? `${warningSourceLabel(rainWarning)}: ${officialLevelLabel(rainWarning.severity)} ${rainWarning.title.replace(/^MET farevarsel:\s*/i, "")}`
        : forecastUnavailable
          ? "Værprognose midlertidig utilgjengelig"
          : forecastPrecip > 0
            ? `${forecastPrecip.toFixed(1)} mm neste time`
            : "Lite eller ingen nedbør meldt",
      level: precipitationLevel,
      source: rainWarning ? "MET Locationforecast + MET farevarsel" : "MET Locationforecast",
      confidence: rainWarning ? "Høy" : forecastUnavailable ? "Lav" : "Middels",
      nextChange: rainWarning
        ? `Gjelder til ${compactTime(rainWarning.validTo)}`
        : forecastUnavailable
          ? "Venter på MET"
          : "Neste timesvarsel",
      detail:
        rainWarning?.detail ?? "Brukes til overvann, sluk og utsatte underganger i Trondheim.",
      dataStatus: forecastUnavailable ? "unavailable" : "ok",
    },
    {
      key: "wind",
      label: "Vind",
      status: windWarning
        ? `${warningSourceLabel(windWarning)}: ${officialLevelLabel(windWarning.severity)}`
        : forecastUnavailable
          ? "Vindprognose midlertidig utilgjengelig"
          : `${forecastWind.toFixed(1)} m/s`,
      level: windLevel,
      source: windWarning ? "MET Locationforecast + MET farevarsel" : "MET Locationforecast",
      confidence: windWarning ? "Høy" : forecastUnavailable ? "Lav" : "Middels",
      nextChange: windWarning
        ? `Gjelder til ${compactTime(windWarning.validTo)}`
        : forecastUnavailable
          ? "Venter på MET"
          : "Neste timesvarsel",
      detail:
        windWarning?.detail ??
        "Vind vurderes mot løse gjenstander, eksponerte bruer og utearrangement.",
      dataStatus: forecastUnavailable ? "unavailable" : "ok",
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
      dataStatus: nveWarning ? "ok" : "partial",
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
      dataStatus: severeWeather ? "partial" : "ok",
    },
    {
      key: "health",
      label: "Helse",
      status:
        forecast.current.airTemperatureC === undefined
          ? "Værhelserisiko ikke vurdert"
          : forecast.current.airTemperatureC <= -10
            ? "Kulderisiko for sårbare grupper"
            : forecast.current.airTemperatureC >= 26
              ? "Varmerisiko for sårbare grupper"
              : "Ingen særskilt værhelserisiko",
      level:
        forecast.current.airTemperatureC === undefined
          ? "watch"
          : forecast.current.airTemperatureC <= -10 || forecast.current.airTemperatureC >= 26
            ? "watch"
            : "normal",
      source: "MET/DSB",
      confidence: forecast.current.airTemperatureC === undefined ? "Lav" : "Middels",
      nextChange:
        forecast.current.airTemperatureC === undefined
          ? "Venter på MET"
          : "Følg temperaturendringer",
      detail:
        "Vurder eldre, barn, kronisk syke og personer som må oppholde seg ute ved varme/kulde.",
      dataStatus: forecast.current.airTemperatureC === undefined ? "unavailable" : "ok",
    },
  ];
}

function buildImpactGroups(risks: WeatherRiskItem[]): WeatherImpactGroup[] {
  const riskByKey = new Map(risks.map((risk) => [risk.key, risk]));
  const precipitation = riskByKey.get("precipitation")!;
  const wind = riskByKey.get("wind")!;
  const road = riskByKey.get("roadConditions")!;
  const health = riskByKey.get("health")!;
  const flood = riskByKey.get("floodLandslide")!;
  const power = riskByKey.get("powerTelecom")!;
  const outdoorWeather = moreSevere(precipitation.level, wind.level);
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
      status: outdoorWeather === "normal" ? "Normal drift" : "Uteaktivitet bør vurderes",
      level: outdoorWeather,
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

function buildMapLayers(warnings: WeatherWarningSummary[]): WeatherMapLayer[] {
  const hasMetGeometry = warnings.some((warning) => warning.source === "met" && warning.geometry);
  return [
    {
      id: "met-warnings",
      title: "MET farevarselgeometri",
      source: "MET",
      status: hasMetGeometry ? "available" : "planned",
      detail: hasMetGeometry
        ? "MetAlerts-varsel tegnes med kildegeometri når MET leverer polygon."
        : "MetAlerts-varsel er kildegrunnlag; polygonlaget aktiveres når MET leverer geometri.",
    },
    {
      id: "nve-warning-areas",
      title: "NVE flom- og skredområder",
      source: "NVE/Varsom",
      status: "planned",
      detail: "Flom- og skredvarsel bør vises komplett og kilde-merket fra Varsom.",
    },
    {
      id: "trondheim-overvann",
      title: "Trondheim flomveier og overvann",
      source: "Trondheim kommune",
      status: "planned",
      detail:
        "Kommunale flomveier og overvannstema legges som kontekst når åpne lag er tilgjengelige.",
    },
    {
      id: "datex-road-weather",
      title: "Vegvesen værstasjoner langs vei",
      source: "Statens vegvesen DATEX",
      status: "available",
      detail: "Værstasjoner langs veg brukes for føre, sikt og våt/isete veibane.",
    },
    {
      id: "traffic-public-transport",
      title: "Trafikk- og kollektivkonsekvenser",
      source: "Nytt trafikkart/Entur/Vegvesen",
      status: "available",
      detail: "Eksisterende trafikk- og kollektivdata gir konsekvenskontekst.",
    },
  ];
}

function isForecastBundle(value: ForecastBundle | LegacyForecastInput): value is ForecastBundle {
  return "forecast" in value || "quality" in value || "location" in value;
}

function forecastBundleFromLegacy(forecast: LegacyForecastInput, now: Date): ForecastBundle {
  const primaryLocation = weatherForecastLocations[0]!;
  const metadata: WeatherForecastMetadata = {
    source: "met",
    product: "locationforecast",
    locationId: primaryLocation.id,
    fetchedAt: now.toISOString(),
    updatedAt: forecast.current.updatedAt,
    cacheStatus: forecast.current.dataStatus === "unavailable" ? "fallback" : "miss",
    dataStatus: forecast.current.dataStatus ?? "ok",
    detail: "Enkelt prognosepunkt brukt som bakoverkompatibel værpayload.",
  };
  const zone: WeatherForecastZone = {
    location: primaryLocation,
    current: forecast.current,
    hourly: forecast.hourly,
    nowcast: [],
    metadata: [metadata],
    dataStatus: forecast.current.dataStatus ?? "ok",
    summary: forecast.current.summary,
  };
  return {
    location: primaryLocation,
    current: forecast.current,
    hourly: forecast.hourly,
    forecast: {
      primaryLocationId: primaryLocation.id,
      generatedAt: now.toISOString(),
      zones: [zone],
      sourceDetail: "MET Locationforecast for Trondheim sentrum.",
    },
    quality: {
      dataStatus: metadata.dataStatus,
      cacheStatus: metadata.cacheStatus,
      fetchedAt: now.toISOString(),
      detail:
        metadata.dataStatus === "ok"
          ? "Værdata er tilgjengelig for Trondheim sentrum."
          : "Værdata er degradert; Nytt viser beste tilgjengelige informasjon.",
      products: [metadata],
      roadWeatherFreshCount: 0,
      roadWeatherStaleCount: 0,
    },
  };
}

export async function buildWeatherPreparednessPayload(input: {
  officialEvents: OfficialEvent[];
  roadWeather: RoadWeatherObservation[];
  sourceHealth: SourceHealth[];
  now?: Date;
  forecast?: ForecastBundle | LegacyForecastInput;
}): Promise<WeatherPreparednessPayload> {
  const now = input.now ?? new Date();
  const forecastBundle = input.forecast
    ? isForecastBundle(input.forecast)
      ? input.forecast
      : forecastBundleFromLegacy(input.forecast, now)
    : forecastBundleFromLegacy(fallbackForecast(now), now);
  const freshRoadWeather = input.roadWeather.filter((observation) =>
    isFreshRoadWeatherObservation(observation, now, ROAD_WEATHER_STALE_AFTER_MS),
  );
  const staleRoadWeatherCount = input.roadWeather.length - freshRoadWeather.length;
  const relevantOfficialEvents = input.officialEvents
    .filter(
      (event) =>
        (event.source === "met" || event.source === "nve") && isRelevantWarning(event, now),
    )
    .sort(compareWarningsBySeverityThenRecency);
  const warnings = buildWarnings(relevantOfficialEvents);
  const risks = buildRisks(
    forecastBundle,
    warnings,
    relevantOfficialEvents,
    freshRoadWeather,
    staleRoadWeatherCount,
  );
  const quality: WeatherQualitySummary = {
    ...forecastBundle.quality!,
    roadWeatherFreshCount: freshRoadWeather.length,
    roadWeatherStaleCount: staleRoadWeatherCount,
    dataStatus:
      forecastBundle.quality?.dataStatus === "ok" && staleRoadWeatherCount === 0
        ? "ok"
        : forecastBundle.quality?.dataStatus === "unavailable"
          ? "unavailable"
          : "partial",
    detail:
      staleRoadWeatherCount > 0
        ? `${forecastBundle.quality?.detail ?? "Værdata er tilgjengelig."} ${staleRoadWeatherCount} eldre vegværmåling(er) er holdt utenfor risikovurderingen.`
        : (forecastBundle.quality?.detail ?? "Værdata er tilgjengelig."),
  };
  return {
    generatedAt: now.toISOString(),
    location: forecastBundle.location,
    forecast: forecastBundle.forecast,
    quality,
    current: forecastBundle.current,
    hourly: forecastBundle.hourly,
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
    roadWeather: freshRoadWeather.slice(0, 10),
    mapLayers: buildMapLayers(warnings),
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
  const now = input.now ?? new Date();
  const forecast = await fetchWeatherForecastBundle(now);
  return buildWeatherPreparednessPayload({ ...input, forecast });
}
