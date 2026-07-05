import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  buildPublicNotificationSignalHighlights,
  publicNotificationTriggerGuidance,
  type Article,
  type BootstrapPayload,
  type CityPulseStory,
  type CityPulseStoryPage,
  type HomeSituationSummary,
  type MorningBrief,
  type PublicNotificationSignalHighlight,
  type NotificationTriggerSeverity,
  type SourceConfidenceSummary,
  type SourceHealth,
} from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon, ArticleCategoryIcon, BookmarkIcon } from "../components/Icons.js";
import {
  articleCategories,
  articleCategoryDescriptions,
  articleCategoryLabels,
  articleTopicLabels,
  buildHomeSearch,
  homeTimeWindowFrom,
  homeTimeWindowLabels,
  homeTimeWindows,
  parseHomeFilters,
  searchSummary,
  type ArticleCategoryFilter,
  type HomeFilters,
  type HomeTimeWindow,
} from "../homeFilters.js";
import { groupHomeArticles, type HomeArticleGroup } from "../homeArticleGroups.js";
import {
  nearbyDistanceLabel,
  nearbyStoryItemsForGroupsAndSituations,
  nearbyStorySummary,
  type NearbyStoryItem,
} from "../homeNearby.js";
import {
  homeNeighborhoodFocusOption,
  homeNeighborhoodFocusOptions,
  homeNeighborhoodFocusOptionForQuery,
  homeNeighborhoodFocusStorageKey,
} from "../homeNeighborhoodFocus.js";
import {
  homeLocalFocusDefaultRadiusKm,
  homeLocalFocusRadiusOptions,
  homeLocalFocusRadiusStorageKey,
  rankHomeStoryCardsByLocalFocus,
  parseHomeLocalFocusRadius,
  summarizeHomeStoryCardsByLocalFocus,
  type HomeLocalFocusPoint,
  type HomeLocalFocusSummary,
} from "../homeLocalFocus.js";
import {
  homeStoryCardsForGroups,
  homeStoryCardsForStories,
  sourceClusterLabelForGroup,
  type HomeStoryCard,
  type HomeStoryVerification,
} from "../homeStoryCards.js";
import { publicSourceHealthSummary } from "../freshness.js";
import { newsMapClusterSummary, type NewsMapClusterSummary } from "../newsMapClusters.js";
import { safeExternalUrl } from "../safeExternalUrl.js";
import { situationTimeMeta } from "../situationTime.js";

const NewsMap = lazy(() =>
  import("../components/NewsMap.js").then((module) => ({ default: module.NewsMap })),
);
const defaultHomeFeedKey = "trondheim\u0000Alle\u0000\u0000\u0000all";

type LocalFocusState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "active"; point: HomeLocalFocusPoint; label: string; persistent: boolean }
  | { status: "error"; message: string };

function formatTime(date: string) {
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(date));
}

const osloDatePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Oslo",
  year: "numeric",
});

const osloDateLabelFormatter = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Oslo",
});

