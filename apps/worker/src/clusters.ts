import { createHash } from "node:crypto";
import type { Article, EvidenceItem, MapFeature, OfficialEvent, Situation } from "@nytt/shared";

interface CandidateGroup {
  key: string;
  type: Situation["type"];
  place: string;
  articles: Article[];
}

const clusterWindowMs = 12 * 60 * 60 * 1000;
const genericPlaces = new Set(["trondheim", "trøndelag"]);

function slug(value: string): string {
  return value
    .toLocaleLowerCase("nb")
    .replaceAll(/[^a-z0-9æøå]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export function detectPreliminarySituations(
  articles: Article[],
  officialEvents: OfficialEvent[] = [],
  existingSituations: Situation[] = [],
): Situation[] {
  const existingBySignature = new Map(
    existingSituations
      .filter((situation) => situation.incidentSignature)
      .map((situation) => [situation.incidentSignature!, situation]),
  );
  const groups = new Map<string, CandidateGroup>();
  for (const article of articles) {
    const type = detectType(article);
    const place = specificPlace(article);
    if (!place || !type) continue;
    const key = `${type}:${slug(place)}`;
    const group = groups.get(key) ?? { key, type, place, articles: [] };
    group.articles.push(article);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) => {
    const existing = existingBySignature.get(group.key);
    if (existing?.status === "dismissed") return [];
    const ordered = [...group.articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const latest = ordered[0]!;
    const latestTime = new Date(latest.publishedAt).getTime();
    const activationReports = ordered.filter(
      (article) => latestTime - new Date(article.publishedAt).getTime() <= clusterWindowMs,
    );
    if (!existing && new Set(activationReports.map((article) => article.source)).size < 2) {
      return [];
    }
    const currentReports = existing ? ordered : activationReports;
    const id = existing?.id ?? `auto-${slug(group.key)}`;
    const evidence: EvidenceItem[] = currentReports.map((article) => ({
      id: createHash("sha1").update(`${id}:${article.id}`).digest("hex").slice(0, 18),
      situationId: id,
      source: article.source,
      sourceLabel: article.sourceLabel,
      sourceUrl: article.url,
      supportingSnippet: article.excerpt,
      claim: article.title,
      claimType: "reporting_match",
      provenance: "reporting_estimate",
      confidence: 0.6,
      extractedAt: new Date().toISOString(),
      publishedAt: article.publishedAt,
    }));
    const locatedReport = currentReports.find((article) => article.location) ?? latest;
    const contextualWarnings = warningEventsForSituation(locatedReport, group.type, officialEvents);
    const features = [
      ...reportingFeatures(id, currentReports),
      ...contextualWarnings.flatMap((event) => warningFeature(id, event)),
    ];
    const municipalReports = currentReports.filter(
      (article) => article.source === "trondheim_kommune",
    );
    const corroborated = municipalReports.length > 0;
    const resolved = municipalReports.some((article) =>
      /\b(slukket|slokket|avsluttet|opphevet|funnet i god behold)\b/i.test(
        `${article.title} ${article.excerpt}`,
      ),
    );
    const officialEvidence = municipalReports.map((article) => ({
      id: createHash("sha1").update(`${id}:official:${article.id}`).digest("hex").slice(0, 18),
      situationId: id,
      source: article.source,
      sourceLabel: article.sourceLabel,
      sourceUrl: article.url,
      supportingSnippet: article.excerpt,
      claim: article.title,
      claimType: resolved ? "official_resolution" : "official_corroboration",
      provenance: "official" as const,
      confidence: 1,
      extractedAt: new Date().toISOString(),
      publishedAt: article.publishedAt,
    }));
    const warningEvidence = contextualWarnings.map((event) => ({
      id: createHash("sha1").update(`${id}:warning:${event.id}`).digest("hex").slice(0, 18),
      situationId: id,
      source: event.source,
      sourceLabel: event.source === "met" ? "MET farevarsel" : "NVE / Varsom",
      sourceUrl: event.sourceUrl,
      supportingSnippet: event.detail,
      claim: event.title,
      claimType: "official_warning_context",
      provenance: "official" as const,
      confidence: 1,
      extractedAt: new Date().toISOString(),
      publishedAt: event.publishedAt,
    }));
    return [
      {
        id,
        type: group.type,
        title: latest.title,
        summary:
          "Foreløpig samling av relaterte, publiserte saker. Opplysninger må verifiseres mot originalkildene.",
        status: resolved ? "resolved" : corroborated ? "active" : "preliminary",
        verificationStatus: corroborated ? "Offentlig bekreftet" : "Foreløpig fra rapportering",
        importance: contextualWarnings.length > 0 || corroborated ? "high" : "normal",
        updatedAt: latest.publishedAt,
        createdAt:
          existing?.createdAt ??
          [...currentReports].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))[0]!
            .publishedAt,
        locationLabel: group.place,
        incidentSignature: group.key,
        detectionVersion: "2",
        activationBasis: existing?.activationBasis ?? {
          rule: "two_independent_sources",
          sourceIds: [...new Set(activationReports.map((article) => article.source))],
          articleIds: activationReports.map((article) => article.id),
          activatedAt: latest.publishedAt,
        },
        relatedArticleIds: currentReports.map((article) => article.id),
        evidence: [...evidence, ...officialEvidence, ...warningEvidence],
        features,
        timeline: [
          ...currentReports.map((article) => ({
            id: `timeline-${article.id}`,
            situationId: id,
            timestamp: article.publishedAt,
            title: article.title,
            detail: article.excerpt,
            sourceLabel: article.sourceLabel,
            sourceUrl: article.url,
            official: article.source === "trondheim_kommune",
          })),
          ...contextualWarnings.map((event) => ({
            id: `timeline-${event.id}`,
            situationId: id,
            timestamp: event.publishedAt,
            title: event.title,
            detail: event.detail,
            sourceLabel: event.source === "met" ? "MET farevarsel" : "NVE / Varsom",
            sourceUrl: event.sourceUrl,
            official: true,
          })),
        ],
      } satisfies Situation,
    ];
  });
}

