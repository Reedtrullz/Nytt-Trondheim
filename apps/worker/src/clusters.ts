import { createHash } from "node:crypto";
import type { Article, EvidenceItem, MapFeature, OfficialEvent, Situation } from "@nytt/shared";

interface CandidateGroup {
  key: string;
  articles: Article[];
}

const incidentCategories = new Set(["Hendelser", "Transport", "Vær"]);
const clusterWindowMs = 12 * 60 * 60 * 1000;

function slug(value: string): string {
  return value
    .toLocaleLowerCase("nb")
    .replaceAll(/[^a-z0-9æøå]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export function detectPreliminarySituations(
  articles: Article[],
  officialEvents: OfficialEvent[] = [],
): Situation[] {
  const groups = new Map<string, CandidateGroup>();
  for (const article of articles) {
    const place = article.places[0];
    if (!place || !incidentCategories.has(article.category)) continue;
    const type = detectType(article);
    const key = `${type}:${place}`;
    const group = groups.get(key) ?? { key, articles: [] };
    group.articles.push(article);
    groups.set(key, group);
  }

  return [...groups.values()].flatMap((group) => {
    const ordered = [...group.articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const latest = ordered[0]!;
    const latestTime = new Date(latest.publishedAt).getTime();
    const currentReports = ordered.filter(
      (article) => latestTime - new Date(article.publishedAt).getTime() <= clusterWindowMs,
    );
    if (new Set(currentReports.map((article) => article.source)).size < 2) return [];
    const id = `auto-${slug(group.key)}`;
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
    const contextualWarnings = warningEventsForSituation(locatedReport, officialEvents);
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
        type: detectType(latest),
        title: latest.title,
        summary:
          "Foreløpig samling av relaterte, publiserte saker. Opplysninger må verifiseres mot originalkildene.",
        status: resolved ? "resolved" : corroborated ? "active" : "preliminary",
        verificationStatus: corroborated ? "Offentlig bekreftet" : "Foreløpig fra rapportering",
        importance: contextualWarnings.length > 0 || corroborated ? "high" : "normal",
        updatedAt: latest.publishedAt,
        createdAt: [...currentReports].sort((a, b) =>
          a.publishedAt.localeCompare(b.publishedAt),
        )[0]!.publishedAt,
        locationLabel: latest.places[0]!,
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

function warningEventsForSituation(article: Article, events: OfficialEvent[]): OfficialEvent[] {
  const location = article.location;
  return events.filter((event) => {
    if (event.state === "cancelled" || new Date(event.validTo).getTime() < Date.now()) return false;
    if (event.eventType !== articleType(article)) return false;
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

function articleType(article: Article): Situation["type"] {
  return detectType(article);
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

function detectType(article: Article): Situation["type"] {
  const text = `${article.title} ${article.excerpt}`.toLocaleLowerCase("nb");
  if (/\b(brann|skogbrann|røyk)\b/.test(text)) return "fire";
  if (/\b(savnet|leteaksjon|forsvunnet)\b/.test(text)) return "missing_person";
  if (/\b(jordskred|ras)\b/.test(text)) return "landslide";
  if (/\bflom\b/.test(text)) return "flood";
  if (article.category === "Transport") return "traffic";
  if (article.category === "Vær") return "weather";
  if (/\b(redningsaksjon|ulykke)\b/.test(text)) return "rescue";
  if (/\b(evakuert|strømbrudd|vannbrudd)\b/.test(text)) return "service_disruption";
  return "other";
}
