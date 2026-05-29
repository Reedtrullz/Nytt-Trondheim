import type {
  OfficialEvent,
  SourceItem,
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TrafficMapEvent,
} from "@nytt/shared";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function datexRawField(raw: unknown, field: string): string | undefined {
  if (!isObject(raw) || !isObject(raw.datex)) return undefined;
  const value = raw.datex[field];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function categoryFromDatex(rawType?: string, title?: string, description?: string): TrafficEventCategory {
  const haystack = `${rawType ?? ""} ${title ?? ""} ${description ?? ""}`.toLocaleLowerCase("nb");
  if (/roadworks|maintenanceworks|veiarbeid|vegarbeid|veg arbeid|kantklipp/.test(haystack)) {
    return "roadworks";
  }
  if (/accident|ulykke|collision|kollisjon/.test(haystack)) return "accident";
  if (/closure|closed|stengt|sperret|blockage/.test(haystack)) return "closure";
  if (/congestion|queue|kø|koe|forsinkelse|slow traffic/.test(haystack)) return "congestion";
  if (/weather|vær|vaer|føre|fore|glatt|snø|sno|isete/.test(haystack)) return "weather";
  if (/restriction|restriksjon|begrensning|height|weight|bredde/.test(haystack)) {
    return "restriction";
  }
  if (/obstruction|hindring|debris|gjenstand|dyr/.test(haystack)) return "obstruction";
  return "other";
}

function severityFromDatex(
  severity?: string,
  category?: TrafficEventCategory,
): TrafficEventSeverity {
  const value = severity?.toLocaleLowerCase("en") ?? "";
  if (/highest|critical|severe|very high|major/.test(value)) return "critical";
  if (/high|serious/.test(value) || category === "closure" || category === "accident") return "high";
  if (/medium|moderate/.test(value) || category === "roadworks" || category === "congestion") {
    return "medium";
  }
  return "low";
}

function stateFromValidity(
  validFrom?: string,
  validTo?: string,
  officialState?: string,
): TrafficEventState {
  if (officialState === "cancelled") return "cancelled";
  if (officialState === "expired") return "expired";

  const now = Date.now();
  const from = validFrom ? Date.parse(validFrom) : Number.NaN;
  const to = validTo ? Date.parse(validTo) : Number.NaN;
  if (Number.isFinite(to) && to < now) return "expired";
  if (Number.isFinite(from) && from > now) return "planned";
  return "active";
}

export function officialEventToTrafficMapEvent(event: OfficialEvent): TrafficMapEvent | undefined {
  if (event.source !== "datex" || !event.geometry) return undefined;

  const rawType = datexRawField(event.raw, "recordKind") ?? event.eventType;
  const roadName = datexRawField(event.raw, "roadName") ?? datexRawField(event.raw, "roadNumber");
  const category = categoryFromDatex(rawType, event.title, event.detail);
  const severity = severityFromDatex(event.severity, category);

  return {
    id: `datex:${event.id}`,
    source: "datex",
    sourceEventId: event.id,
    category,
    severity,
    state: stateFromValidity(event.validFrom, event.validTo, event.state),
    title: event.title,
    description: event.detail,
    locationName: event.areaLabel,
    roadName,
    validFrom: event.validFrom,
    validTo: event.validTo,
    updatedAt: event.publishedAt,
    sourceUrl: event.sourceUrl,
    geometry: event.geometry,
    rawType,
  };
}

export function sourceItemToTrafficMapEvent(item: SourceItem): TrafficMapEvent | undefined {
  if (item.provider !== "datex" || !item.geoHint) return undefined;

  const category = categoryFromDatex(item.kind, item.title, item.summary);
  const severity = severityFromDatex(undefined, category);

  return {
    id: `datex-source-item:${item.id}`,
    source: "datex",
    sourceEventId: item.externalId ?? item.id,
    category,
    severity,
    state: "active",
    title: item.title ?? "Trafikkhendelse",
    description: item.summary,
    validFrom: item.publishedAt,
    updatedAt: item.fetchedAt,
    sourceUrl: item.originalUrl,
    geometry: item.geoHint,
    rawType: item.kind,
  };
}
