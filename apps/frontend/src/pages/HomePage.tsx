import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Article, BootstrapPayload, GeographicScope } from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon, BookmarkIcon } from "../components/Icons.js";
import { NewsMap } from "../components/MapViews.js";

const categories = ["Alle", "Hendelser", "Byutvikling", "Kultur", "Transport", "Politikk"];

function formatTime(date: string) {
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(date),
  );
}

function SaveButton({
  article,
  onUpdate,
}: {
  article: Article;
  onUpdate: (id: string, saved: boolean) => void;
}) {
  return (
    <button
      className="save"
      aria-label={article.saved ? "Fjern fra lagret" : "Lagre sak"}
      onClick={() => {
        const saved = !article.saved;
        onUpdate(article.id, saved);
        void api.saveArticle(article.id, saved);
      }}
    >
      <BookmarkIcon selected={article.saved} />
    </button>
  );
}

function SituationBanner({ data }: { data: BootstrapPayload }) {
  const situation = data.situations.find((item) => item.status !== "resolved");
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
          Oppdatert {formatTime(situation.updatedAt)} · {situation.verificationStatus}
        </p>
        <ul>
          <li>{situation.summary}</li>
          <li>Farevarsel og kartgrunnlag vises med tydelig kildeangivelse.</li>
        </ul>
        <Link className="primary-link" to={`/situasjoner/${situation.id}`}>
          Åpne situasjonsrom <ArrowIcon />
        </Link>
      </div>
      <div className="situation-preview" aria-label="Forhåndsvisning av kart">
        <p>Omtalt område</p>
        <div className="preview-shape" />
        <span className="preview-point">Bymarka</span>
        <small>Ikke bekreftet brannperimeter</small>
      </div>
    </article>
  );
}

function LeadStory({
  article,
  onSave,
}: {
  article: Article;
  onSave: (id: string, saved: boolean) => void;
}) {
  return (
    <article className="lead-story">
      <img src="/assets/trondheim-nidelva-feature.png" alt="Nidelva og trehusrekken i Trondheim" />
      <div className="lead-copy">
        <div className="metadata">
          {article.sourceLabel} · {formatTime(article.publishedAt)}
        </div>
        <SaveButton article={article} onUpdate={onSave} />
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
  onSave,
}: {
  article: Article;
  onSave: (id: string, saved: boolean) => void;
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
      <SaveButton article={article} onUpdate={onSave} />
    </article>
  );
}

function NearbyRail({ articles, data }: { articles: Article[]; data: BootstrapPayload }) {
  const located = articles.filter((article) => article.location).slice(0, 3);
  const civic = data.articles
    .filter((article) => article.source === "trondheim_kommune")
    .slice(0, 2);
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

export function HomePage({ initialData }: { initialData: BootstrapPayload }) {
  const [scope, setScope] = useState<GeographicScope>("trondheim");
  const [category, setCategory] = useState("Alle");
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState(initialData.articles);

  useEffect(() => {
    const onSearch = (event: Event) => setQuery((event as CustomEvent<string>).detail);
    window.addEventListener("nytt-search", onSearch);
    return () => window.removeEventListener("nytt-search", onSearch);
  }, []);

  const filtered = useMemo(() => {
    const search = query.toLocaleLowerCase("nb");
    return articles.filter(
      (article) =>
        article.scope === scope &&
        (category === "Alle" || article.category === category) &&
        (!search || `${article.title} ${article.excerpt}`.toLocaleLowerCase("nb").includes(search)),
    );
  }, [articles, category, query, scope]);

  const lead = filtered.find((article) => article.id === "a-bridge") ?? filtered[0];
  const secondary = filtered.filter(
    (article) => article.id !== lead?.id && article.id !== "a-fire",
  );

  function updateSaved(id: string, saved: boolean) {
    setArticles((items) => items.map((item) => (item.id === id ? { ...item, saved } : item)));
  }

  return (
    <main className="home">
      <div className="view-controls">
        <div className="scope-switch" aria-label="Geografisk visning">
          <button
            className={scope === "trondheim" ? "selected" : ""}
            onClick={() => setScope("trondheim")}
          >
            Trondheim
          </button>
          <button
            className={scope === "trondelag" ? "selected" : ""}
            onClick={() => setScope("trondelag")}
          >
            Trøndelag
          </button>
        </div>
        <div className="filters" aria-label="Filtrer saker">
          {categories.map((item) => (
            <button
              className={category === item ? "selected" : ""}
              key={item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <SituationBanner data={initialData} />
      <div className="home-grid">
        <section className="news-section">
          <h1>Siste nytt i {scope === "trondheim" ? "Trondheim" : "Trøndelag"}</h1>
          {lead ? <LeadStory article={lead} onSave={updateSaved} /> : null}
          <div className="news-list">
            {secondary.map((article) => (
              <NewsRow key={article.id} article={article} onSave={updateSaved} />
            ))}
          </div>
        </section>
        <NearbyRail articles={articles} data={initialData} />
      </div>
    </main>
  );
}
