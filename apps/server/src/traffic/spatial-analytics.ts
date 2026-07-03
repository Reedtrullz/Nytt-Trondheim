import {
  sourceMixConfidenceSummary,
  type Article,
  type SpatialRawDataRef,
  type SpatialHeatmapCell,
  type SpatialInvestigationQueueItem,
  type TrafficCounterSnapshot,
  type TrafficCorridorImpact,
  type UnexplainedDelayCandidate,
} from "@nytt/shared";

const defaultMinDelaySeconds = 180;
const trafficKeywordPattern =
  /\b(?:bilk[øo]|forsink\w*|kork\w*|k[øo]\w*|omkj[øo]ring\w*|sakte|sperr\w*|steng\w*|trafikk\w*)\b/iu;

function articleText(article: Article): string {
  return `${article.title} ${article.excerpt} ${article.places.join(" ")} ${article.location?.label ?? ""}`
    .normalize("NFC")
    .toLocaleLowerCase("nb");
}

function corridorTokens(corridorName: string): string[] {
  const normalized = corridorName.normalize("NFC").toLocaleLowerCase("nb");
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/\b(?:e|rv|fv)\s*\d+[a-z]?\b/giu)) {
    tokens.add(match[0].replace(/\s+/gu, ""));
  }
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length >= 4) tokens.add(token);
  }
  return [...tokens];
}

function likelyMatchesCorridor(article: Article, corridorName: string): boolean {
  const text = articleText(article);
  if (!trafficKeywordPattern.test(text)) return false;
  const tokens = corridorTokens(corridorName);
  return tokens.length === 0 || tokens.some((token) => text.includes(token));
}

function confidenceForDelay(delaySeconds: number | undefined, state: string) {
  if (state === "congested" || (delaySeconds ?? 0) >= 600) return "critical" as const;
  if ((delaySeconds ?? 0) >= 300) return "warning" as const;
  return "watch" as const;
}

function delayMinutes(delaySeconds: number | undefined): number | undefined {
  if (delaySeconds === undefined) return undefined;
  return Math.max(1, Math.round(delaySeconds / 60));
}

function investigationDelayPriority(
  confidence: UnexplainedDelayCandidate["confidence"],
): SpatialInvestigationQueueItem["priority"] {
  switch (confidence) {
    case "critical":
      return "critical";
    case "warning":
      return "high";
    case "watch":
      return "watch";
  }
}

function investigationHotspotPriority(
  cell: SpatialHeatmapCell,
): SpatialInvestigationQueueItem["priority"] {
  const activeBuckets = heatmapActiveBucketCount(cell);
  const peakCount = heatmapPeakBucket(cell)?.count ?? 0;
  if (
    cell.maxSeverity === "critical" ||
    cell.trafficEventCount >= 3 ||
    cell.count >= 10 ||
    (activeBuckets >= 5 && peakCount >= 4 && (cell.trafficEventCount > 0 || cell.articleCount > 0))
  ) {
    return "critical";
  }
  if (
    cell.maxSeverity === "high" ||
    cell.trafficEventCount > 0 ||
    cell.activeDayCount >= 3 ||
    activeBuckets >= 3 ||
    peakCount >= 4 ||
    cell.count >= 4 ||
    (cell.articleCount > 0 && cell.sourceItemCount > 0)
  ) {
    return "high";
  }
  return "watch";
}

function priorityRank(priority: SpatialInvestigationQueueItem["priority"]): number {
  switch (priority) {
    case "critical":
      return 3;
    case "high":
      return 2;
    case "watch":
      return 1;
  }
  return 0;
}

function confidenceScore(item: { sourceConfidence?: { score?: number } }) {
  return item.sourceConfidence?.score ?? 0;
}

function trafficCounterPriority(
  counter: TrafficCounterSnapshot,
): SpatialInvestigationQueueItem["priority"] {
  const anomalyRatio = counter.anomalyRatio ?? 0;
  if (anomalyRatio >= 3 || (counter.volumeLastHour ?? 0) >= 3000) return "critical";
  if (anomalyRatio >= 1.7 || (counter.volumeLastHour ?? 0) >= 1500) return "high";
  return "watch";
}

