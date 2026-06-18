import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Article, BootstrapPayload } from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon, BookmarkIcon } from "../components/Icons.js";
import { NewsMap } from "../components/MapViews.js";
import {
  articleCategories,
  buildHomeSearch,
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
import { safeExternalUrl } from "../safeExternalUrl.js";
import { situationTimeMeta } from "../situationTime.js";

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

function sourceClusterLabel(group: HomeArticleGroup): string {
  if (group.bundle?.reason) {
    return group.sourceLabels.length > 1
      ? `${group.sourceLabels.length} kilder · ${group.bundle.reason.toLocaleLowerCase("nb")}`
      : `${group.articles.length} oppdateringer · ${group.bundle.reason.toLocaleLowerCase("nb")}`;
  }
  if (group.sourceLabels.length > 1) return `${group.sourceLabels.length} kilder dekker samme sak`;
  return `${group.articles.length} oppdateringer samlet`;
}

function SourceCluster({ group }: { group: HomeArticleGroup }) {
  if (group.articles.length < 2) return null;
  const label = sourceClusterLabel(group);
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
  group,
  saving,
  onSave,
}: {
  group: HomeArticleGroup;
  saving: boolean;
  onSave: (id: string, saved: boolean) => Promise<void>;
}) {
  const article = group.primary;
  const articleUrl = safeExternalUrl(article.url);
  return (
    <article className={`lead-story${article.imageUrl ? "" : " text-only"}`}>
      {article.imageUrl ? <img src={article.imageUrl} alt="" /> : null}
      <div className="lead-copy">
        <div className="metadata">
          {article.sourceLabel} · {formatTime(article.publishedAt)}
        </div>
        <SaveButton article={article} saving={saving} onUpdate={onSave} />
        <h2>{article.title}</h2>
        <p>{article.excerpt}</p>
        <SourceCluster group={group} />
        <div className="lead-footer">
          <span className={`topic ${article.category.toLowerCase()}`}>{article.category}</span>
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

function NewsRow({
  group,
  saving,
  onSave,
}: {
  group: HomeArticleGroup;
  saving: boolean;
  onSave: (id: string, saved: boolean) => Promise<void>;
}) {
  const article = group.primary;
  const articleUrl = safeExternalUrl(article.url);
  return (
    <article className="news-row">
      <div>
        <p className="metadata compact">
          {article.sourceLabel.toUpperCase()} · {formatTime(article.publishedAt)}
        </p>
        {articleUrl ? (
          <a className="headline" href={articleUrl} target="_blank" rel="noreferrer noopener">
            {article.title}
          </a>
        ) : (
          <span className="headline">{article.title}</span>
        )}
        <p className="excerpt">{article.excerpt}</p>
        <SourceCluster group={group} />
      </div>
      <span className={`topic ${article.category.toLowerCase()}`}>{article.category}</span>
      <SaveButton article={article} saving={saving} onUpdate={onSave} />
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

function NearbyRail({
  articles,
  data,
  groups,
}: {
  articles: Article[];
  data: BootstrapPayload;
  groups: HomeArticleGroup[];
}) {
  const allNearby = useMemo(
    () => nearbyStoryItemsForGroups(groups, { limit: Number.MAX_SAFE_INTEGER }),
    [groups],
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
        <NewsMap items={nearby} selectedId={selectedNearby?.id} onSelect={setSelectedNearbyId} />
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

export function HomePage({ initialData }: { initialData: BootstrapPayload }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseHomeFilters(searchParams.toString()), [searchParams]);
  const { scope, category, q: query } = filters;
  const [articles, setArticles] = useState(initialData.articles);
  const [nextCursor, setNextCursor] = useState<string>();
  const [situations, setSituations] = useState<BootstrapPayload["situations"]>(
    initialData.situations,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string>();
  const [savingArticleIds, setSavingArticleIds] = useState<Set<string>>(() => new Set());
  const savingArticleIdsRef = useRef<Set<string>>(new Set());
  const articleSavedOverridesRef = useRef<Map<string, SavedOverride>>(new Map());
  const feedKey = `${scope}\u0000${category}\u0000${query}`;
  const feedKeyRef = useRef(feedKey);
  const loadMoreRequestIdRef = useRef(0);
  feedKeyRef.current = feedKey;
  const [saveError, setSaveError] = useState<string>();

  function updateFilters(next: Partial<HomeFilters>) {
    setSearchParams(searchParamsFor({ ...filters, ...next }));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    loadMoreRequestIdRef.current += 1;
    setNextCursor(undefined);
    setFeedError(undefined);
    const timeout = window.setTimeout(
      () => {
        void api
          .articles({ scope, category, q: query })
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
  }, [category, query, scope]);

  useEffect(() => {
    void api
      .situations()
      .then((page) => setSituations(page.items))
      .catch(() => setSituations(initialData.situations));
  }, [initialData.situations]);

  const filtered = useMemo(() => articles, [articles]);
  const isTextSearch = query.trim().length > 0;

  const groupedArticles = useMemo(() => groupHomeArticles(filtered), [filtered]);
  const leadGroup = groupedArticles[0];
  const secondaryGroups = groupedArticles.slice(1);

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
      const page = await api.articles({ scope, category, q: query, cursor: requestCursor });
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
              {item}
            </button>
          ))}
        </div>
      </div>
      {!isTextSearch ? <SituationBanner situations={situations} /> : null}
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
          {leadGroup ? (
            <LeadStory
              group={leadGroup}
              saving={savingArticleIds.has(leadGroup.primary.id)}
              onSave={updateSaved}
            />
          ) : null}
          {!loading && !leadGroup ? (
            <p className="feed-state">Ingen saker samsvarer med {searchSummary(filters)}.</p>
          ) : null}
          <div className="news-list">
            {secondaryGroups.map((group) => (
              <NewsRow
                key={group.id}
                group={group}
                saving={savingArticleIds.has(group.primary.id)}
                onSave={updateSaved}
              />
            ))}
          </div>
          {nextCursor ? (
            <button className="load-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Henter flere saker..." : "Vis flere saker"}
            </button>
          ) : null}
        </section>
        <NearbyRail articles={articles} groups={groupedArticles} data={initialData} />
      </div>
    </main>
  );
}
