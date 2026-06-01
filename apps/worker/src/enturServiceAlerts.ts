import { createHash } from "node:crypto";
import type { MultiPoint, Point } from "geojson";
import type { PublicTransportServiceAlert, SourceItemInput } from "@nytt/shared";
import { enturHeaders } from "./enturVehicles.js";

export const enturJourneyPlannerEndpoint = "https://api.entur.io/journey-planner/v3/graphql";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceItemId(provider: string, kind: string, stableKey: string): string {
  return `source:${sha256(JSON.stringify([provider, kind, stableKey]))}`;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
  }
  const valueObject = object(value);
  if (valueObject && "value" in valueObject) return text(valueObject.value);
  return undefined;
}

function localizedText(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    const entries = value
      .map(object)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const norwegian = entries.find((entry) =>
      /^(no|nb|nn)$/i.test(text(entry.language) ?? text(entry.lang) ?? ""),
    );
    const unspecified = entries.find(
      (entry) => text(entry.language) === undefined && text(entry.lang) === undefined,
    );
    return text(norwegian?.value) ?? text(unspecified?.value) ?? text(entries[0]?.value);
  }
  return text(value);
}

function iso(value: unknown, fallback?: string): string | undefined {
  const input = text(value) ?? fallback;
  if (!input) return undefined;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validCoordinate(value: Record<string, unknown>): [number, number] | undefined {
  const lat = finite(value.latitude) ?? finite(value.lat);
  const lon = finite(value.longitude) ?? finite(value.lon) ?? finite(value.lng);
  if (lat === undefined || lon === undefined) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return [lon, lat];
}

function compactUnique(values: Array<string | undefined>): string[] | undefined {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return unique.length ? unique : undefined;
}

function collectAffectedObjects(
  alert: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const affects = object(alert.affects);
  const candidates = [affects?.[key], affects?.[`${key}s`], alert[key], alert[`${key}s`]];
  return candidates.flatMap((candidate) =>
    Array.isArray(candidate) ? candidate.map(object).filter(Boolean) : [],
  ) as Record<string, unknown>[];
}

function stopCoordinateObjects(stop: Record<string, unknown>): Record<string, unknown>[] {
  const quays = Array.isArray(stop.quays) ? stop.quays.map(object).filter(Boolean) : [];
  return [stop, ...quays] as Record<string, unknown>[];
}

function alertGeometry(stops: Record<string, unknown>[]): Point | MultiPoint | undefined {
  const coordinates = new Map<string, [number, number]>();
  for (const stop of stops) {
    for (const candidate of stopCoordinateObjects(stop)) {
      const coordinate = validCoordinate(candidate);
      if (coordinate) coordinates.set(`${coordinate[0]},${coordinate[1]}`, coordinate);
    }
  }
  const values = [...coordinates.values()];
  if (values.length === 0) return undefined;
  if (values.length === 1) return { type: "Point", coordinates: values[0]! };
  return { type: "MultiPoint", coordinates: values };
}

function stateFromAlert(alert: Record<string, unknown>): PublicTransportServiceAlert["state"] {
  const lifecycle = [alert.state, alert.status]
    .map((value) => text(value)?.toLocaleLowerCase("en") ?? "")
    .join(" ");
  if (/cancelled|canceled/.test(lifecycle)) return "cancelled";
  if (/expired|closed|ended|inactive/.test(lifecycle)) return "expired";
  return "active";
}

export function parseEnturServiceAlerts(
  payload: string,
  options: { codespaceId: string; receivedAt: string },
): {
  alerts: PublicTransportServiceAlert[];
  activeSituationNumbers: string[];
  rawAlertsBySituationNumber: Map<string, unknown>;
} {
  const parsed = JSON.parse(payload) as {
    data?: { situations?: Array<Record<string, unknown>> };
    errors?: unknown;
  };
  if (parsed.errors) {
    throw new Error(
      `Entur service alert GraphQL returned errors: ${JSON.stringify(parsed.errors)}`,
    );
  }

  const alerts: PublicTransportServiceAlert[] = [];
  const rawAlertsBySituationNumber = new Map<string, unknown>();

  for (const alert of parsed.data?.situations ?? []) {
    const situationNumber = text(alert.situationNumber) ?? text(alert.id);
    if (!situationNumber) continue;

    const stops = collectAffectedObjects(alert, "stopPlace");
    const lines = collectAffectedObjects(alert, "line");
    const validity = object(alert.validityPeriod);
    const summary = localizedText(alert.summary) ?? localizedText(alert.description);
    if (!summary) continue;

    const updatedAt =
      iso(alert.versionedAtTime) ??
      iso(alert.updatedAt) ??
      iso(alert.creationTime) ??
      options.receivedAt;
    const normalized: PublicTransportServiceAlert = {
      id: `entur-service-alert:${options.codespaceId}:${situationNumber}`,
      source: "entur_service_alerts",
      codespaceId: options.codespaceId,
      situationNumber,
      severity: text(alert.severity),
      reportType: text(alert.reportType),
      summary,
      description: localizedText(alert.description),
      advice: localizedText(alert.advice),
      validFrom: iso(validity?.startTime ?? alert.validFrom),
      validTo: iso(validity?.endTime ?? alert.validTo),
      createdAt: iso(alert.creationTime),
      updatedAt,
      version: finite(alert.version),
      state: stateFromAlert(alert),
      geometry: alertGeometry(stops),
      affectedLineRefs: compactUnique(lines.map((line) => text(line.id) ?? text(line.lineRef))),
      affectedLineNames: compactUnique(
        lines.map((line) => text(line.name) ?? text(line.lineName) ?? text(line.publicCode)),
      ),
      affectedStopIds: compactUnique(stops.map((stop) => text(stop.id))),
      affectedStopNames: compactUnique(stops.map((stop) => text(stop.name))),
      infoLinks: Array.isArray(alert.infoLinks)
        ? alert.infoLinks.map(object).flatMap((link) => {
            const uri = text(link?.uri);
            return uri ? [{ uri, label: text(link?.label) }] : [];
          })
        : undefined,
    };
    alerts.push(normalized);
    rawAlertsBySituationNumber.set(situationNumber, alert);
  }

  return {
    alerts,
    activeSituationNumbers: alerts.map((alert) => alert.situationNumber),
    rawAlertsBySituationNumber,
  };
}

export function enturServiceAlertSourceItemInput(
  alert: PublicTransportServiceAlert,
  options: { fetchedAt: string; rawAlert: unknown },
): SourceItemInput {
  return {
    id: sourceItemId("entur", "official_event", `${alert.codespaceId}:${alert.situationNumber}`),
    provider: "entur",
    kind: "official_event",
    externalId: `${alert.codespaceId}:${alert.situationNumber}`,
    title: alert.summary,
    summary: alert.description,
    fetchedAt: options.fetchedAt,
    publishedAt: alert.createdAt,
    rawPayload: options.rawAlert,
    normalizedPayload: alert,
    captureHash: sha256(
      JSON.stringify([
        "entur",
        "official_event",
        alert.codespaceId,
        alert.situationNumber,
        alert.version ?? alert.updatedAt,
      ]),
    ),
    geoHint: alert.geometry,
    reliabilityTier: "official",
  };
}

export async function fetchEnturServiceAlerts({
  endpoint = enturJourneyPlannerEndpoint,
  clientName,
  codespaceId,
  receivedAt = new Date().toISOString(),
  fetcher = fetch,
}: {
  endpoint?: string;
  clientName: string;
  codespaceId: string;
  receivedAt?: string;
  fetcher?: typeof fetch;
}): Promise<ReturnType<typeof parseEnturServiceAlerts>> {
  const query = `query EnturServiceAlerts($codespaces: [String!]!) {
    situations(codespaces: $codespaces) {
      id situationNumber version creationTime versionedAtTime severity reportType
      summary { language value }
      description { language value }
      advice { language value }
      validityPeriod { startTime endTime }
      stopPlaces {
        id name latitude longitude
        quays { id name latitude longitude }
      }
      lines { id publicCode name }
      infoLinks { uri label }
    }
  }`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: enturHeaders(clientName),
    body: JSON.stringify({ query, variables: { codespaces: [codespaceId] } }),
  });
  if (!response.ok) throw new Error(`Entur service alert fetch failed ${response.status}`);
  return parseEnturServiceAlerts(await response.text(), { codespaceId, receivedAt });
}