function rawRefForTravelTime(
  travelTime: NonNullable<TrafficCorridorImpact["travelTime"]>,
): SpatialRawDataRef {
  return {
    type: "telemetry",
    source: "datex_travel_time",
    id: travelTime.id,
    label: "DATEX reisetid",
    observedAt: travelTime.measurementTo ?? travelTime.updatedAt,
  };
}

function rawRefForTrafficCounter(counter: TrafficCounterSnapshot): SpatialRawDataRef {
  return {
    type: "telemetry",
    source: "trafikkdata",
    id: counter.pointId,
    label: "Trafikkdata teller",
    observedAt: counter.updatedAt,
  };
}

function articleTitleLookup(articles: Article[]) {
  return new Map(articles.map((article) => [article.id, article.title]));
}

function countPhrase(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function activeDayPhrase(activeDayCount: number) {
  return countPhrase(activeDayCount, "aktiv dag", "aktive dager");
}

function bucketDayPhrase(bucketStart: string) {
  const date = new Date(bucketStart);
  if (!Number.isFinite(date.getTime())) return bucketStart.slice(0, 10);
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function heatmapBuckets(cell: SpatialHeatmapCell) {
  return (cell.timeBuckets ?? [])
    .filter((bucket) => Number.isFinite(bucket.count) && bucket.count > 0)
    .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart));
}

function heatmapActiveBucketCount(cell: SpatialHeatmapCell) {
  return Math.max(cell.activeDayCount, heatmapBuckets(cell).length);
}

function heatmapPeakBucket(cell: SpatialHeatmapCell) {
  return heatmapBuckets(cell).reduce<
    NonNullable<SpatialHeatmapCell["timeBuckets"]>[number] | undefined
  >((peak, bucket) => (!peak || bucket.count > peak.count ? bucket : peak), undefined);
}

function hotspotTemporalSummary(cell: SpatialHeatmapCell): string | undefined {
  const peak = heatmapPeakBucket(cell);
  if (!peak) return undefined;
  return `topp ${countPhrase(peak.count, "observasjon", "observasjoner")} ${bucketDayPhrase(peak.bucketStart)}`;
}

function hotspotReason(
  cell: SpatialHeatmapCell,
  priority: SpatialInvestigationQueueItem["priority"],
) {
  const activeBuckets = heatmapActiveBucketCount(cell);
  const peak = heatmapPeakBucket(cell);
  if (activeBuckets >= 3) {
    return `Tidsprofilen viser gjentatte observasjoner over ${activeDayPhrase(activeBuckets)}. Vurder som mulig svart punkt og kontroller mot kart og rådata.`;
  }
  if (peak && peak.count >= 4) {
    return `Tidsprofilen viser en tydelig topp ${bucketDayPhrase(peak.bucketStart)}. Kontroller om dette er en enkelthendelse eller start på et gjentakende punkt.`;
  }
  return priority === "watch"
    ? "Lavere tetthet, men synlig i romlig analyse."
    : "Tetthet, gjentakelse eller tverrkildesignal bør kontrolleres i kart og rådata.";
}

function delayEvidence(
  candidate: UnexplainedDelayCandidate,
  articleTitles: Map<string, string>,
): string[] {
  const evidence = [`DATEX reisetid: ${delayMinutes(candidate.delaySeconds) ?? "ukjent"} min`];
  if (candidate.matchedArticleIds.length > 0) {
    const titles = candidate.matchedArticleIds
      .flatMap((id) => {
        const title = articleTitles.get(id);
        return title ? [title] : [];
      })
      .slice(0, 2);
    evidence.push(
      titles.length > 0
        ? `Mulige saker: ${titles.join(" · ")}`
        : `${candidate.matchedArticleIds.length} mulige saker uten tittel i payload`,
    );
  } else {
    evidence.push("Ingen tydelig nyhetsforklaring");
  }
  evidence.push("Ingen romlig koblet trafikkhendelse");
  return evidence;
}

