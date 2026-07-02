import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Article, BootstrapPayload } from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon, BookmarkIcon } from "../components/Icons.js";
import {
  articleCategories,
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
} from "../homeFilters.js";
import { groupHomeArticles, type HomeArticleGroup } from "../homeArticleGroups.js";
import {
  nearbyStoryItemsForGroups,
  nearbyStorySummary,
  type NearbyStoryItem,
} from "../homeNearby.js";
import { rankHomeStoryCardsByLocalFocus, type HomeLocalFocusPoint } from "../homeLocalFocus.js";
import {
  homeStoryCardsForGroups,
  sourceClusterLabelForGroup,
  type HomeStoryCard,
} from "../homeStoryCards.js";
import { safeExternalUrl } from "../safeExternalUrl.js";
import { situationTimeMeta } from "../situationTime.js";

const NewsMap = lazy(() =>
  import("../components/NewsMap.js").then((module) => ({ default: module.NewsMap })),
);
const defaultHomeFeedKey = "trondheim\u0000Alle\u0000\u0000\u0000all";
const localFocusRadiusKm = 10;

type LocalFocusState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "active"; point: HomeLocalFocusPoint }
  | { status: "error"; message: string };

function formatTime(date: string) {
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(date));
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
        <h2>{article.title}</h2>
        <p>{article.excerpt}</p>
        <div className="story-card-tags lead-story-tags">
          <span className={`topic ${article.category.toLowerCase()}`}>{card.channelLabel}</span>
          {card.cardKind !== "sak" ? (
            <span className="story-badge">{storyKindLabel(card.cardKind)}</span>
          ) : null}
          {card.neighborhoodLabels.slice(1, 3).map((label) => (
            <span className="story-place small" key={label}>
              {label}
            </span>
          ))}
        </div>
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
          {card.cardKind !== "sak" ? (
            <span className="story-badge">{storyKindLabel(card.cardKind)}</span>
          ) : null}
          {card.neighborhoodLabels.slice(1, 3).map((label) => (
            <span className="story-place small" key={label}>
              {label}
            </span>
          ))}
        </div>
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
  if (item?.category === "Transport") return { label: "Åpne trafikkart", to: "/trafikk" };
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

function NearbyRail({
  articles,
  data,
  groups,
  localFocus,
}: {
  articles: Article[];
  data: BootstrapPayload;
  groups: HomeArticleGroup[];
  localFocus?: HomeLocalFocusPoint;
}) {
  const allNearby = useMemo(
    () => nearbyStoryItemsForGroups(groups, { limit: Number.MAX_SAFE_INTEGER, localFocus }),
    [groups, localFocus],
  );
  const nearby = useMemo(() => allNearby.slice(0, 4), [allNearby]);
  const [selectedNearbyId, setSelectedNearbyId] = useState<string>();
  const nearbyIds = nearby.map((item) => item.id).join("|");
  const selectedNearby = nearby.find((item) => item.id === selectedNearbyId) ?? nearby[0];
  const selectedTarget = nearbyMapTarget(selectedNearby);
  const selectedArticleUrl = selectedNearby
    ? safeExternalUrl(selectedNearby.article.url)
    : undefined;
  const municipalityArchiveUrl = safeExternalUrl(
    "https://www.trondheim.kommune.no/aktuelt/nyheter/",
  );
  const civic = articles.filter((article) => article.source === "trondheim_kommune").slice(0, 2);

  useEffect(() => {
    setSelectedNearbyId((current) =>
      current && nearby.some((item) => item.id === current) ? current : nearby[0]?.id,
    );
  }, [nearby, nearbyIds]);

  return (
    <aside className="home-rail">
      <section className="nearby-module" aria-labelledby="nearby-heading">
        <div className="rail-title">
          <div>
            <h2 id="nearby-heading">I nærheten</h2>
            <p>{nearbyStorySummary(nearby, allNearby.length)}</p>
          </div>
          <Link to="/situasjoner">
            Åpne situasjonskart <ArrowIcon />
          </Link>
        </div>
        <Suspense fallback={<div className="nearby-map nearby-map-loading" aria-hidden="true" />}>
          <NewsMap items={nearby} selectedId={selectedNearby?.id} onSelect={setSelectedNearbyId} />
        </Suspense>
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
      <section className="source-status">
        <h2>Kilder</h2>
        <div className="health-grid">
          {data.sourceHealth.slice(0, 5).map((source) => (
            <span key={source.source} className={source.state}>
              {source.label}
            </span>
          ))}
        </div>
      </section>
    </aside>
  );
}