function warningEventsForSituation(
  article: Article,
  type: Situation["type"],
  events: OfficialEvent[],
): OfficialEvent[] {
  const location = article.location;
  return events.filter((event) => {
    if (event.state === "cancelled" || new Date(event.validTo).getTime() < Date.now()) return false;
    if (event.eventType !== type) return false;
    if (event.source === "nve") {
      return (
        article.scope === "trondheim" &&
        event.areaLabel.toLocaleLowerCase("nb").includes("trondheim")
      );
    }
    return Boolean(
      location && event.geometry && containsPoint(event.geometry, location.lng, location.lat),
    );
  });
}

function warningFeature(id: string, event: OfficialEvent): MapFeature[] {
  if (!event.geometry) return [];
  return [
    {
      id: createHash("sha1").update(`${id}:warning-feature:${event.id}`).digest("hex").slice(0, 18),
      type: "Feature",
      geometry: event.geometry,
      properties: {
        label: event.title,
        provenance: "official",
        sourceLabel: "MET farevarsel",
        sourceUrl: event.sourceUrl,
        updatedAt: event.publishedAt,
        layer: "warning",
      },
    },
  ];
}

function containsPoint(geometry: MapFeature["geometry"], lng: number, lat: number): boolean {
  if (geometry.type === "Point") {
    return geometry.coordinates[0] === lng && geometry.coordinates[1] === lat;
  }
  if (geometry.type === "Polygon") return polygonContains(geometry.coordinates[0] ?? [], lng, lat);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygonContains(polygon[0] ?? [], lng, lat));
  }
  return false;
}

function polygonContains(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [aLng, aLat] = a;
    const [bLng, bLat] = b;
    if (aLng === undefined || aLat === undefined || bLng === undefined || bLat === undefined) {
      continue;
    }
    const intersects =
      aLat > lat !== bLat > lat && lng < ((bLng - aLng) * (lat - aLat)) / (bLat - aLat) + aLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function reportingFeatures(id: string, articles: Article[]): MapFeature[] {
  const points = new Map<string, MapFeature>();
  for (const article of articles) {
    if (!article.location) continue;
    const key = `${article.location.lat}:${article.location.lng}`;
    if (points.has(key)) continue;
    points.set(key, {
      id: createHash("sha1").update(`${id}:point:${key}`).digest("hex").slice(0, 18),
      type: "Feature",
      geometry: { type: "Point", coordinates: [article.location.lng, article.location.lat] },
      properties: {
        label: `${article.location.label} - geokodet anslag fra rapportering`,
        provenance: "reporting_estimate",
        sourceLabel: article.sourceLabel,
        sourceUrl: article.url,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return [...points.values()];
}

function specificPlace(article: Article): string | undefined {
  return article.places.find((place) => !genericPlaces.has(place.toLocaleLowerCase("nb")));
}

function detectType(article: Article): Situation["type"] | undefined {
  const text = `${article.title} ${article.excerpt}`.toLocaleLowerCase("nb");
  if (/\b(brann|skogbrann|røykutvikling)\b/.test(text)) return "fire";
  if (/\b(savnet|leteaksjon|forsvunnet)\b/.test(text)) return "missing_person";
  if (/\b(jordskred|ras)\b/.test(text)) return "landslide";
  if (/\bflom\b/.test(text)) return "flood";
  if (/\b(trafikkulykke|trafikkhendelse|kollisjon|bilstans|veiarbeid|kø)\b/.test(text)) {
    return "traffic";
  }
  if (/\b(ekstremvær|farevarsel|storm|orkan)\b/.test(text)) return "weather";
  if (/\b(redningsaksjon|ulykke)\b/.test(text)) return "rescue";
  if (/\b(evakuert|strømbrudd|vannbrudd)\b/.test(text)) return "service_disruption";
  return undefined;
}