function hotspotEvidence(cell: SpatialHeatmapCell): string[] {
  const evidence = [countPhrase(cell.count, "observasjon", "observasjoner")];
  evidence.push(activeDayPhrase(cell.activeDayCount));
  const peak = heatmapPeakBucket(cell);
  if (peak) {
    evidence.push(
      `Toppdag ${bucketDayPhrase(peak.bucketStart)}: ${countPhrase(
        peak.count,
        "observasjon",
        "observasjoner",
      )}`,
    );
  }
  if (cell.articleCount > 0)
    evidence.push(countPhrase(cell.articleCount, "nyhetssak", "nyhetssaker"));
  if (cell.trafficEventCount > 0)
    evidence.push(countPhrase(cell.trafficEventCount, "trafikkhendelse", "trafikkhendelser"));
  if (cell.sourceItemCount > 0)
    evidence.push(countPhrase(cell.sourceItemCount, "råobservasjon", "råobservasjoner"));
  if (cell.maxSeverity) evidence.push(`Høyeste alvorlighet: ${cell.maxSeverity}`);
  return evidence;
}

function trafficCounterEvidence(counter: TrafficCounterSnapshot): string[] {
  const evidence: string[] = [];
  if (counter.volumeLastHour !== undefined) {
    evidence.push(
      countPhrase(counter.volumeLastHour, "kjøretøy siste time", "kjøretøy siste time"),
    );
  }
  if (counter.baselineVolumeLastHour !== undefined) {
    evidence.push(`Normalnivå: ${counter.baselineVolumeLastHour}`);
  }
  if (counter.anomalyRatio !== undefined) {
    evidence.push(`${counter.anomalyRatio.toFixed(1)}x normal trafikk`);
  }
  if (counter.coveragePercent !== undefined) {
    evidence.push(`${Math.round(counter.coveragePercent)} % dekning`);
  }
  if (counter.roadCategory || counter.roadNumber) {
    evidence.push([counter.roadCategory, counter.roadNumber].filter(Boolean).join(" "));
  }
  return evidence.length > 0 ? evidence : ["Trafikkdata-volum avviker fra forventet nivå"];
}

function isTrafficCounterAnomaly(counter: TrafficCounterSnapshot, minAnomalyRatio: number) {
  return (counter.anomalyRatio ?? 0) >= minAnomalyRatio;
}

export function buildUnexplainedDelayCandidates(
  impacts: TrafficCorridorImpact[],
  articles: Article[],
  options: { minDelaySeconds?: number } = {},
): UnexplainedDelayCandidate[] {
  const minDelaySeconds = options.minDelaySeconds ?? defaultMinDelaySeconds;

  return impacts
    .flatMap((impact): UnexplainedDelayCandidate[] => {
      const travelTime = impact.travelTime;
      if (!travelTime) return [];
      const delaySeconds = travelTime.delaySeconds ?? 0;
      if (delaySeconds < minDelaySeconds && travelTime.state !== "congested") return [];
      if (impact.affectedEventIds.length > 0) return [];

      const matchedArticleIds = articles
        .filter((article) => likelyMatchesCorridor(article, impact.name))
        .slice(0, 8)
        .map((article) => article.id);
      const minutes = delayMinutes(travelTime.delaySeconds);
      const confidence = confidenceForDelay(travelTime.delaySeconds, travelTime.state);
      const reason = matchedArticleIds.length
        ? `DATEX viser${minutes ? ` ca. ${minutes} min` : ""} forsinkelse uten romlig koblet hendelse. Trafikkord finnes i nyhetsstrømmen, men ingen sak er knyttet til korridoren.`
        : `DATEX viser${minutes ? ` ca. ${minutes} min` : ""} forsinkelse uten koblet trafikkhendelse eller tydelig nyhetsforklaring.`;

      return [
        {
          id: `delay:${impact.id}:${travelTime.id}`,
          corridorId: impact.id,
          corridorName: impact.name,
          geometry: impact.geometry,
          state: travelTime.state,
          ...(travelTime.delaySeconds !== undefined
            ? { delaySeconds: travelTime.delaySeconds }
            : {}),
          ...(travelTime.delayRatio !== undefined ? { delayRatio: travelTime.delayRatio } : {}),
          updatedAt: travelTime.measurementTo ?? travelTime.updatedAt,
          sourceUrl: travelTime.sourceUrl,
          matchedArticleIds,
          affectedEventIds: impact.affectedEventIds,
          confidence,
          reason,
          rawRefs: [rawRefForTravelTime(travelTime)],
        },
      ];
    })
    .sort((left, right) => {
      const confidenceRank = { critical: 3, warning: 2, watch: 1 };
      return (
        confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
        (right.delaySeconds ?? 0) - (left.delaySeconds ?? 0) ||
        right.updatedAt.localeCompare(left.updatedAt)
      );
    });
}