function osloDateKey(date: Date): string | undefined {
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Map(
    osloDatePartsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

function daysBetweenOsloDates(left: string, right: string): number {
  const [leftYear, leftMonth, leftDay] = left.split("-").map(Number);
  const [rightYear, rightMonth, rightDay] = right.split("-").map(Number);
  if (!leftYear || !leftMonth || !leftDay || !rightYear || !rightMonth || !rightDay) {
    return 0;
  }
  const leftMs = Date.UTC(leftYear, leftMonth - 1, leftDay);
  const rightMs = Date.UTC(rightYear, rightMonth - 1, rightDay);
  return Math.round((rightMs - leftMs) / 86_400_000);
}

export function morningBriefFreshness(
  generatedAt: string,
  now: Date = new Date(),
): { label: string; detail?: string; tone: "fresh" | "watch" | "stale" } {
  const generatedDate = new Date(generatedAt);
  const generatedKey = osloDateKey(generatedDate);
  const nowKey = osloDateKey(now);
  if (!generatedKey || !nowKey) {
    return {
      label: "Ukjent alder",
      detail: "Tidspunktet kunne ikke leses",
      tone: "watch",
    };
  }

  const ageDays = daysBetweenOsloDates(generatedKey, nowKey);
  if (ageDays <= 0) {
    return { label: "Oppdatert i dag", tone: "fresh" };
  }
  if (ageDays === 1) {
    return {
      label: "Oppdatert i går",
      detail: osloDateLabelFormatter.format(generatedDate),
      tone: "watch",
    };
  }
  return {
    label: "Eldre brief",
    detail: `Oppdatert ${osloDateLabelFormatter.format(generatedDate)}`,
    tone: "stale",
  };
}

function notificationSeverityLabel(severity: NotificationTriggerSeverity) {
  switch (severity) {
    case "critical":
      return "Kritisk";
    case "warning":
      return "Varsel";
    case "watch":
      return "Følg med";
  }
}

function notificationKindLabel(kind: PublicNotificationSignalHighlight["kind"]) {
  switch (kind) {
    case "public_safety":
      return "Liv og helse";
    case "traffic_disruption":
      return "Trafikk";
    case "weather_hazard":
      return "Vær";
    case "service_disruption":
      return "Driftsbrudd";
  }
}

function morningBriefModeLabel(mode: MorningBrief["mode"]): string {
  return mode === "ai_assisted" ? "Analysert brief" : "Reservebrief";
}

function publicAnalysisRunLabel(brief: MorningBrief): string | undefined {
  if (!brief.aiRun) return undefined;
  const providerLabel =
    brief.aiRun.provider === "deterministic" ? "Deterministisk analyse" : "Automatisk analyse";
  return `${providerLabel} · ${brief.aiRun.status.toUpperCase()} · ${formatTime(
    brief.aiRun.completedAt,
  )}`;
}

function publicBriefSourceLine(line: string): string {
  return line.replaceAll("AI-assistert", "Automatisk analyse").replaceAll("DeepSeek", "Analyse");
}

function SaveButton({
  article,
  saving,
  onUpdate,
}: {
  article: Article;
  saving: boolean;
  onUpdate: (id: string, saved: boolean) => Promise<void>;
}) {
  return (
    <button
      className="save"
      aria-label={`${article.saved ? "Fjern fra lagret" : "Lagre sak"}: ${article.title}`}
      disabled={saving}
      onClick={() => void onUpdate(article.id, !article.saved)}
    >
      <BookmarkIcon selected={article.saved} />
    </button>
  );
}

function SituationBanner({
  situations: candidates,
}: {
  situations: BootstrapPayload["situations"];
}) {
  const situations = candidates.filter(
    (item) => item.status === "preliminary" || item.status === "active",
  );
  const situation = situations[0];
  if (!situation) return null;
  const status = situation.status === "preliminary" ? "Foreløpig" : "Pågår";
  return (
    <article className="situation-banner">
      <div className="situation-copy">
        <p className="label">
          {situation.status === "preliminary" ? "Ny situasjon til vurdering" : "Pågående situasjon"}
        </p>
        <div className="situation-heading">
          <h2>{situation.title}</h2>
          <span className="status">{status}</span>
        </div>
        <p className="status-time">
          {situationTimeMeta(situation)} · {situation.verificationStatus}
        </p>
        {situation.sourceConfidence ? (
          <div className="situation-confidence">
            <StoryConfidenceBadge confidence={situation.sourceConfidence} />
          </div>
        ) : null}
        <ul>
          <li>{situation.summary}</li>
          <li>Farevarsel og kartgrunnlag vises med tydelig kildeangivelse.</li>
        </ul>
        <Link className="primary-link" to={`/situasjoner/${situation.id}`}>
          Åpne situasjonsrom <ArrowIcon />
        </Link>
        {situations.length > 1 ? (
          <div className="additional-situations">
            {situations.slice(1, 3).map((item) => (
              <Link key={item.id} to={`/situasjoner/${item.id}`}>
                {item.title}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <div className="situation-preview" aria-label="Forhåndsvisning av kart">
        <p>Omtalt område</p>
        <div className="preview-shape" />
        <span className="preview-point">{situation.locationLabel}</span>
        <small>Ingen presis hendelsesavgrensning uten publisert geometri</small>
      </div>
    </article>
  );
}

export function MorningBriefPanel({
  brief,
  articles = [],
  density = "normal",
  situations = [],
  now = new Date(),
}: {
  brief?: BootstrapPayload["morningBrief"];
  articles?: Article[];
  density?: "normal" | "compact";
  situations?: BootstrapPayload["situations"];
  now?: Date;
}) {
  if (!brief) return null;
  const compact = density === "compact";
  const modeLabel = morningBriefModeLabel(brief.mode);
  const freshness = morningBriefFreshness(brief.generatedAt, now);
  const analysisRunLabel = publicAnalysisRunLabel(brief);
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const situationsById = new Map(situations.map((situation) => [situation.id, situation]));
  const paragraphs = compact ? brief.paragraphs.slice(0, 1) : brief.paragraphs;
  const linkedArticles = brief.articleIds
    .flatMap((id) => {
      const article = articlesById.get(id);
      const href = article ? safeExternalUrl(article.url) : undefined;
      return article && href ? [{ article, href }] : [];
    })
    .slice(0, 3);
  const linkedSituations = brief.situationIds
    .flatMap((id) => {
      const situation = situationsById.get(id);
      return situation ? [situation] : [];
    })
    .slice(0, 2);
  const hasSourceLinks = !compact && (linkedArticles.length > 0 || linkedSituations.length > 0);
  return (
    <section
      className={`morning-brief morning-brief-${brief.mode} morning-brief-${density}`}
      aria-labelledby="morning-brief-heading"
    >
      <div className="morning-brief-copy">
        <p className="label">{modeLabel}</p>
        <div className="morning-brief-heading">
          <h2 id="morning-brief-heading">{brief.title}</h2>
          <div
            className={`morning-brief-freshness morning-brief-freshness-${freshness.tone}`}
            aria-label="Morgenbrief-ferskhet"
          >
            <span>{formatTime(brief.generatedAt)}</span>
            <strong>{freshness.label}</strong>
            {freshness.detail ? <small>{freshness.detail}</small> : null}
          </div>
        </div>
        <div className="morning-brief-paragraphs">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {!compact ? <small>{publicBriefSourceLine(brief.sourceLine)}</small> : null}
        {analysisRunLabel && !compact ? (
          <p className="morning-brief-ai-trace">
            <span>Analysespor</span>
            <span>{analysisRunLabel}</span>
          </p>
        ) : null}
        {hasSourceLinks ? (
          <div className="morning-brief-sources" aria-label="Morgenbrief-grunnlag">
            <span>Grunnlag</span>
            <div>
              {linkedArticles.map(({ article, href }) => (
                <a href={href} key={article.id} rel="noreferrer noopener" target="_blank">
                  {article.title}
                </a>
              ))}
              {linkedSituations.map((situation) => (
                <a href={`/situasjoner/${situation.id}`} key={situation.id}>
                  {situation.title}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <dl className="morning-brief-highlights" aria-label="Morgenbrief-nøkkeltall">
        {brief.highlights.map((highlight) => (
          <div key={highlight.label}>
            <dt>{highlight.label}</dt>
            <dd>
              <strong>{highlight.value}</strong>
              <span>{highlight.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CityPulseSignalPanel({
  articles = [],
  brief,
  density = "normal",
  now = new Date(),
  situations = [],
}: {
  articles?: Article[];
  brief?: BootstrapPayload["morningBrief"];
  density?: "normal" | "compact";
  now?: Date;
  situations?: HomeSituationSummary[];
}) {
  const compact = density === "compact";
  const freshness = brief ? morningBriefFreshness(brief.generatedAt, now) : undefined;
  const signalHighlights = useMemo(
    () =>
      buildPublicNotificationSignalHighlights({
        articles,
        generatedAt: brief?.generatedAt ?? now.toISOString(),
        limit: compact ? 2 : 3,
        situations,
      }),
    [articles, brief?.generatedAt, compact, now, situations],
  );
  return (
    <section
      className={`city-pulse-signal-panel city-pulse-signal-panel-${density}`}
      aria-labelledby="city-pulse-signal-heading"
    >
      <div className="section-heading-row">
        <div>
          <p className="label">Varsel og analysespor</p>
          <h2 id="city-pulse-signal-heading">
            {compact ? "Høyeffekt-signaler" : "Slik vurderes høyeffekt-signaler"}
          </h2>
        </div>
        <Link to="/varsler">
          Åpne varsler <ArrowIcon />
        </Link>
      </div>
      {!compact ? (
        <div className="city-pulse-signal-status">
          <div>
            <span>Morgenbrief</span>
            <strong>{brief ? morningBriefModeLabel(brief.mode) : "Ikke lagret"}</strong>
          </div>
          <div>
            <span>Siste analyse</span>
            <strong>{brief?.aiRun ? formatTime(brief.aiRun.completedAt) : "Ikke lagret"}</strong>
          </div>
          <div>
            <span>Brief-ferskhet</span>
            <strong className={freshness ? `freshness-tone-${freshness.tone}` : undefined}>
              {freshness?.label ?? "Ikke lagret"}
            </strong>
            {freshness?.detail ? <small>{freshness.detail}</small> : null}
          </div>
          <div>
            <span>Varselregler</span>
            <strong>{publicNotificationTriggerGuidance.length} offentlige kategorier</strong>
          </div>
        </div>
      ) : null}
      <section className="city-pulse-signal-live" aria-labelledby="city-pulse-live-heading">
        <div className="city-pulse-signal-live-heading">
          <div>
            <p className="label">Akkurat nå</p>
            <h3 id="city-pulse-live-heading">Høyeffektsaker fanget av varselreglene</h3>
          </div>
          <span>{signalHighlights.length ? `${signalHighlights.length} aktive` : "Rolig"}</span>
        </div>
        {signalHighlights.length ? (
          <ol>
            {signalHighlights.map((item) => {
              const href =
                item.link?.kind === "external" ? safeExternalUrl(item.link.href) : item.link?.href;
              const action =
                href && item.link ? (
                  item.link.kind === "external" ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {item.link.label} <ArrowIcon />
                    </a>
                  ) : (
                    <Link to={href}>
                      {item.link.label} <ArrowIcon />
                    </Link>
                  )
                ) : null;
              return (
                <li className={`city-pulse-signal-live-item ${item.severity}`} key={item.id}>
                  <div>
                    <span>
                      {notificationKindLabel(item.kind)} ·{" "}
                      {notificationSeverityLabel(item.severity)} · {item.recencyLabel}
                    </span>
                    <strong>{item.title}</strong>
                    {!compact ? <p>{item.body}</p> : null}
                  </div>
                  <div className="city-pulse-signal-live-meta">
                    <div className={`city-pulse-signal-attention ${item.attention.tone}`}>
                      <strong>{item.attention.label}</strong>
                      {!compact ? <small>{item.attention.detail}</small> : null}
                    </div>
                    <StoryConfidenceBadge confidence={item.confidence} />
                    {!compact && item.sourceLabels.length ? (
                      <em>{item.sourceLabels.join(" + ")}</em>
                    ) : null}
                    {!compact
                      ? item.reasons
                          .slice(0, 2)
                          .map((reason) => <small key={reason}>{reason}</small>)
                      : null}
                    {!compact && item.matchedKeywords.length ? (
                      <small>Treff: {item.matchedKeywords.slice(0, 3).join(", ")}</small>
                    ) : null}
                    {action}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="city-pulse-signal-empty">
            Ingen åpne saker i gjeldende bypulsdata krysser varselterskelen akkurat nå.
          </p>
        )}
      </section>
      {!compact ? (
        <div className="city-pulse-signal-guidance">
          {publicNotificationTriggerGuidance.map((item) => (
            <article key={item.kind}>
              <span>{notificationSeverityLabel(item.severity)}</span>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function CityPulseDashboard({ data }: { data: BootstrapPayload }) {
  const activeSituations = data.situations.filter(
    (item) => item.status === "preliminary" || item.status === "active",
  );
  if (activeSituations.length === 0) return null;
  return <SituationBanner situations={activeSituations} />;
}

function SourceCluster({ group }: { group: HomeArticleGroup }) {
  if (group.articles.length < 2) return null;
  const label = sourceClusterLabelForGroup(group);
  if (!label) return null;
  return (
    <div className="source-cluster" aria-label={label}>
      <span>{label}</span>
      <div className="source-cluster-list">
        {group.articles.map((article) => {
          const articleUrl = safeExternalUrl(article.url);
          const sourceLabel = `${article.sourceLabel} · ${formatTime(article.publishedAt)}`;
          const title = article.id === group.primary.id ? "Hovedsak" : article.title;
          const content = (
            <>
              <b>{sourceLabel}</b>
              <small>{title}</small>
            </>
          );
          return articleUrl ? (
            <a
              className="source-cluster-item"
              href={articleUrl}
              key={article.id}
              target="_blank"
              rel="noreferrer noopener"
            >
              {content}
            </a>
          ) : (
            <span className="source-cluster-item" key={article.id}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LeadStory({
  card,
  saving,
  onSave,
  canSave,
}: {
  card: HomeStoryCard;
  saving: boolean;
  onSave: (id: string, saved: boolean) => Promise<void>;
  canSave: boolean;
}) {
  const article = card.primary;
  const group = card.group;
  const articleUrl = safeExternalUrl(article.url);
  return (
    <article className={`lead-story${article.imageUrl ? "" : " text-only"}`}>
      {article.imageUrl ? <img src={article.imageUrl} alt="" /> : null}
      <div className="lead-copy">
        <div className="story-kicker">
          <p className="metadata">
            {card.sourceSummary} · {formatTime(card.latestAt)}
          </p>
          {card.locationLabel ? <span className="story-place">{card.locationLabel}</span> : null}
        </div>
        {canSave ? <SaveButton article={article} saving={saving} onUpdate={onSave} /> : null}
        <StoryEventBundleSummary card={card} />
        <h2>{article.title}</h2>
        <p>{article.excerpt}</p>
        <div className="story-card-tags lead-story-tags">
          <span className={`topic ${article.category.toLowerCase()}`}>{card.channelLabel}</span>
          {card.topicLabels.map((label) => (
            <span className="story-topic" key={label}>
              {label}
            </span>
          ))}
          {card.cardKind !== "sak" ? (
            <span className="story-badge">{storyKindLabel(card.cardKind)}</span>
          ) : null}
          {card.verification ? (
            <span className="story-badge story-badge-verified" title={card.verification.detail}>
              {card.verification.label}
            </span>
          ) : null}
          {shouldShowStoryConfidenceBadge(card) ? (
            <StoryConfidenceBadge confidence={card.sourceConfidence} />
          ) : null}
          {card.neighborhoodLabels.slice(1, 3).map((label) => (
            <span className="story-place small" key={label}>
              {label}
            </span>
          ))}
        </div>
        <StoryVerificationProof verification={card.verification} />
        <SourceCluster group={group} />
        <div className="lead-footer">
          <span>{card.clusterLabel ?? "Oppdatert fra nyhetslisten"}</span>
          {articleUrl ? (
            <a href={articleUrl} target="_blank" rel="noreferrer noopener">
              Les mer <ArrowIcon />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function storyKindLabel(kind: HomeStoryCard["cardKind"]): string {
  switch (kind) {
    case "situasjon":
      return "Situasjon";
    case "hendelse":
      return "Hendelse";
    case "tema":
      return "Tema";
    case "oppdatering":
      return "Oppdatering";
    case "sak":
      return "Sak";
  }
}

export function StoryVerificationProof({ verification }: { verification?: HomeStoryVerification }) {
  if (!verification) return null;
  return (
    <p className="story-verification-proof">
      <span>{verification.label}</span>
      <span>{verification.sourceSummary}</span>
      {verification.situationId ? (
        <Link to={`/situasjoner/${encodeURIComponent(verification.situationId)}`}>
          Åpne situasjonsrom
        </Link>
      ) : null}
      <span className="sr-only">{verification.detail}</span>
    </p>
  );
}

export function StoryConfidenceBadge({ confidence }: { confidence: SourceConfidenceSummary }) {
  const score = confidence.score;
  const scoreLabel =
    typeof score === "number" && Number.isFinite(score) && score > 0
      ? ` · ${Math.round(score * 100)} %`
      : "";
  return (
    <span
      className={`story-badge story-confidence story-confidence-${confidence.level}`}
      title={confidence.rationale}
      aria-label={`Kildetillit: ${confidence.label}${scoreLabel}`}
    >
      Kildetillit: {confidence.label}
      {scoreLabel}
    </span>
  );
}

export function shouldShowStoryConfidenceBadge(card: HomeStoryCard): boolean {
  if (card.verification) return true;
  if (card.cardKind === "situasjon") return true;
  if (card.isClustered) return true;
  if (card.sourceConfidence.level === "confirmed" || card.sourceConfidence.level === "likely") {
    return true;
  }
  return card.sourceConfidence.level === "speculative";
}

function storyBundleLabel(kind: HomeStoryCard["cardKind"]): string {
  switch (kind) {
    case "situasjon":
      return "Samlet situasjon";
    case "hendelse":
      return "Samlet hendelse";
    case "tema":
      return "Samlet tema";
    case "oppdatering":
      return "Samlet oppdatering";
    case "sak":
      return "Samlet sak";
  }
}

export function StoryEventBundleSummary({ card }: { card: HomeStoryCard }) {
  if (!card.isClustered) return null;
  const summary = card.clusterLabel ?? card.sourceSummary;
  return (
    <div
      className={`story-event-summary story-event-summary-${card.cardKind}`}
      aria-label={`Samlet bypulskort: ${summary}`}
    >
      <span>{storyBundleLabel(card.cardKind)}</span>
      <strong>{summary}</strong>
    </div>
  );
}

export function storyFeedSummary(cards: HomeStoryCard[]): string {
  if (cards.length === 0) return "Ingen bypulssaker i denne visningen.";
  const articleCount = cards.reduce((sum, card) => sum + card.updateCount, 0);
  const sourceCount = new Set(
    cards.flatMap((card) =>
      card.group.articles.map((article) => article.sourceLabel || article.source),
    ),
  ).size;
  const clusteredCount = cards.filter((card) => card.isClustered).length;
  const storyLabel = cards.length === 1 ? "bypulssak" : "bypulssaker";
  const articleLabel = articleCount === 1 ? "artikkel" : "artikler";
  const sourceLabel = sourceCount === 1 ? "kilde" : "kilder";
  const base = `Viser ${cards.length} ${storyLabel} samlet fra ${articleCount} ${articleLabel} og ${sourceCount} ${sourceLabel}.`;
  if (clusteredCount === 0) return base;
  const clusterLabel = clusteredCount === 1 ? "kort samler" : "kort samler";
  return `${base} ${clusteredCount} ${clusterLabel} flere kilder eller oppdateringer.`;
}

export interface StoryFeedTrustStats {
  articleCount: number;
  clusteredCount: number;
  confirmedOrLikelyCount: number;
  sourceCount: number;
  storyCount: number;
  verifiedCount: number;
}

export function storyFeedTrustStats(cards: HomeStoryCard[]): StoryFeedTrustStats {
  return {
    articleCount: cards.reduce((sum, card) => sum + card.updateCount, 0),
    clusteredCount: cards.filter((card) => card.isClustered).length,
    confirmedOrLikelyCount: cards.filter(
      (card) =>
        card.sourceConfidence.level === "confirmed" || card.sourceConfidence.level === "likely",
    ).length,
    sourceCount: new Set(
      cards.flatMap((card) =>
        card.group.articles.map((article) => article.sourceLabel || article.source),
      ),
    ).size,
    storyCount: cards.length,
    verifiedCount: cards.filter((card) => card.verification).length,
  };
}

function countOfTotalLabel(count: number, total: number): string {
  return `${count}/${total}`;
}

export function StoryFeedTrustStrip({ cards }: { cards: HomeStoryCard[] }) {
  if (cards.length === 0) return null;
  const stats = storyFeedTrustStats(cards);
  const sourceLabel = stats.sourceCount === 1 ? "kilde" : "kilder";
  const articleLabel = stats.articleCount === 1 ? "artikkel" : "artikler";
  return (
    <section className="story-feed-trust" aria-label="Kildebilde for bypulssaker">
      <article>
        <span>Verifisert</span>
        <strong>{countOfTotalLabel(stats.verifiedCount, stats.storyCount)}</strong>
        <small>offisiell + redaksjonell kilde</small>
      </article>
      <article>
        <span>Samlet</span>
        <strong>{stats.clusteredCount}</strong>
        <small>
          {stats.articleCount} {articleLabel} · {stats.sourceCount} {sourceLabel}
        </small>
      </article>
      <article>
        <span>Kildetillit</span>
        <strong>{countOfTotalLabel(stats.confirmedOrLikelyCount, stats.storyCount)}</strong>
        <small>bekreftet eller sannsynlig</small>
      </article>
    </section>
  );
}

type ChannelStoryCounts = Record<ArticleCategoryFilter, number>;

function emptyChannelStoryCounts(): ChannelStoryCounts {
  return Object.fromEntries(articleCategories.map((item) => [item, 0])) as ChannelStoryCounts;
}

export function channelStoryCountsForCards(cards: HomeStoryCard[]): ChannelStoryCounts {
  const counts = emptyChannelStoryCounts();
  counts.Alle = cards.length;
  for (const card of cards) counts[card.category] += 1;
  return counts;
}

function channelCountText(count: number): string {
  return count === 1
    ? "1 bypulssak i gjeldende visning"
    : `${count} bypulssaker i gjeldende visning`;
}

export function ChannelContextPanel({
  category,
  count,
  onClear,
  scope,
  timeWindow,
}: {
  category: ArticleCategoryFilter;
  count: number;
  onClear?: () => void;
  scope: HomeFilters["scope"];
  timeWindow: HomeTimeWindow;
}) {
  const place = scope === "trondheim" ? "Trondheim" : "Trøndelag";
  const windowLabel =
    timeWindow === "all" ? "hele tidslinjen" : `siste ${homeTimeWindowLabels[timeWindow]}`;

  return (
    <section className="channel-context" aria-label="Valgt tematisk kanal">
      <span className="channel-context-icon" aria-hidden="true">
        <ArticleCategoryIcon name={category} />
      </span>
      <div>
        <p className="label">Tematisk kanal</p>
        <h2>{articleCategoryLabels[category]}</h2>
      </div>
      <p>{articleCategoryDescriptions[category]}</p>
      <strong>
        {channelCountText(count)} · {place} · {windowLabel}
      </strong>
      {category !== "Alle" && onClear ? (
        <button type="button" className="channel-context-clear" onClick={onClear}>
          Vis alle kanaler
        </button>
      ) : null}
    </section>
  );
}

function StoryCard({
  card,
  saving,
  onSave,
  canSave,
}: {
  card: HomeStoryCard;
  saving: boolean;
  onSave: (id: string, saved: boolean) => Promise<void>;
  canSave: boolean;
}) {
  const article = card.primary;
  const articleUrl = safeExternalUrl(article.url);
  const count = card.sourceCount > 1 ? card.sourceCount : card.updateCount;
  const countLabel = card.sourceCount > 1 ? "kilder" : "oppdateringer";
  return (
    <article className={`story-card story-card-${article.category.toLowerCase()}`}>
      <div className="story-card-main">
        <div className="story-card-kicker">
          <p className="metadata compact">
            {card.sourceSummary.toUpperCase()} · {formatTime(card.latestAt)}
          </p>
          {card.locationLabel ? <span className="story-place">{card.locationLabel}</span> : null}
        </div>
        <StoryEventBundleSummary card={card} />
        {articleUrl ? (
          <a
            className="headline story-title"
            href={articleUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {article.title}
          </a>
        ) : (
          <span className="headline story-title">{article.title}</span>
        )}
        <p className="excerpt">{article.excerpt}</p>
        <div className="story-card-tags">
          <span className={`topic ${article.category.toLowerCase()}`}>{card.channelLabel}</span>
          {card.topicLabels.map((label) => (
            <span className="story-topic" key={label}>
              {label}
            </span>
          ))}
          {card.cardKind !== "sak" ? (
            <span className="story-badge">{storyKindLabel(card.cardKind)}</span>
          ) : null}
          {card.verification ? (
            <span className="story-badge story-badge-verified" title={card.verification.detail}>
              {card.verification.label}
            </span>
          ) : null}
          {shouldShowStoryConfidenceBadge(card) ? (
            <StoryConfidenceBadge confidence={card.sourceConfidence} />
          ) : null}
          {card.neighborhoodLabels.slice(1, 3).map((label) => (
            <span className="story-place small" key={label}>
              {label}
            </span>
          ))}
        </div>
        <StoryVerificationProof verification={card.verification} />
        <SourceCluster group={card.group} />
      </div>
      <div className="story-card-side">
        {card.isClustered ? (
          <span className="story-card-count" aria-label={`${count} ${countLabel}`}>
            <b>{count}</b>
            <small>{countLabel}</small>
          </span>
        ) : null}
        {canSave ? <SaveButton article={article} saving={saving} onUpdate={onSave} /> : null}
      </div>
    </article>
  );
}

function nearbyMapTarget(item: NearbyStoryItem | undefined): { label: string; to: string } {
  if (item?.situationId) {
    return { label: "Åpne situasjon", to: `/situasjoner/${item.situationId}` };
  }
  if (item?.category === "Transport") return { label: "Åpne trafikk", to: "/trafikk" };
  if (item?.category === "Vær") return { label: "Åpne værkart", to: "/vaer" };
  return { label: "Åpne situasjonskart", to: "/situasjoner" };
}

function geolocationErrorMessage(error?: GeolocationPositionError): string {
  if (!error) return "Kunne ikke hente posisjon.";
  if (error.code === error.PERMISSION_DENIED) return "Posisjonstilgang ble ikke godkjent.";
  if (error.code === error.POSITION_UNAVAILABLE) return "Posisjonen er ikke tilgjengelig nå.";
  if (error.code === error.TIMEOUT) return "Posisjonssøk tok for lang tid.";
  return "Kunne ikke hente posisjon.";
}

export function LocalFocusSummaryPanel({
  label,
  radiusKm,
  summary,
}: {
  label: string;
  radiusKm: number;
  summary: HomeLocalFocusSummary;
}) {
  const radiusLabel = `${radiusKm} km`;
  return (
    <section className="local-focus-summary" aria-label="Lokalt fokus">
      <div>
        <p className="label">Lokalt fokus</p>
        <h2>Nær {label}</h2>
        <p>
          {summary.locatedCount > 0
            ? `${summary.withinRadiusCount} av ${summary.locatedCount} stedsfestede saker er innen ${radiusLabel}.`
            : `Ingen stedsfestede saker i utvalget kan måles mot ${label} ennå.`}
        </p>
      </div>
      {summary.closestItems.length > 0 ? (
        <ol>
          {summary.closestItems.map((item) => (
            <li key={item.id}>
              <span>
                <b>{item.title}</b>
                {item.locationLabel ? <small>{item.locationLabel}</small> : null}
              </span>
              <em className={item.withinRadius ? "near" : undefined}>
                {nearbyDistanceLabel(item.distanceKm)}
              </em>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function NearbyRail({
  articles,
  data,
  groups,
  localFocus,
  onTimeWindowChange,
  timeWindow,
  timeWindowLabel,
  timeWindowFrom,
}: {
  articles: Article[];
  data: BootstrapPayload;
  groups: HomeArticleGroup[];
  localFocus?: HomeLocalFocusPoint;
  onTimeWindowChange: (timeWindow: HomeTimeWindow) => void;
  timeWindow: HomeTimeWindow;
  timeWindowFrom?: string;
  timeWindowLabel?: string;
}) {
  const [mapReady, setMapReady] = useState(false);
  const allNearby = useMemo(
    () =>
      nearbyStoryItemsForGroupsAndSituations(groups, data.situations, {
        limit: Number.MAX_SAFE_INTEGER,
        localFocus,
        from: timeWindowFrom,
      }),
    [data.situations, groups, localFocus, timeWindowFrom],
  );
  const nearby = useMemo(() => allNearby.slice(0, 4), [allNearby]);
  const mapNearby = useMemo(() => allNearby.slice(0, 24), [allNearby]);
  const clusterSummary = useMemo(() => newsMapClusterSummary(mapNearby), [mapNearby]);
  const [selectedNearbyId, setSelectedNearbyId] = useState<string>();
  const nearbyIds = nearby.map((item) => item.id).join("|");
  const mapNearbyIds = mapNearby.map((item) => item.id).join("|");
  const selectedNearby = mapNearby.find((item) => item.id === selectedNearbyId) ?? nearby[0];
  const selectedTarget = nearbyMapTarget(selectedNearby);
  const selectedArticleUrl = selectedNearby
    ? safeExternalUrl(selectedNearby.article?.url)
    : undefined;
  const selectedDistance = localFocus ? nearbyDistanceLabel(selectedNearby?.distanceKm) : undefined;
  const municipalityArchiveUrl = safeExternalUrl(
    "https://www.trondheim.kommune.no/aktuelt/nyheter/",
  );
  const civic = articles.filter((article) => article.source === "trondheim_kommune").slice(0, 2);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setMapReady(true), { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setMapReady(true), 1200);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    setSelectedNearbyId((current) =>
      current && mapNearby.some((item) => item.id === current) ? current : nearby[0]?.id,
    );
  }, [mapNearby, mapNearbyIds, nearby, nearbyIds]);

  return (
    <aside className="home-rail">
      <section className="nearby-module" aria-labelledby="nearby-heading">
        <div className="rail-title">
          <div>
            <h2 id="nearby-heading">I nærheten</h2>
            <p>
              {nearbyStorySummary(nearby, allNearby.length)}
              {timeWindowLabel ? ` Kartet følger ${timeWindowLabel.toLocaleLowerCase("nb")}.` : ""}
            </p>
          </div>
          <Link to="/situasjoner">
            Åpne situasjonskart <ArrowIcon />
          </Link>
        </div>
        <MapTimeSlider value={timeWindow} onChange={onTimeWindowChange} />
        <MapClusterSummary summary={clusterSummary} />
        {mapReady ? (
          <Suspense fallback={<div className="nearby-map nearby-map-loading" aria-hidden="true" />}>
            <NewsMap
              items={mapNearby}
              localFocus={localFocus}
              selectedId={selectedNearby?.id}
              onSelect={setSelectedNearbyId}
            />
          </Suspense>
        ) : (
          <div className="nearby-map nearby-map-loading" aria-hidden="true" />
        )}
        {nearby.length > 0 ? (
          <>
            <ol className="nearby-list">
              {nearby.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nearby-story-row nearby-story-row-${item.kind}`}
                    aria-current={selectedNearby?.id === item.id ? "true" : undefined}
                    onClick={() => setSelectedNearbyId(item.id)}
                    onFocus={() => setSelectedNearbyId(item.id)}
                    onMouseEnter={() => setSelectedNearbyId(item.id)}
                  >
                    <strong>{item.markerLabel}</strong>
                    <span>
                      <b>{item.title}</b>
                      <small>
                        {item.locationLabel} · {item.sourceLabel}
                        {localFocus
                          ? ` · ${nearbyDistanceLabel(item.distanceKm) ?? "uten avstand"}`
                          : ""}
                      </small>
                    </span>
                    <em className={`nearby-kind nearby-kind-${item.kind}`}>
                      {item.relevanceLabel}
                    </em>
                  </button>
                </li>
              ))}
            </ol>
            <article className="nearby-detail" aria-live="polite">
              <p className="metadata compact">
                {selectedNearby?.sourceLabel.toUpperCase()} ·{" "}
                {selectedNearby ? formatTime(selectedNearby.publishedAt) : ""}
              </p>
              <h3>{selectedNearby?.title}</h3>
              <p>{selectedNearby?.relevanceDetail}</p>
              {selectedDistance ? <p className="nearby-distance">{selectedDistance}</p> : null}
              <div className="nearby-detail-actions">
                <Link to={selectedTarget.to}>
                  {selectedTarget.label} <ArrowIcon />
                </Link>
                {selectedArticleUrl ? (
                  <a href={selectedArticleUrl} target="_blank" rel="noreferrer noopener">
                    Les saken <ArrowIcon />
                  </a>
                ) : null}
              </div>
            </article>
          </>
        ) : (
          <div className="nearby-empty">
            <strong>Ingen kartfestede saker i dette utvalget ennå.</strong>
            <Link to="/situasjoner">
              Se situasjonskartet <ArrowIcon />
            </Link>
          </div>
        )}
      </section>
      <section className="municipality">
        <div className="rail-title">
          <h2>Fra kommunen</h2>
          {municipalityArchiveUrl ? (
            <a href={municipalityArchiveUrl} target="_blank" rel="noreferrer noopener">
              Se alle <ArrowIcon />
            </a>
          ) : null}
        </div>
        {civic.map((article) => {
          const articleUrl = safeExternalUrl(article.url);
          const content = (
            <>
              <span aria-hidden="true">○</span>
              <div>
                <strong>{article.title}</strong>
                <p>{article.excerpt}</p>
              </div>
            </>
          );
          return articleUrl ? (
            <a
              className="notice"
              href={articleUrl}
              key={article.id}
              target="_blank"
              rel="noreferrer noopener"
            >
              {content}
            </a>
          ) : (
            <article className="notice" key={article.id}>
              {content}
            </article>
          );
        })}
      </section>
      <PublicSourceStatusPanel sources={data.sourceHealth} />
    </aside>
  );
}

export function PublicSourceStatusPanel({ sources }: { sources: SourceHealth[] }) {
  const summary = publicSourceHealthSummary(sources);
  return (
    <section className={`source-status source-status-${summary.tone}`}>
      <h2>Kilder</h2>
      <div className="source-status-summary">
        <span>{summary.freshnessLabel}</span>
        <strong>{summary.label}</strong>
        <p>{summary.detail}</p>
      </div>
      {summary.sources.length ? (
        <div className="health-grid" aria-label="Åpne kilder">
          {summary.sources.map((source) => (
            <span key={source.source} className={source.state}>
              <b>{source.label}</b>
              <small>{source.stateLabel}</small>
            </span>
          ))}
        </div>
      ) : (
        <p className="source-status-empty">Venter på første åpne kildekontroll.</p>
      )}
      {summary.hiddenSourceCount > 0 ? (
        <p className="source-status-private">
          {summary.hiddenSourceCount} interne kontroller vises bare i Command Center.
        </p>
      ) : null}
    </section>
  );
}

export function MapClusterSummary({ summary }: { summary: NewsMapClusterSummary }) {
  if (summary.storyCount === 0) return null;
  const markerLabel = summary.markerCount === 1 ? "markør" : "markører";
  const storyLabel = summary.storyCount === 1 ? "stedsfestet sak" : "stedsfestede saker";
  const clusterLabel = summary.clusterCount === 1 ? "klynge" : "klynger";
  const compressedLabel = summary.compressedStoryCount === 1 ? "ekstra sak" : "ekstra saker";

  return (
    <p className="nearby-map-density" aria-live="polite">
      Kartet viser {summary.storyCount} {storyLabel} som {summary.markerCount} {markerLabel}.
      {summary.compressedStoryCount > 0
        ? ` ${summary.clusterCount} ${clusterLabel} samler ${summary.compressedStoryCount} ${compressedLabel}.`
        : " Ingen punkter er slått sammen."}
    </p>
  );
}

export function MapTimeSlider({
  value,
  onChange,
}: {
  value: HomeTimeWindow;
  onChange?: (timeWindow: HomeTimeWindow) => void;
}) {
  const selectedIndex = Math.max(0, homeTimeWindows.indexOf(value));
  const selectedValue = homeTimeWindows[selectedIndex] ?? "all";
  const selectedLabel = homeTimeWindowLabels[selectedValue];

  return (
    <div className="nearby-time-slider" aria-label="Kartperiode">
      <div>
        <span>Kartperiode</span>
        <strong>{selectedLabel}</strong>
      </div>
      <input
        type="range"
        min={0}
        max={homeTimeWindows.length - 1}
        step={1}
        value={selectedIndex}
        aria-label="Filtrer kart etter alder"
        aria-valuetext={selectedLabel}
        onChange={(event) => {
          const next = homeTimeWindows[Number(event.currentTarget.value)] ?? "all";
          onChange?.(next);
        }}
      />
      <div className="nearby-time-slider-labels" aria-hidden="true">
        {homeTimeWindows.map((window) => (
          <span className={window === selectedValue ? "selected" : ""} key={window}>
            {homeTimeWindowLabels[window]}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LocalFocusRadiusControl({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange?: (radiusKm: number) => void;
  value: number;
}) {
  const selectedIndex = Math.max(
    0,
    homeLocalFocusRadiusOptions.findIndex((option) => option === value),
  );
  const selectedValue = homeLocalFocusRadiusOptions[selectedIndex] ?? homeLocalFocusDefaultRadiusKm;

  return (
    <label className="local-focus-radius">
      <span>Radius</span>
      <strong>{selectedValue} km</strong>
      <input
        type="range"
        min={0}
        max={homeLocalFocusRadiusOptions.length - 1}
        step={1}
        value={selectedIndex}
        aria-label="Velg lokal radius"
        aria-valuetext={`${selectedValue} km`}
        disabled={disabled}
        onChange={(event) => {
          const next =
            homeLocalFocusRadiusOptions[Number(event.currentTarget.value)] ??
            homeLocalFocusDefaultRadiusKm;
          onChange?.(next);
        }}
      />
    </label>
  );
}

function searchParamsFor(filters: HomeFilters) {
  return buildHomeSearch(filters).replace(/^\?/, "");
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

const publicFeedPriorityWindowMs = 3 * 60 * 60 * 1000;

const publicFeedKindScore = {
  situasjon: 90,
  hendelse: 64,
  oppdatering: 36,
  tema: 18,
  sak: 0,
} as const satisfies Record<HomeStoryCard["cardKind"], number>;

const publicFeedCategoryScore = {
  Hendelser: 24,
  Transport: 20,
  Krim: 18,
  Vær: 14,
  Byutvikling: 6,
  Politikk: 4,
  Nyheter: 0,
  Sport: -4,
  Kultur: -6,
} as const satisfies Record<Article["category"], number>;

const publicFeedConfidenceScore = {
  confirmed: 18,
  likely: 10,
  uncertain: 0,
  speculative: -8,
} as const satisfies Record<SourceConfidenceSummary["level"], number>;

export function publicFeedSignalScore(card: HomeStoryCard): number {
  return (
    publicFeedKindScore[card.cardKind] +
    publicFeedCategoryScore[card.category] +
    publicFeedConfidenceScore[card.sourceConfidence.level] +
    (card.verification ? 28 : 0) +
    (card.isClustered ? 20 : 0) +
    Math.min(20, Math.max(0, card.sourceCount - 1) * 8) +
    (card.locationLabel ? 4 : 0)
  );
}

export function rankHomeStoryCardsForPublicFeed(
  cards: HomeStoryCard[],
  options: { enabled: boolean },
): HomeStoryCard[] {
  if (!options.enabled || cards.length < 2) return cards;
  const ranked = cards.map((card, index) => {
    const timestamp = timestampMs(card.latestAt) ?? 0;
    return { card, index, score: publicFeedSignalScore(card), timestamp };
  });
  const newestTimestamp = ranked.reduce((max, item) => Math.max(max, item.timestamp), 0);
  if (newestTimestamp <= 0) return cards;
  return ranked
    .sort((left, right) => {
      const leftBucket = Math.floor(
        (newestTimestamp - left.timestamp) / publicFeedPriorityWindowMs,
      );
      const rightBucket = Math.floor(
        (newestTimestamp - right.timestamp) / publicFeedPriorityWindowMs,
      );
      return (
        leftBucket - rightBucket ||
        right.score - left.score ||
        right.timestamp - left.timestamp ||
        left.index - right.index
      );
    })
    .map((item) => item.card);
}

function situationLatestMs(situation: HomeSituationSummary): number | undefined {
  const updatedAt = timestampMs(situation.updatedAt);
  const createdAt = timestampMs(situation.createdAt);
  if (updatedAt === undefined) return createdAt;
  if (createdAt === undefined) return updatedAt;
  return Math.max(updatedAt, createdAt);
}

function situationMatchesWindow(
  situation: HomeSituationSummary,
  timeWindowFrom: string | undefined,
): boolean {
  const lowerBound = timestampMs(timeWindowFrom);
  if (lowerBound === undefined) return true;
  const latest = situationLatestMs(situation);
  return latest !== undefined && latest >= lowerBound;
}

export function cityPulseLatestTimestamp(data: BootstrapPayload): string | undefined {
  const candidates = [
    data.morningBrief?.generatedAt,
    ...(data.stories ?? []).map((story) => story.latestAt),
    ...data.articles.map((article) => article.publishedAt),
    ...data.situations.flatMap((situation) => [situation.updatedAt, situation.createdAt]),
    ...data.sourceHealth.map((source) => source.lastCheckedAt),
  ].flatMap((value) => {
    if (!value) return [];
    const timestamp = timestampMs(value);
    return timestamp === undefined ? [] : [{ value, timestamp }];
  });
  return candidates.sort((left, right) => right.timestamp - left.timestamp)[0]?.value;
}

export function articlesFromCityPulseStoryPage(page: CityPulseStoryPage): Article[] {
  return articlesFromCityPulseStories(page.items);
}

export function articlesFromCityPulseStories(stories: CityPulseStory[]): Article[] {
  const seenArticleIds = new Set<string>();
  return stories
    .flatMap((story) => {
      const articles = story.articles.length > 0 ? story.articles : [story.primary];
      return articles.map((article) => ({
        ...article,
        ...(story.coverageBundle && !article.coverageBundle
          ? { coverageBundle: story.coverageBundle }
          : {}),
        ...(story.publicVerification && !article.publicVerification
          ? { publicVerification: story.publicVerification }
          : {}),
      }));
    })
    .filter((article) => {
      if (seenArticleIds.has(article.id)) return false;
      seenArticleIds.add(article.id);
      return true;
    });
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function newerTimestamp(left: string, right: string): string {
  const leftMs = timestampMs(left) ?? 0;
  const rightMs = timestampMs(right) ?? 0;
  return rightMs > leftMs ? right : left;
}

function mergeCityPulseStory(existing: CityPulseStory, incoming: CityPulseStory): CityPulseStory {
  const articlesById = new Map<string, Article>();
  const sourceLabels = uniqueStrings([...existing.sourceLabels, ...incoming.sourceLabels]);
  for (const article of [
    ...(existing.articles.length > 0 ? existing.articles : [existing.primary]),
    ...(incoming.articles.length > 0 ? incoming.articles : [incoming.primary]),
  ]) {
    articlesById.set(article.id, article);
  }
  const articles = [...articlesById.values()].sort(
    (left, right) => (timestampMs(right.publishedAt) ?? 0) - (timestampMs(left.publishedAt) ?? 0),
  );
  const articleIds = uniqueStrings([
    ...existing.articleIds,
    ...incoming.articleIds,
    ...articles.map((article) => article.id),
  ]);
  return {
    ...existing,
    articleIds,
    articles,
    sourceLabels,
    sourceCount: sourceLabels.length,
    updateCount: Math.max(existing.updateCount, incoming.updateCount, articles.length),
    latestAt: newerTimestamp(existing.latestAt, incoming.latestAt),
    coverageBundle: existing.coverageBundle ?? incoming.coverageBundle,
    publicVerification: existing.publicVerification ?? incoming.publicVerification,
  };
}

export function mergeCityPulseStoryLists(
  current: CityPulseStory[],
  incoming: CityPulseStory[],
): CityPulseStory[] {
  const storiesById = new Map(current.map((story) => [story.id, story]));
  for (const story of incoming) {
    const existing = storiesById.get(story.id);
    storiesById.set(story.id, existing ? mergeCityPulseStory(existing, story) : story);
  }
  return [...storiesById.values()].sort(
    (left, right) => (timestampMs(right.latestAt) ?? 0) - (timestampMs(left.latestAt) ?? 0),
  );
}

function cityPulseStoryWithArticle(
  story: CityPulseStory,
  articleId: string,
  update: (article: Article) => Article,
): CityPulseStory {
  const primary = story.primary.id === articleId ? update(story.primary) : story.primary;
  const articles = story.articles.map((article) =>
    article.id === articleId ? update(article) : article,
  );
  if (
    primary === story.primary &&
    articles.every((article, index) => article === story.articles[index])
  ) {
    return story;
  }
  return { ...story, primary, articles };
}

function cityPulseStoriesWithSavedState(
  stories: CityPulseStory[],
  articleId: string,
  saved: boolean,
): CityPulseStory[] {
  return stories.map((story) =>
    cityPulseStoryWithArticle(story, articleId, (article) => ({ ...article, saved })),
  );
}

export function CityPulseRefreshStatus({
  error,
  lastUpdatedAt,
  onRefresh,
  refreshing,
}: {
  error?: string;
  lastUpdatedAt?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <section className={`city-pulse-refresh${error ? " has-error" : ""}`} aria-live="polite">
      <div>
        <span>Bypuls</span>
        <strong>{lastUpdatedAt ? formatTime(lastUpdatedAt) : "Ikke oppdatert"}</strong>
      </div>
      <button type="button" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? "Oppdaterer" : "Oppdater bypuls"}
      </button>
      {error ? <small role="status">{error}</small> : null}
    </section>
  );
}

function isDefaultHomeFeed(filters: HomeFilters): boolean {
  return (
    filters.scope === "trondheim" &&
    filters.category === "Alle" &&
    !filters.topic &&
    filters.q.trim().length === 0 &&
    filters.timeWindow === "all"
  );
}

export function cityPulseDataForCurrentFeed({
  articles,
  filters,
  initialData,
  timeWindowFrom,
}: {
  articles: Article[];
  filters: HomeFilters;
  initialData: BootstrapPayload;
  timeWindowFrom?: string;
}): BootstrapPayload {
  const defaultFeed = isDefaultHomeFeed(filters);
  const linkedSituationIds = new Set(
    articles.flatMap((article) => (article.situationId ? [article.situationId] : [])),
  );
  const includeStandaloneSituations =
    filters.category === "Alle" && filters.q.trim().length === 0 && !filters.topic;
  const situations = initialData.situations.filter((situation) => {
    if (!situationMatchesWindow(situation, timeWindowFrom)) return false;
    return includeStandaloneSituations || linkedSituationIds.has(situation.id);
  });

  return {
    ...initialData,
    articles,
    stories: defaultFeed ? initialData.stories : undefined,
    storyNextCursor: defaultFeed ? initialData.storyNextCursor : undefined,
    situations,
    morningBrief: defaultFeed ? initialData.morningBrief : undefined,
  };
}

function defaultStoryNextCursor(data: BootstrapPayload): string | undefined {
  return data.storyNextCursor;
}

interface SavedOverride {
  expiresAt: number;
  saved: boolean;
}

const savedOverrideTtlMs = 60_000;

export function HomePage({
  initialData,
  canSave = true,
}: {
  initialData: BootstrapPayload;
  canSave?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseHomeFilters(searchParams.toString()), [searchParams]);
  const { scope, category, topic, timeWindow, q: query } = filters;
  const initialFeedIsDefault = isDefaultHomeFeed(filters);
  const [liveData, setLiveData] = useState(initialData);
  const [articles, setArticles] = useState(() =>
    initialFeedIsDefault ? initialData.articles : [],
  );
  const [stories, setStories] = useState<CityPulseStory[]>(() =>
    initialFeedIsDefault ? (initialData.stories ?? []) : [],
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>(() =>
    initialFeedIsDefault ? defaultStoryNextCursor(initialData) : undefined,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string>();
  const [refreshingCityPulse, setRefreshingCityPulse] = useState(false);
  const [cityPulseRefreshError, setCityPulseRefreshError] = useState<string>();
  const [cityPulseRefreshedAt, setCityPulseRefreshedAt] = useState(() =>
    cityPulseLatestTimestamp(initialData),
  );
  const [savingArticleIds, setSavingArticleIds] = useState<Set<string>>(() => new Set());
  const savingArticleIdsRef = useRef<Set<string>>(new Set());
  const articleSavedOverridesRef = useRef<Map<string, SavedOverride>>(new Map());
  const cityPulseRefreshRunningRef = useRef(false);
  const feedKey = `${scope}\u0000${category}\u0000${topic ?? ""}\u0000${query}\u0000${timeWindow}`;
  const feedKeyRef = useRef(feedKey);
  const loadMoreRequestIdRef = useRef(0);
  feedKeyRef.current = feedKey;
  const [saveError, setSaveError] = useState<string>();
  const timeWindowFrom = useMemo(() => homeTimeWindowFrom(timeWindow), [timeWindow]);
  const [localFocus, setLocalFocus] = useState<LocalFocusState>({ status: "idle" });
  const [neighborhoodFocusId, setNeighborhoodFocusId] = useState("");
  const [neighborhoodFocusQuery, setNeighborhoodFocusQuery] = useState("");
  const [focusRadiusKm, setFocusRadiusKm] = useState(homeLocalFocusDefaultRadiusKm);
  const focusRadiusCustomizedRef = useRef(false);
  const activeLocalFocus = localFocus.status === "active" ? localFocus.point : undefined;
  const activeLocalFocusRadiusKm = activeLocalFocus?.radiusKm ?? focusRadiusKm;

  useEffect(() => {
    setLiveData(initialData);
    setCityPulseRefreshedAt(cityPulseLatestTimestamp(initialData));
  }, [initialData]);

  const applySavedOverrides = useCallback((items: Article[]) => {
    const savedOverrides = articleSavedOverridesRef.current;
    if (savedOverrides.size === 0) return items;
    const now = Date.now();
    const nextOverrides = new Map(savedOverrides);
    const nextItems = items.map((item) => {
      const override = nextOverrides.get(item.id);
      if (!override) return item;
      if (override.expiresAt <= now || item.saved === override.saved) {
        nextOverrides.delete(item.id);
        return item;
      }
      return { ...item, saved: override.saved };
    });
    articleSavedOverridesRef.current = nextOverrides;
    return nextItems;
  }, []);

  const applySavedOverridesToStories = useCallback(
    (items: CityPulseStory[]) => {
      const updatedArticles = new Map(
        applySavedOverrides(articlesFromCityPulseStories(items)).map((article) => [
          article.id,
          article,
        ]),
      );
      return items.map((story) => {
        const primary = updatedArticles.get(story.primary.id) ?? story.primary;
        const articles =
          story.articles.length > 0
            ? story.articles.map((article) => updatedArticles.get(article.id) ?? article)
            : story.articles;
        return primary === story.primary && articles === story.articles
          ? story
          : { ...story, primary, articles };
      });
    },
    [applySavedOverrides],
  );

  const refreshCityPulse = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (cityPulseRefreshRunningRef.current) return;
      cityPulseRefreshRunningRef.current = true;
      if (!options.silent) setRefreshingCityPulse(true);
      try {
        const nextData = await api.bootstrap();
        setLiveData(nextData);
        setCityPulseRefreshedAt(cityPulseLatestTimestamp(nextData) ?? new Date().toISOString());
        setCityPulseRefreshError(undefined);
        if (feedKeyRef.current === defaultHomeFeedKey) {
          const nextStories = applySavedOverridesToStories(nextData.stories ?? []);
          setStories(nextStories);
          setArticles(
            nextStories.length > 0
              ? articlesFromCityPulseStories(nextStories)
              : applySavedOverrides(nextData.articles),
          );
          setNextCursor(defaultStoryNextCursor(nextData));
        }
      } catch (reason) {
        if (!options.silent) {
          setCityPulseRefreshError(
            reason instanceof Error ? reason.message : "Kunne ikke oppdatere bypulsen",
          );
        }
      } finally {
        cityPulseRefreshRunningRef.current = false;
        if (!options.silent) setRefreshingCityPulse(false);
      }
    },
    [applySavedOverrides, applySavedOverridesToStories],
  );

  useEffect(() => {
    if (feedKey !== defaultHomeFeedKey) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (savingArticleIdsRef.current.size > 0) return;
      void refreshCityPulse({ silent: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [feedKey, refreshCityPulse]);

  useEffect(() => {
    try {
      const storedRadius = parseHomeLocalFocusRadius(
        window.localStorage.getItem(homeLocalFocusRadiusStorageKey),
      );
      const option = homeNeighborhoodFocusOption(
        window.localStorage.getItem(homeNeighborhoodFocusStorageKey),
      );
      if (!option) return;
      const radiusKm = storedRadius ?? option.point.radiusKm ?? homeLocalFocusDefaultRadiusKm;
      focusRadiusCustomizedRef.current = storedRadius !== undefined;
      setFocusRadiusKm(radiusKm);
      setNeighborhoodFocusId(option.id);
      setNeighborhoodFocusQuery(option.label);
      setLocalFocus({
        status: "active",
        point: { ...option.point, radiusKm },
        label: option.label,
        persistent: true,
      });
    } catch {
      // Local focus is a convenience hint. Storage failures should not block the feed.
    }
  }, []);

  const clearStoredNeighborhoodFocus = useCallback(() => {
    try {
      window.localStorage.removeItem(homeNeighborhoodFocusStorageKey);
      window.localStorage.removeItem(homeLocalFocusRadiusStorageKey);
    } catch {
      // Ignore storage failures; the UI state is still cleared for this session.
    }
  }, []);

  const persistFocusRadius = useCallback((radiusKm: number) => {
    try {
      window.localStorage.setItem(homeLocalFocusRadiusStorageKey, String(radiusKm));
    } catch {
      // Radius is a convenience hint. Storage failures should not block local focus.
    }
  }, []);

  const updateLocalFocusRadius = useCallback(
    (radiusKm: number) => {
      const parsed = parseHomeLocalFocusRadius(radiusKm);
      if (!parsed) return;
      focusRadiusCustomizedRef.current = true;
      setFocusRadiusKm(parsed);
      persistFocusRadius(parsed);
      setLocalFocus((current) =>
        current.status === "active"
          ? { ...current, point: { ...current.point, radiusKm: parsed } }
          : current,
      );
    },
    [persistFocusRadius],
  );

  const requestLocalFocus = useCallback(() => {
    if (!navigator.geolocation) {
      setLocalFocus({ status: "error", message: "Nettleseren støtter ikke posisjon her." });
      return;
    }
    setNeighborhoodFocusId("");
    setNeighborhoodFocusQuery("");
    clearStoredNeighborhoodFocus();
    setLocalFocus({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocalFocus({
          status: "active",
          label: "din posisjon",
          persistent: false,
          point: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            radiusKm: focusRadiusKm,
          },
        });
      },
      (error) => setLocalFocus({ status: "error", message: geolocationErrorMessage(error) }),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 },
    );
  }, [clearStoredNeighborhoodFocus, focusRadiusKm]);

  const clearLocalFocus = useCallback(() => {
    setNeighborhoodFocusId("");
    setNeighborhoodFocusQuery("");
    focusRadiusCustomizedRef.current = false;
    setFocusRadiusKm(homeLocalFocusDefaultRadiusKm);
    clearStoredNeighborhoodFocus();
    setLocalFocus({ status: "idle" });
  }, [clearStoredNeighborhoodFocus]);

  const selectNeighborhoodFocus = useCallback(
    (value: string) => {
      const option = homeNeighborhoodFocusOption(value);
      if (!option) {
        clearLocalFocus();
        return;
      }
      const radiusKm = focusRadiusCustomizedRef.current
        ? focusRadiusKm
        : (option.point.radiusKm ?? focusRadiusKm);
      setFocusRadiusKm(radiusKm);
      setNeighborhoodFocusId(option.id);
      setNeighborhoodFocusQuery(option.label);
      try {
        window.localStorage.setItem(homeNeighborhoodFocusStorageKey, option.id);
        window.localStorage.setItem(homeLocalFocusRadiusStorageKey, String(radiusKm));
      } catch {
        // The chosen focus still works for this session even when persistence is unavailable.
      }
      setLocalFocus({
        status: "active",
        point: { ...option.point, radiusKm },
        label: option.label,
        persistent: true,
      });
    },
    [clearLocalFocus, focusRadiusKm],
  );

  const applyNeighborhoodFocusQuery = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const option = homeNeighborhoodFocusOptionForQuery(neighborhoodFocusQuery);
      if (!option) {
        setNeighborhoodFocusId("");
        clearStoredNeighborhoodFocus();
        setLocalFocus({
          status: "error",
          message: "Fant ikke nærområdet. Prøv postnummer eller stedsnavn i Trondheim.",
        });
        return;
      }
      const radiusKm = focusRadiusCustomizedRef.current
        ? focusRadiusKm
        : (option.point.radiusKm ?? focusRadiusKm);
      setFocusRadiusKm(radiusKm);
      setNeighborhoodFocusId(option.id);
      setNeighborhoodFocusQuery(option.label);
      try {
        window.localStorage.setItem(homeNeighborhoodFocusStorageKey, option.id);
        window.localStorage.setItem(homeLocalFocusRadiusStorageKey, String(radiusKm));
      } catch {
        // The chosen focus still works for this session even when persistence is unavailable.
      }
      setLocalFocus({
        status: "active",
        point: { ...option.point, radiusKm },
        label: option.label,
        persistent: true,
      });
    },
    [clearStoredNeighborhoodFocus, focusRadiusKm, neighborhoodFocusQuery],
  );

  function updateFilters(next: Partial<HomeFilters>) {
    const merged: HomeFilters = { ...filters, ...next };
    if (next.topic) merged.category = "Sport";
    if (merged.category !== "Sport") delete merged.topic;
    setSearchParams(searchParamsFor(merged));
  }

  useEffect(() => {
    if (feedKey === defaultHomeFeedKey) {
      setLoading(false);
      setLoadingMore(false);
      setFeedError(undefined);
      const nextStories = applySavedOverridesToStories(liveData.stories ?? []);
      setStories(nextStories);
      setArticles(
        nextStories.length > 0
          ? articlesFromCityPulseStories(nextStories)
          : applySavedOverrides(liveData.articles),
      );
      setNextCursor(defaultStoryNextCursor(liveData));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    loadMoreRequestIdRef.current += 1;
    setNextCursor(undefined);
    setStories([]);
    setArticles([]);
    setFeedError(undefined);
    const timeout = window.setTimeout(
      () => {
        void api
          .cityPulseStories({ scope, category, topic, q: query, from: timeWindowFrom })
          .then((page) => {
            if (!cancelled) {
              const nextStories = applySavedOverridesToStories(page.items);
              setStories(nextStories);
              setArticles(articlesFromCityPulseStories(nextStories));
              setNextCursor(page.nextCursor);
            }
          })
          .catch((reason: Error) => {
            if (!cancelled) setFeedError(reason.message);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    category,
    applySavedOverrides,
    applySavedOverridesToStories,
    feedKey,
    liveData.articles,
    liveData.stories,
    liveData.storyNextCursor,
    query,
    scope,
    timeWindowFrom,
    topic,
  ]);

  const filtered = useMemo(() => articles, [articles]);
  const isTextSearch = query.trim().length > 0;
  const cityPulseData = useMemo(
    () =>
      cityPulseDataForCurrentFeed({
        articles: filtered,
        filters,
        initialData: liveData,
        timeWindowFrom,
      }),
    [filtered, filters, liveData, timeWindowFrom],
  );

  const groupedArticles = useMemo(() => groupHomeArticles(filtered), [filtered]);
  const storyCards = useMemo(
    () =>
      stories.length > 0
        ? homeStoryCardsForStories(stories)
        : homeStoryCardsForGroups(groupedArticles),
    [groupedArticles, stories],
  );
  const channelStoryCounts = useMemo(() => channelStoryCountsForCards(storyCards), [storyCards]);
  const localRankedStoryCards = useMemo(
    () => rankHomeStoryCardsByLocalFocus(storyCards, activeLocalFocus),
    [activeLocalFocus, storyCards],
  );
  const publicFeedRankingEnabled =
    !activeLocalFocus && category === "Alle" && !isTextSearch && !topic;
  const displayedStoryCards = useMemo(
    () =>
      rankHomeStoryCardsForPublicFeed(localRankedStoryCards, {
        enabled: publicFeedRankingEnabled,
      }),
    [localRankedStoryCards, publicFeedRankingEnabled],
  );
  const displayedGroups = useMemo(
    () => displayedStoryCards.map((card) => card.group),
    [displayedStoryCards],
  );
  const localFocusSummary = useMemo(
    () =>
      activeLocalFocus
        ? summarizeHomeStoryCardsByLocalFocus(storyCards, activeLocalFocus, 3)
        : undefined,
    [activeLocalFocus, storyCards],
  );
  const leadCard = displayedStoryCards[0];
  const secondaryCards = displayedStoryCards.slice(1);

  async function updateSaved(id: string, saved: boolean) {
    if (savingArticleIdsRef.current.has(id)) return;
    const previous = articles.find((item) => item.id === id)?.saved ?? false;
    setSaveError(undefined);
    const pending = new Set(savingArticleIdsRef.current).add(id);
    savingArticleIdsRef.current = pending;
    articleSavedOverridesRef.current = new Map(articleSavedOverridesRef.current).set(id, {
      saved,
      expiresAt: Date.now() + savedOverrideTtlMs,
    });
    setSavingArticleIds(pending);
    setArticles((items) => items.map((item) => (item.id === id ? { ...item, saved } : item)));
    setStories((items) => cityPulseStoriesWithSavedState(items, id, saved));
    try {
      await api.saveArticle(id, saved);
      articleSavedOverridesRef.current = new Map(articleSavedOverridesRef.current).set(id, {
        saved,
        expiresAt: Date.now() + savedOverrideTtlMs,
      });
    } catch (reason) {
      articleSavedOverridesRef.current = new Map(articleSavedOverridesRef.current).set(id, {
        saved: previous,
        expiresAt: Date.now() + savedOverrideTtlMs,
      });
      setArticles((items) =>
        items.map((item) => (item.id === id ? { ...item, saved: previous } : item)),
      );
      setStories((items) => cityPulseStoriesWithSavedState(items, id, previous));
      setSaveError(reason instanceof Error ? reason.message : "Kunne ikke lagre saken");
    } finally {
      const next = new Set(savingArticleIdsRef.current);
      next.delete(id);
      savingArticleIdsRef.current = next;
      setSavingArticleIds(next);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    const requestId = loadMoreRequestIdRef.current + 1;
    loadMoreRequestIdRef.current = requestId;
    const requestFeedKey = feedKeyRef.current;
    const requestCursor = nextCursor;
    setLoadingMore(true);
    setFeedError(undefined);
    try {
      const requestQuery = {
        scope,
        category,
        topic,
        q: query,
        from: timeWindowFrom,
        cursor: requestCursor,
      };
      const page = await api.cityPulseStories(requestQuery);
      const pageStories = applySavedOverridesToStories(page.items);
      const pageNextCursor = page.nextCursor;
      if (loadMoreRequestIdRef.current !== requestId || feedKeyRef.current !== requestFeedKey) {
        return;
      }
      const nextArticles = articlesFromCityPulseStories(pageStories);
      setStories((current) => mergeCityPulseStoryLists(current, pageStories));
      setArticles((current) => [
        ...current,
        ...nextArticles.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setNextCursor(pageNextCursor);
    } catch (reason) {
      if (loadMoreRequestIdRef.current === requestId) {
        setFeedError(reason instanceof Error ? reason.message : "Kunne ikke hente flere saker");
      }
    } finally {
      if (loadMoreRequestIdRef.current === requestId) {
        setLoadingMore(false);
      }
    }
  }

  return (
    <main className="home">
      <div className="view-controls">
        <div className="scope-switch" aria-label="Geografisk visning">
          <button
            type="button"
            aria-pressed={scope === "trondheim"}
            className={scope === "trondheim" ? "selected" : ""}
            onClick={() => updateFilters({ scope: "trondheim" })}
          >
            Trondheim
          </button>
          <button
            type="button"
            aria-pressed={scope === "trondelag"}
            className={scope === "trondelag" ? "selected" : ""}
            onClick={() => updateFilters({ scope: "trondelag" })}
          >
            Trøndelag
          </button>
        </div>
        <div className="filters" aria-label="Tematiske kanaler">
          {articleCategories.map((item: ArticleCategoryFilter) => {
            const count = channelStoryCounts[item] ?? 0;
            return (
              <button
                type="button"
                aria-pressed={category === item}
                className={`channel-filter channel-filter-${item.toLocaleLowerCase("nb")}${
                  category === item ? " selected" : ""
                }`}
                key={item}
                onClick={() => updateFilters({ category: item })}
                title={`${articleCategoryLabels[item]}: ${channelCountText(count)}`}
              >
                <span className="channel-filter-icon" aria-hidden="true">
                  <ArticleCategoryIcon name={item} />
                </span>
                <span className="channel-filter-label">{articleCategoryLabels[item]}</span>
                <span className="channel-filter-count" aria-label={channelCountText(count)}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {category === "Sport" ? (
          <div className="topic-filters" aria-label="Sportskategorier">
            <button
              type="button"
              aria-pressed={topic === "rosenborg"}
              className={topic === "rosenborg" ? "selected" : ""}
              onClick={() =>
                updateFilters({ topic: topic === "rosenborg" ? undefined : "rosenborg" })
              }
            >
              {articleTopicLabels.rosenborg}
            </button>
          </div>
        ) : null}
        <div className="time-filters" aria-label="Tidsvindu">
          {homeTimeWindows.map((item) => (
            <button
              type="button"
              aria-pressed={timeWindow === item}
              className={timeWindow === item ? "selected" : ""}
              key={item}
              onClick={() => updateFilters({ timeWindow: item })}
            >
              {homeTimeWindowLabels[item]}
            </button>
          ))}
        </div>
        {feedKey === defaultHomeFeedKey ? (
          <CityPulseRefreshStatus
            error={cityPulseRefreshError}
            lastUpdatedAt={cityPulseRefreshedAt}
            onRefresh={() => void refreshCityPulse()}
            refreshing={refreshingCityPulse}
          />
        ) : null}
        <div className={`local-focus local-focus-${localFocus.status}`} aria-live="polite">
          <button
            type="button"
            aria-pressed={localFocus.status === "active"}
            className={localFocus.status === "active" ? "selected" : ""}
            disabled={localFocus.status === "locating"}
            onClick={localFocus.status === "active" ? clearLocalFocus : requestLocalFocus}
          >
            {localFocus.status === "locating"
              ? "Finner posisjon"
              : localFocus.status === "active"
                ? "Lokalt fokus aktivt"
                : "Nær meg"}
          </button>
          <select
            aria-label="Velg nærområde"
            value={neighborhoodFocusId}
            onChange={(event) => selectNeighborhoodFocus(event.target.value)}
          >
            <option value="">Velg område</option>
            {homeNeighborhoodFocusOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <form className="local-focus-search" onSubmit={applyNeighborhoodFocusQuery}>
            <input
              aria-label="Postnummer eller sted"
              inputMode="search"
              placeholder="Postnummer/sted"
              value={neighborhoodFocusQuery}
              onChange={(event) => setNeighborhoodFocusQuery(event.target.value)}
            />
            <button type="submit">Bruk</button>
          </form>
          {localFocus.status === "active" ? (
            <LocalFocusRadiusControl
              value={activeLocalFocusRadiusKm}
              onChange={updateLocalFocusRadius}
            />
          ) : null}
          {localFocus.status === "active" ? (
            <span>
              Nær {localFocus.label} · innen {activeLocalFocusRadiusKm} km
              {localFocus.persistent ? " · huskes her" : ""}
            </span>
          ) : localFocus.status === "error" ? (
            <span role="status">{localFocus.message}</span>
          ) : null}
        </div>
      </div>
      <ChannelContextPanel
        category={category}
        count={channelStoryCounts[category] ?? 0}
        onClear={category === "Alle" ? undefined : () => updateFilters({ category: "Alle" })}
        scope={scope}
        timeWindow={timeWindow}
      />
      {localFocus.status === "active" && localFocusSummary ? (
        <LocalFocusSummaryPanel
          label={localFocus.label}
          radiusKm={activeLocalFocusRadiusKm}
          summary={localFocusSummary}
        />
      ) : null}
      {!isTextSearch ? <CityPulseDashboard data={cityPulseData} /> : null}
      <div className="home-grid">
        <section className="news-section">
          <h1>Siste nytt i {scope === "trondheim" ? "Trondheim" : "Trøndelag"}</h1>
          {displayedStoryCards.length > 0 ? (
            <p className="story-feed-summary" aria-label="Sammendrag av bypulssaker">
              {storyFeedSummary(displayedStoryCards)}
            </p>
          ) : null}
          <StoryFeedTrustStrip cards={displayedStoryCards} />
          {feedError ? (
            <p className="feed-state error">Kunne ikke hente saker: {feedError}</p>
          ) : null}
          {saveError ? (
            <p className="feed-state error" role="alert">
              {saveError}
            </p>
          ) : null}
          {loading ? <p className="feed-state">Oppdaterer saker...</p> : null}
          {leadCard ? (
            <LeadStory
              card={leadCard}
              saving={savingArticleIds.has(leadCard.primary.id)}
              onSave={updateSaved}
              canSave={canSave}
            />
          ) : null}
          {!loading && !leadCard ? (
            <p className="feed-state">Ingen saker samsvarer med {searchSummary(filters)}.</p>
          ) : null}
          <div className="news-list story-list" aria-label="Bypulssaker">
            {secondaryCards.map((card) => (
              <StoryCard
                key={card.id}
                card={card}
                saving={savingArticleIds.has(card.primary.id)}
                onSave={updateSaved}
                canSave={canSave}
              />
            ))}
          </div>
          {nextCursor ? (
            <button className="load-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Henter flere saker..." : "Vis flere saker"}
            </button>
          ) : null}
        </section>
        <NearbyRail
          articles={articles}
          groups={displayedGroups}
          localFocus={activeLocalFocus}
          onTimeWindowChange={(nextWindow) => updateFilters({ timeWindow: nextWindow })}
          timeWindow={timeWindow}
          timeWindowFrom={timeWindowFrom}
          timeWindowLabel={timeWindow === "all" ? undefined : homeTimeWindowLabels[timeWindow]}
          data={cityPulseData}
        />
      </div>
    </main>
  );
}
