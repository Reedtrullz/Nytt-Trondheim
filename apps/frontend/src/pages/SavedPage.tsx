import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Article, Situation } from "@nytt/shared";
import { api } from "../api.js";

function time(value: string) {
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function SavedPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.all([api.savedArticles(), api.situations({ saved: true })])
      .then(([savedArticles, savedSituations]) => {
        setArticles(savedArticles);
        setSituations(savedSituations.items);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="saved-page">
      <header className="page-heading">
        <p className="label">Privat arkiv</p>
        <h1>Lagret</h1>
        <p>Saker og situasjoner du har merket for oppfølging.</p>
      </header>
      {loading ? <p className="feed-state">Henter lagrede elementer...</p> : null}
      {error ? <p className="feed-state error">Kunne ikke hente lagret: {error}</p> : null}
      {!loading && !error && articles.length === 0 && situations.length === 0 ? (
        <p className="empty-panel">Du har ingen lagrede saker eller situasjoner.</p>
      ) : null}
      {situations.length ? (
        <section className="saved-group situation-cards">
          <h2>Situasjoner</h2>
          {situations.map((situation) => (
            <article key={situation.id}>
              <div>
                <h3>{situation.title}</h3>
                <small>
                  {situation.locationLabel} · {time(situation.updatedAt)}
                </small>
              </div>
              <Link className="primary-link" to={`/situasjoner/${situation.id}`}>
                Åpne oversikt
              </Link>
            </article>
          ))}
        </section>
      ) : null}
      {articles.length ? (
        <section className="saved-group saved-articles">
          <h2>Saker</h2>
          {articles.map((article) => (
            <a key={article.id} href={article.url} target="_blank" rel="noreferrer">
              <small>
                {article.sourceLabel} · {time(article.publishedAt)}
              </small>
              <strong>{article.title}</strong>
              <p>{article.excerpt}</p>
            </a>
          ))}
        </section>
      ) : null}
    </main>
  );
}
