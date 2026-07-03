import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  ArticleCoverageBundleConfidence,
  ArticleCoverageBundleKind,
  CoverageBundleListItem,
  CoverageBundlePage,
  CoverageBundleQueryInput,
} from "@nytt/shared";
import { api } from "../api.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

interface CoverageBundleFilters extends CoverageBundleQueryInput {
  selectedBundle?: string;
}

const kindLabels: Record<ArticleCoverageBundleKind, string> = {
  incident: "Hendelse",
  topic: "Tema",
  update: "Oppdatering",
};

const confidenceLabels: Record<ArticleCoverageBundleConfidence, string> = {
  high: "Høy",
  medium: "Middels",
};

const signalLabels: Record<CoverageBundleListItem["signals"][number]["kind"], string> = {
  persisted_bundle: "Lagret kobling",
  situation_id: "Situasjons-ID",
  title_similarity: "Tittellikhet",
  near_duplicate: "Nær duplikat",
  generic_place_incident: "Generisk steds-hendelse",
  topical_thread: "Tematråd",
  cross_source_incident: "Tverrkilde-hendelse",
  shared_place: "Delt sted",
};

const nearMissLabels: Record<CoverageBundleListItem["nearMisses"][number]["reason"], string> = {
  conflicting_specific_places: "Konflikt i spesifikt sted",
  different_situation: "Annen situasjon",
  outside_time_window: "Utenfor tidsvindu",
  low_text_overlap: "Lav tekstoverlapp",
  stale_persisted_bundle: "Utdatert lagret kobling",
};

function time(value?: string) {
  return value
    ? new Intl.DateTimeFormat("nb-NO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Oslo",
      }).format(new Date(value))
    : "Ikke registrert";
}

function parseCoverageBundleFilters(search: string): CoverageBundleFilters {
  const parameters = new URLSearchParams(search);
  const kind = parameters.get("kind");
  const confidence = parameters.get("confidence");
  const q = parameters.get("q")?.trim() || undefined;
  const cursor = parameters.get("cursor") || undefined;
  const selectedBundle = parameters.get("bundle") || undefined;
  return {
    limit: 30,
    ...(kind === "incident" || kind === "topic" || kind === "update" ? { kind } : {}),
    ...(confidence === "high" || confidence === "medium" ? { confidence } : {}),
    ...(q ? { q } : {}),
    ...(cursor ? { cursor } : {}),
    ...(selectedBundle ? { selectedBundle } : {}),
  };
}

function buildCoverageBundleSearch(filters: CoverageBundleFilters) {
  const parameters = new URLSearchParams();
  if (filters.kind) parameters.set("kind", filters.kind);
  if (filters.confidence) parameters.set("confidence", filters.confidence);
  if (filters.q) parameters.set("q", filters.q);
  if (filters.cursor) parameters.set("cursor", filters.cursor);
  if (filters.selectedBundle) parameters.set("bundle", filters.selectedBundle);
  return parameters;
}

function queryFromFilters(filters: CoverageBundleFilters): CoverageBundleQueryInput {
  return {
    limit: filters.limit ?? 30,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.confidence ? { confidence: filters.confidence } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  };
}

function signalText(signal: CoverageBundleListItem["signals"][number]) {
  const metrics = [
    signal.overlap !== undefined ? `${signal.overlap} treff` : undefined,
    signal.score !== undefined ? `${Math.round(signal.score * 100)} %` : undefined,
    signal.detail,
  ].filter(Boolean);
  return metrics.length
    ? `${signalLabels[signal.kind]} · ${metrics.join(" · ")}`
    : signalLabels[signal.kind];
}

function nearMissText(nearMiss: CoverageBundleListItem["nearMisses"][number]) {
  const metrics = [
    nearMiss.overlap !== undefined ? `${nearMiss.overlap} treff` : undefined,
    nearMiss.score !== undefined ? `${Math.round(nearMiss.score * 100)} %` : undefined,
    nearMiss.detail,
  ].filter(Boolean);
  return metrics.length
    ? `${nearMissLabels[nearMiss.reason]} · ${metrics.join(" · ")}`
    : nearMissLabels[nearMiss.reason];
}