export function buildSpatialInvestigationQueue(
  delayCandidates: UnexplainedDelayCandidate[],
  heatmapCells: SpatialHeatmapCell[],
  articles: Article[],
  trafficCounters: TrafficCounterSnapshot[] = [],
  options: { limit?: number; minCounterAnomalyRatio?: number; from?: string; to?: string } = {},
): SpatialInvestigationQueueItem[] {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  const minCounterAnomalyRatio = options.minCounterAnomalyRatio ?? 1.7;
  const articleTitles = articleTitleLookup(articles);
  const delayItems = delayCandidates.map((candidate): SpatialInvestigationQueueItem => {
    const priority = investigationDelayPriority(candidate.confidence);
    return {
      id: `investigation:${candidate.id}`,
      kind: "unexplained_delay",
      priority,
      title: candidate.corridorName,
      summary: `${delayMinutes(candidate.delaySeconds) ?? "Ukjent"} min forsinkelse uten kjent årsak`,
      reason: candidate.reason,
      updatedAt: candidate.updatedAt,
      evidence: delayEvidence(candidate, articleTitles),
      articleIds: candidate.matchedArticleIds,
      sourceItemIds: [],
      ...(candidate.rawRefs?.length ? { rawRefs: candidate.rawRefs } : {}),
      ...(candidate.sourceConfidence ? { sourceConfidence: candidate.sourceConfidence } : {}),
      targetUrl: candidate.sourceUrl,
    };
  });
  const hotspotItems = heatmapCells.map((cell): SpatialInvestigationQueueItem => {
    const priority = investigationHotspotPriority(cell);
    const temporalSummary = hotspotTemporalSummary(cell);
    return {
      id: `investigation:${cell.id}`,
      kind: "hotspot",
      priority,
      title: `Varmepunkt ${cell.id.replace(/^cell:/u, "")}`,
      summary: `${cell.count} observasjoner over ${activeDayPhrase(
        heatmapActiveBucketCount(cell),
      )}${temporalSummary ? `, ${temporalSummary}` : ""} ved ${cell.center.lat.toFixed(3)}, ${cell.center.lng.toFixed(3)}`,
      reason: hotspotReason(cell, priority),
      updatedAt: cell.lastSeenAt,
      evidence: hotspotEvidence(cell),
      articleIds: [],
      sourceItemIds: cell.sourceItemIds ?? [],
      ...(cell.sourceConfidence ? { sourceConfidence: cell.sourceConfidence } : {}),
    };
  });
  const counterItems = trafficCounters
    .filter((counter) => isTrafficCounterAnomaly(counter, minCounterAnomalyRatio))
    .filter((counter) => {
      if (options.from && counter.updatedAt < options.from) return false;
      if (options.to && counter.updatedAt > options.to) return false;
      return true;
    })
    .map((counter): SpatialInvestigationQueueItem => {
      const priority = trafficCounterPriority(counter);
      const anomalyRatio = counter.anomalyRatio?.toFixed(1) ?? "ukjent";
      return {
        id: `investigation:traffic-counter:${counter.pointId}`,
        kind: "traffic_counter_anomaly",
        priority,
        title: counter.name,
        summary: `Trafikkdata viser ${anomalyRatio}x normal trafikk`,
        reason:
          "Trafikkdata er et kontekstsignal og bør kontrolleres mot kart, nyheter og DATEX før tiltak.",
        updatedAt: counter.updatedAt,
        evidence: trafficCounterEvidence(counter),
        articleIds: [],
        sourceItemIds: [],
        rawRefs: [rawRefForTrafficCounter(counter)],
        sourceConfidence: sourceMixConfidenceSummary(["trafikkdata"], {
          updatedAt: counter.updatedAt,
        }),
      };
    });

  return [...delayItems, ...hotspotItems, ...counterItems]
    .sort((left, right) => {
      const priorityDifference = priorityRank(right.priority) - priorityRank(left.priority);
      if (priorityDifference !== 0) return priorityDifference;
      const confidenceDifference = confidenceScore(right) - confidenceScore(left);
      if (confidenceDifference !== 0) return confidenceDifference;
      const recencyDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (recencyDifference !== 0 && Number.isFinite(recencyDifference)) return recencyDifference;
      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);
}