function searchParamsFor(filters: HomeFilters) {
  return buildHomeSearch(filters).replace(/^\?/, "");
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
  const [articles, setArticles] = useState(initialData.articles);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialData.articleNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string>();
  const [savingArticleIds, setSavingArticleIds] = useState<Set<string>>(() => new Set());
  const savingArticleIdsRef = useRef<Set<string>>(new Set());
  const articleSavedOverridesRef = useRef<Map<string, SavedOverride>>(new Map());
  const feedKey = `${scope}\u0000${category}\u0000${topic ?? ""}\u0000${query}\u0000${timeWindow}`;
  const feedKeyRef = useRef(feedKey);
  const loadMoreRequestIdRef = useRef(0);
  feedKeyRef.current = feedKey;
  const [saveError, setSaveError] = useState<string>();
  const timeWindowFrom = useMemo(() => homeTimeWindowFrom(timeWindow), [timeWindow]);
  const [localFocus, setLocalFocus] = useState<LocalFocusState>({ status: "idle" });
  const activeLocalFocus = localFocus.status === "active" ? localFocus.point : undefined;

  const requestLocalFocus = useCallback(() => {
    if (!navigator.geolocation) {
      setLocalFocus({ status: "error", message: "Nettleseren støtter ikke posisjon her." });
      return;
    }
    setLocalFocus({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocalFocus({
          status: "active",
          point: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            radiusKm: localFocusRadiusKm,
          },
        });
      },
      (error) => setLocalFocus({ status: "error", message: geolocationErrorMessage(error) }),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 },
    );
  }, []);

  const clearLocalFocus = useCallback(() => setLocalFocus({ status: "idle" }), []);

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
      setArticles(initialData.articles);
      setNextCursor(initialData.articleNextCursor);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    loadMoreRequestIdRef.current += 1;
    setNextCursor(undefined);
    setFeedError(undefined);
    const timeout = window.setTimeout(
      () => {
        void api
          .articles({ scope, category, topic, q: query, from: timeWindowFrom })
          .then((page) => {
            if (!cancelled) {
              setArticles(() => {
                const savedOverrides = articleSavedOverridesRef.current;
                if (savedOverrides.size === 0) return page.items;
                const now = Date.now();
                const nextOverrides = new Map(savedOverrides);
                const nextItems = page.items.map((item) => {
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
              });
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
    feedKey,
    initialData.articleNextCursor,
    initialData.articles,
    query,
    scope,
    timeWindowFrom,
    topic,
  ]);

  const filtered = useMemo(() => articles, [articles]);
  const isTextSearch = query.trim().length > 0;

  const groupedArticles = useMemo(() => groupHomeArticles(filtered), [filtered]);
  const storyCards = useMemo(() => homeStoryCardsForGroups(groupedArticles), [groupedArticles]);
  const displayedStoryCards = useMemo(
    () => rankHomeStoryCardsByLocalFocus(storyCards, activeLocalFocus),
    [activeLocalFocus, storyCards],
  );
  const displayedGroups = useMemo(
    () => displayedStoryCards.map((card) => card.group),
    [displayedStoryCards],
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
      const page = await api.articles({
        scope,
        category,
        topic,
        q: query,
        from: timeWindowFrom,
        cursor: requestCursor,
      });
      if (loadMoreRequestIdRef.current !== requestId || feedKeyRef.current !== requestFeedKey) {
        return;
      }
      setArticles((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
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
        <div className="filters" aria-label="Filtrer saker">
          {articleCategories.map((item: ArticleCategoryFilter) => (
            <button
              type="button"
              aria-pressed={category === item}
              className={category === item ? "selected" : ""}
              key={item}
              onClick={() => updateFilters({ category: item })}
            >
              {articleCategoryLabels[item]}
            </button>
          ))}
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
                ? "Nær meg aktiv"
                : "Nær meg"}
          </button>
          {localFocus.status === "active" ? (
            <span>Innen {localFocusRadiusKm} km</span>
          ) : localFocus.status === "error" ? (
            <span role="status">{localFocus.message}</span>
          ) : null}
        </div>
      </div>
      {!isTextSearch ? <SituationBanner situations={initialData.situations} /> : null}
      <div className="home-grid">
        <section className="news-section">
          <h1>Siste nytt i {scope === "trondheim" ? "Trondheim" : "Trøndelag"}</h1>
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
          data={initialData}
        />
      </div>
    </main>
  );
}
