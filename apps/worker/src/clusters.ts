import { createHash } from "node:crypto";
import type { Article, EvidenceItem, MapFeature, Situation } from "@nytt/shared";

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

export function detectPreliminarySituations(articles: Article[]): Situation[] {
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
    const features = reportingFeatures(id, currentReports);
    return [
      {
        id,
        type: detectType(latest),
        title: latest.title,
        summary:
          "Foreløpig samling av relaterte, publiserte saker. Opplysninger må verifiseres mot originalkildene.",
        status: "preliminary",
        verificationStatus: "Foreløpig fra rapportering",
        importance: "normal",
        updatedAt: latest.publishedAt,
        createdAt: [...currentReports].sort((a, b) =>
          a.publishedAt.localeCompare(b.publishedAt),
        )[0]!.publishedAt,
        locationLabel: latest.places[0]!,
        relatedArticleIds: currentReports.map((article) => article.id),
        evidence,
        features,
        timeline: currentReports.map((article) => ({
          id: `timeline-${article.id}`,
          situationId: id,
          timestamp: article.publishedAt,
          title: article.title,
          detail: article.excerpt,
          sourceLabel: article.sourceLabel,
          sourceUrl: article.url,
          official: false,
        })),
      } satisfies Situation,
    ];
  });
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
  if (/\b(flom|jordskred|ras)\b/.test(text)) return "flood";
  if (article.category === "Transport") return "traffic";
  if (article.category === "Vær") return "weather";
  if (/\b(redningsaksjon|ulykke)\b/.test(text)) return "rescue";
  if (/\b(evakuert|strømbrudd|vannbrudd)\b/.test(text)) return "service_disruption";
  return "other";
}