function nearMissArticleText(
  nearMiss: CoverageBundleListItem["nearMisses"][number],
  articlesById: Map<string, CoverageBundleListItem["memberArticles"][number]>,
) {
  const articleLabels = nearMiss.articleIds.flatMap((articleId) => {
    const article = articlesById.get(articleId);
    return article ? [`${article.sourceLabel}: ${article.title}`] : [];
  });
  return articleLabels.length ? articleLabels.join(" / ") : nearMiss.articleIds.join(" / ");
}

function BundleDrawer({ bundle }: { bundle: CoverageBundleListItem | undefined }) {
  if (!bundle) {
    return (
      <aside className="coverage-bundle-drawer">
        <p className="label">Detalj</p>
        <h2>Ingen gruppe valgt</h2>
      </aside>
    );
  }
  const nearMissArticlesById = new Map(
    [...bundle.memberArticles, ...bundle.nearMissArticles].map((article) => [article.id, article]),
  );

  return (
    <aside className="coverage-bundle-drawer" aria-label={`Detaljer for ${bundle.reason}`}>
      <p className="label">{kindLabels[bundle.kind]}</p>
      <h2>{bundle.reason}</h2>
      <div className="coverage-bundle-badges">
        <span>{confidenceLabels[bundle.confidence]} tillit</span>
        <span>{bundle.memberArticles.length} saker</span>
        <span>{bundle.sourceLabels.join(", ")}</span>
      </div>
      <dl className="coverage-bundle-facts">
        <div>
          <dt>Generert</dt>
          <dd>{time(bundle.generatedAt)}</dd>
        </div>
        <div>
          <dt>Sist sett</dt>
          <dd>{time(bundle.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Primærsak</dt>
          <dd>{bundle.primaryArticleId}</dd>
        </div>
      </dl>
      <section>
        <h3>Saker</h3>
        <div className="coverage-bundle-member-list">
          {bundle.memberArticles.map((article) => {
            const href = safeExternalUrl(article.url);
            const content = (
              <>
                <span>{article.sourceLabel}</span>
                <strong>{article.title}</strong>
                <small>
                  {time(article.publishedAt)} · {article.places.join(", ") || "Ukjent sted"}
                </small>
              </>
            );
            return href ? (
              <a href={href} key={article.id}>
                {content}
              </a>
            ) : (
              <div className="coverage-bundle-member-linkless" key={article.id}>
                {content}
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <h3>Treffsignaler</h3>
        {bundle.signals.length ? (
          <ul className="coverage-bundle-signal-list">
            {bundle.signals.map((signal) => (
              <li key={`${signal.kind}:${signal.articleIds.join(":")}`}>{signalText(signal)}</li>
            ))}
          </ul>
        ) : (
          <p className="coverage-bundle-empty">Ingen signaler lagret.</p>
        )}
      </section>
      <section>
        <h3>Nesten-treff</h3>
        {bundle.nearMisses.length ? (
          <ul className="coverage-bundle-signal-list">
            {bundle.nearMisses.map((nearMiss) => (
              <li key={`${nearMiss.reason}:${nearMiss.articleIds.join(":")}`}>
                <span>{nearMissText(nearMiss)}</span>
                <small>{nearMissArticleText(nearMiss, nearMissArticlesById)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="coverage-bundle-empty">Ingen nesten-treff lagret.</p>
        )}
      </section>
    </aside>
  );
}

export function CoverageBundlesDashboard({
  page,
  filters,
  onFiltersChange,
}: {
  page: CoverageBundlePage;
  filters: CoverageBundleFilters;
  onFiltersChange: (filters: CoverageBundleFilters) => void;
}) {
  const selectedBundle =
    page.items.find((item) => item.id === filters.selectedBundle) ?? page.items[0];

  function update(next: Partial<CoverageBundleFilters>) {
    onFiltersChange({ ...filters, cursor: undefined, selectedBundle: undefined, ...next });
  }

  return (
    <main className="coverage-bundles-page">
      <header className="coverage-bundles-hero">
        <div>
          <p className="label">Privat kommandosenter</p>
          <h1>Dekningsgrupper</h1>
          <p>Siste generering {time(page.summary.latestGeneratedAt)}</p>
        </div>
        <div className="coverage-bundles-actions">
          <Link to="/command">Kommandosenter</Link>
          <Link to="/command/tidslinje">Tidslinje</Link>
          <Link to="/command/kilder">Kilderevisjon</Link>
        </div>
      </header>
      <section className="coverage-bundles-summary" aria-label="Dekningsoppsummering">
        <article>
          <strong>{page.summary.recentBundleCount}</strong>
          <span>Grupper</span>
        </article>
        <article>
          <strong>{page.summary.byKind.incident}</strong>
          <span>Hendelser</span>
        </article>
        <article>
          <strong>{page.summary.byKind.topic}</strong>
          <span>Tema</span>
        </article>
        <article>
          <strong>{page.summary.byConfidence.high}</strong>
          <span>Høy tillit</span>
        </article>
      </section>
      <div className="coverage-bundles-grid">
        <aside className="coverage-bundles-sidebar" aria-label="Dekningsfiltre">
          <label>
            Søk
            <input
              value={filters.q ?? ""}
              onChange={(event) => update({ q: event.target.value || undefined })}
              placeholder="Søk i grupper"
            />
          </label>
          <label>
            Type
            <select
              value={filters.kind ?? ""}
              onChange={(event) =>
                update({
                  kind: (event.target.value || undefined) as CoverageBundleFilters["kind"],
                })
              }
            >
              <option value="">Alle</option>
              <option value="incident">Hendelse</option>
              <option value="topic">Tema</option>
              <option value="update">Oppdatering</option>
            </select>
          </label>
          <label>
            Tillit
            <select
              value={filters.confidence ?? ""}
              onChange={(event) =>
                update({
                  confidence: (event.target.value ||
                    undefined) as CoverageBundleFilters["confidence"],
                })
              }
            >
              <option value="">Alle</option>
              <option value="high">Høy</option>
              <option value="medium">Middels</option>
            </select>
          </label>
        </aside>
        <section className="coverage-bundle-list" aria-labelledby="coverage-bundle-list-heading">
          <div className="coverage-bundle-list-heading">
            <div>
              <p className="label">Analyse</p>
              <h2 id="coverage-bundle-list-heading">Siste grupper</h2>
            </div>
            {page.nextCursor ? (
              <button
                type="button"
                onClick={() => onFiltersChange({ ...filters, cursor: page.nextCursor })}
              >
                Neste side
              </button>
            ) : null}
          </div>
          {page.items.length ? (
            page.items.map((bundle) => {
              const selected = selectedBundle?.id === bundle.id;
              return (
                <button
                  className={`coverage-bundle-row ${selected ? "selected" : ""}`}
                  data-coverage-bundle-row
                  key={bundle.id}
                  onClick={() => onFiltersChange({ ...filters, selectedBundle: bundle.id })}
                  type="button"
                >
                  <span className="coverage-bundle-row-main">
                    <strong>{bundle.reason}</strong>
                    <small>
                      {bundle.sourceLabels.join(", ")} · {time(bundle.lastSeenAt)}
                    </small>
                  </span>
                  <span className="coverage-bundle-row-meta">
                    <span>{kindLabels[bundle.kind]}</span>
                    <span>{confidenceLabels[bundle.confidence]}</span>
                    <span>{bundle.memberArticles.length} saker</span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="coverage-bundle-empty">Ingen dekningsgrupper matcher filteret.</p>
          )}
        </section>
        <BundleDrawer bundle={selectedBundle} />
      </div>
    </main>
  );
}

export function CoverageBundlesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const filters = useMemo(() => parseCoverageBundleFilters(searchText), [searchText]);
  const [page, setPage] = useState<CoverageBundlePage>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let ignore = false;
    setError(undefined);
    void api
      .coverageBundles(queryFromFilters(filters))
      .then((response) => {
        if (!ignore) setPage(response);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });
    return () => {
      ignore = true;
    };
  }, [filters]);

  function updateFilters(next: CoverageBundleFilters) {
    setSearchParams(buildCoverageBundleSearch(next), { replace: true });
  }

  if (error) {
    return (
      <main className="coverage-bundles-page coverage-bundles-error" role="alert">
        Kunne ikke hente dekningsgrupper: {error}
      </main>
    );
  }
  if (!page) return <main className="coverage-bundles-page">Henter dekningsgrupper...</main>;

  return <CoverageBundlesDashboard page={page} filters={filters} onFiltersChange={updateFilters} />;
}
