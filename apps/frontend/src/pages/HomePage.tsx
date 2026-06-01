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
import { situationTimeMeta } from "../situationTime.js";

function formatTime(date: string) {
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(date),
  );
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

function LeadStory({
  article,
  saving,
  onSave,
}: {
  article: Article;
  saving: boolean;
  onSave: (id: string, saved: boolean) => Promise<void>;
}) {
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
        <div className="lead-footer">
          <span className={`topic ${article.category.toLowerCase()}`}>{article.category}</span>
          <a href={article.url} target="_blank" rel="noreferrer">
            Les mer <ArrowIcon />
          </a>
        </div>
      </div>
    </article>
  );
}

function NewsRow({
  article,
  saving,
  onSave,
}: {
  article: Article;
  saving: boolean;
  onSave: (id: string, saved: boolean) => Promise<void>;
}) {
  return (
    <article className="news-row">
      <div>
        <p className="metadata compact">
          {article.sourceLabel.toUpperCase()} · {formatTime(article.publishedAt)}
        </p>
        <a className="headline" href={article.url} target="_blank" rel="noreferrer">
          {article.title}
        </a>
        <p className="excerpt">{article.excerpt}</p>
      </div>
      <span className={`topic ${article.category.toLowerCase()}`}>{article.category}</span>
      <SaveButton article={article} saving={saving} onUpdate={onSave} />
    </article>
  );
}

function NearbyRail({ articles, data }: { articles: Article[]; data: BootstrapPayload }) {
  const located = articles.filter((article) => article.location).slice(0, 3);
  const civic = articles.filter((article) => article.source === "trondheim_kommune").slice(0, 2);
  return (
    <aside className="home-rail">
      <section>
        <div className="rail-title">
          <h2>I nærheten</h2>
          <a href="#map">
            Se alle på kart <ArrowIcon />
          </a>
        </div>
        <NewsMap articles={located} />
        <ol className="nearby-list">
          {located.map((article, index) => (
            <li key={article.id}>
              <strong>{index + 1}</strong>
              <span>{article.title}</span>
              <small>{article.location?.label}</small>
            </li>
          ))}
        </ol>
      </section>
      <section className="municipality">
        <div className="rail-title">
          <h2>Fra kommunen</h2>
          <a href="https://www.trondheim.kommune.no/aktuelt/nyheter/">
            Se alle <ArrowIcon />
          </a>
        </div>
        {civic.map((article) => (
          <a
            className="notice"
            href={article.url}
            key={article.id}
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">○</span>
            <div>
              <strong>{article.title}</strong>
              <p>{article.excerpt}</p>
            </div>
          </a>
        ))}
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

export function HomePage({ initialData }: { initialData: BootstrapPayload }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseHomeFilters(searchParams.toString()), [searchParams]);
  const { scope, category, q: query } = filters;
  const [articles, setArticles] = useState(initialData.articles);
  const [nextCursor, setNextCursor] = useState<string>();
  const [situations, setSituations] = useState<BootstrapPayload["situations"]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string>();
  const [savingArticleIds, setSavingArticleIds] = useState<Set<string>>(() => new Set());
  const savingArticleIdsRef = useRef<Set<string>>(new Set());
  const articleSavedOverridesRef = useRef<Map<string, boolean>>(new Map());
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
                const pendingSavedById = articleSavedOverridesRef.current;
                if (pendingSavedById.size === 0) return page.items;
                return page.items.map((item) =>
                  pendingSavedById.has(item.id)
                    ? { ...item, saved: pendingSavedById.get(item.id) ?? item.saved }
                    : item,
                );
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

  const lead = filtered[0];
  const secondary = filtered.filter((article) => article.id !== lead?.id);

  async function updateSaved(id: string, saved: boolean) {
    if (savingArticleIdsRef.current.has(id)) return;
    const previous = articles.find((item) => item.id === id)?.saved ?? false;
    setSaveError(undefined);
    const pending = new Set(savingArticleIdsRef.current).add(id);
    savingArticleIdsRef.current = pending;
    articleSavedOverridesRef.current = new Map(articleSavedOverridesRef.current).set(id, saved);
    setSavingArticleIds(pending);
    setArticles((items) => items.map((item) => (item.id === id ? { ...item, saved } : item)));
    try {
      await api.saveArticle(id, saved);
    } catch (reason) {
      articleSavedOverridesRef.current = new Map(articleSavedOverridesRef.current).set(
        id,
        previous,
      );
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
            className={scope === "trondheim" ? "selected" : ""}
            onClick={() => updateFilters({ scope: "trondheim" })}
          >
            Trondheim
          </button>
          <button
            className={scope === "trondelag" ? "selected" : ""}
            onClick={() => updateFilters({ scope: "trondelag" })}
          >
            Trøndelag
          </button>
        </div>
        <div className="filters" aria-label="Filtrer saker og åpne temasider">
          {articleCategories.map((item: ArticleCategoryFilter) =>
            item === "Vær" ? (
              <Link className="dashboard-weather-link" key={item} to="/vaer">
                {item}
              </Link>
            ) : (
              <button
                className={category === item ? "selected" : ""}
                key={item}
                onClick={() => updateFilters({ category: item })}
              >
                {item}
              </button>
            ),
          )}
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
          {lead ? (
            <LeadStory article={lead} saving={savingArticleIds.has(lead.id)} onSave={updateSaved} />
          ) : null}
          {!loading && !lead ? (
            <p className="feed-state">Ingen saker samsvarer med {searchSummary(filters)}.</p>
          ) : null}
          <div className="news-list">
            {secondary.map((article) => (
              <NewsRow
                key={article.id}
                article={article}
                saving={savingArticleIds.has(article.id)}
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
        <NearbyRail articles={filtered} data={initialData} />
      </div>
    </main>
  );
}
