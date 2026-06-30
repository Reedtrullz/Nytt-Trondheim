import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Article } from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon } from "../components/Icons.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

type MatchStatus = "finished" | "today" | "upcoming";
type MatchFilter = "today" | "norway" | "all";

interface SourceLink {
  label: string;
  href: string;
}

interface GroupRow {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  note: string;
}

interface GroupTable {
  id: string;
  title: string;
  reason: string;
  rows: GroupRow[];
}

interface WorldCupMatch {
  id: string;
  home: string;
  away: string;
  status: MatchStatus;
  kickoff?: string;
  result?: string;
  penaltyResult?: string;
  venue: string;
  note: string;
  source: string;
  norwayFocus?: boolean;
}

interface SportPageProps {
  initialArticles?: Article[];
}

interface WorldCupSportDashboardProps {
  articles?: Article[];
  loadingArticles?: boolean;
  articleError?: string;
}

const sourceLinks: SourceLink[] = [
  {
    label: "FIFA kampoversikt",
    href: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
  },
  {
    label: "FIFA tabeller",
    href: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/standings",
  },
  {
    label: "ESPN kampoppsett",
    href: "https://www.espn.com/soccer/story/_/id/48939282/2026-fifa-world-cup-fixtures-results-match-schedule-group-stage-knockout-rounds-bracket",
  },
  {
    label: "CBS gruppetabeller",
    href: "https://www.cbssports.com/soccer/news/world-cup-group-standings-table-results/",
  },
];

const worldCupSnapshotUpdatedAt = "2026-06-30T16:00:00.000Z";

const groupTables: GroupTable[] = [
  {
    id: "group-i",
    title: "Gruppe I",
    reason: "Norge-gruppa",
    rows: [
      {
        team: "Frankrike",
        played: 3,
        wins: 3,
        draws: 0,
        losses: 0,
        points: 9,
        note: "Vant gruppa",
      },
      {
        team: "Norge",
        played: 3,
        wins: 2,
        draws: 0,
        losses: 1,
        points: 6,
        note: "Videre, møter Elfenbenskysten",
      },
      {
        team: "Senegal",
        played: 3,
        wins: 1,
        draws: 0,
        losses: 2,
        points: 3,
        note: "Ute",
      },
      {
        team: "Irak",
        played: 3,
        wins: 0,
        draws: 0,
        losses: 3,
        points: 0,
        note: "Ute",
      },
    ],
  },
  {
    id: "group-e",
    title: "Gruppe E",
    reason: "Motstander-sporet",
    rows: [
      {
        team: "Tyskland",
        played: 3,
        wins: 2,
        draws: 0,
        losses: 1,
        points: 6,
        note: "Videre",
      },
      {
        team: "Elfenbenskysten",
        played: 3,
        wins: 2,
        draws: 0,
        losses: 1,
        points: 6,
        note: "Møter Norge",
      },
      {
        team: "Ecuador",
        played: 3,
        wins: 1,
        draws: 1,
        losses: 1,
        points: 4,
        note: "Videre som treer",
      },
      {
        team: "Curaçao",
        played: 3,
        wins: 0,
        draws: 1,
        losses: 2,
        points: 1,
        note: "Ute",
      },
    ],
  },
];

const roundOf32Matches: WorldCupMatch[] = [
  {
    id: "canada-south-africa",
    home: "Canada",
    away: "Sør-Afrika",
    status: "finished",
    result: "1–0",
    venue: "Dallas",
    note: "Canada videre til åttedelsfinale.",
    source: "ESPN",
  },
  {
    id: "brazil-japan",
    home: "Brasil",
    away: "Japan",
    status: "finished",
    result: "2–1",
    venue: "Philadelphia",
    note: "Brasil avgjorde sent.",
    source: "ESPN",
  },
  {
    id: "paraguay-germany",
    home: "Paraguay",
    away: "Tyskland",
    status: "finished",
    result: "1–1",
    penaltyResult: "4–3 str.",
    venue: "Kansas City",
    note: "Paraguay videre etter straffer.",
    source: "ESPN",
  },
  {
    id: "morocco-netherlands",
    home: "Marokko",
    away: "Nederland",
    status: "finished",
    result: "1–1",
    penaltyResult: "3–2 str.",
    venue: "Guadalupe",
    note: "Marokko møter Canada.",
    source: "ESPN",
  },
  {
    id: "ivory-coast-norway",
    home: "Elfenbenskysten",
    away: "Norge",
    status: "today",
    kickoff: "2026-06-30T17:00:00.000Z",
    venue: "Arlington / Dallas",
    note: "Norges første utslagskamp. Vinneren går til åttedelsfinale.",
    source: "FIFA / ESPN",
    norwayFocus: true,
  },
  {
    id: "france-sweden",
    home: "Frankrike",
    away: "Sverige",
    status: "today",
    kickoff: "2026-06-30T21:00:00.000Z",
    venue: "East Rutherford",
    note: "Gruppevinneren fra Norges gruppe møter Sverige.",
    source: "ESPN",
  },
  {
    id: "mexico-ecuador",
    home: "Mexico",
    away: "Ecuador",
    status: "today",
    kickoff: "2026-07-01T01:00:00.000Z",
    venue: "Mexico by",
    note: "Nattkamp norsk tid.",
    source: "ESPN",
  },
  {
    id: "england-dr-congo",
    home: "England",
    away: "DR Kongo",
    status: "upcoming",
    kickoff: "2026-07-01T16:00:00.000Z",
    venue: "Miami",
    note: "Neste sluttspilldag.",
    source: "ESPN",
  },
  {
    id: "belgium-senegal",
    home: "Belgia",
    away: "Senegal",
    status: "upcoming",
    kickoff: "2026-07-01T20:00:00.000Z",
    venue: "Houston",
    note: "Senegal videre som tredjelag.",
    source: "ESPN",
  },
  {
    id: "usa-bosnia",
    home: "USA",
    away: "Bosnia-Hercegovina",
    status: "upcoming",
    kickoff: "2026-07-02T00:00:00.000Z",
    venue: "Los Angeles",
    note: "Vertsnasjon i kveldskamp amerikansk tid.",
    source: "ESPN",
  },
  {
    id: "spain-austria",
    home: "Spania",
    away: "Østerrike",
    status: "upcoming",
    kickoff: "2026-07-02T19:00:00.000Z",
    venue: "Seattle",
    note: "Spania inn i sluttspillet.",
    source: "ESPN",
  },
  {
    id: "portugal-croatia",
    home: "Portugal",
    away: "Kroatia",
    status: "upcoming",
    kickoff: "2026-07-02T23:00:00.000Z",
    venue: "Atlanta",
    note: "Europeisk tungvekterkamp.",
    source: "ESPN",
  },
];

function formatKickoff(value: string | undefined): string {
  if (!value) return "Tid ikke bekreftet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function formatArticleTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(date);
}

function statusLabel(status: MatchStatus): string {
  switch (status) {
    case "finished":
      return "Ferdig";
    case "today":
      return "I dag";
    case "upcoming":
      return "Neste";
  }
}

function ExternalLink({ link }: { link: SourceLink }) {
  const href = safeExternalUrl(link.href);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {link.label}
      <ArrowIcon />
    </a>
  );
}

function articleHref(article: Article): string | undefined {
  return safeExternalUrl(article.url);
}

function MatchCard({ match }: { match: WorldCupMatch }) {
  return (
    <article className={`sport-match sport-match-${match.status}`}>
      <header>
        <span className="sport-match-status">{statusLabel(match.status)}</span>
        <time dateTime={match.kickoff}>{formatKickoff(match.kickoff)}</time>
      </header>
      <div className="sport-match-line">
        <strong>{match.home}</strong>
        <span>{match.result ?? "–"}</span>
        <strong>{match.away}</strong>
      </div>
      {match.penaltyResult ? <p className="sport-match-penalty">{match.penaltyResult}</p> : null}
      <p>{match.note}</p>
      <small>
        {match.venue} · {match.source}
      </small>
    </article>
  );
}

function GroupTableCard({ table }: { table: GroupTable }) {
  return (
    <section className="sport-table-panel" aria-labelledby={`${table.id}-heading`}>
      <header>
        <p className="label">{table.reason}</p>
        <h2 id={`${table.id}-heading`}>{table.title}</h2>
      </header>
      <div className="sport-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Lag</th>
              <th>K</th>
              <th>V</th>
              <th>U</th>
              <th>T</th>
              <th>P</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.team} className={row.team === "Norge" ? "sport-table-norway" : ""}>
                <th scope="row">{row.team}</th>
                <td>{row.played}</td>
                <td>{row.wins}</td>
                <td>{row.draws}</td>
                <td>{row.losses}</td>
                <td>{row.points}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SportArticleList({
  articles,
  loading,
  error,
}: {
  articles: Article[];
  loading?: boolean;
  error?: string;
}) {
  if (loading && articles.length === 0) {
    return <p className="sport-news-state">Henter lokale sportssaker...</p>;
  }
  if (error && articles.length === 0) {
    return <p className="sport-news-state">{error}</p>;
  }
  if (articles.length === 0) {
    return <p className="sport-news-state">Ingen lokale sportssaker akkurat nå.</p>;
  }

  return (
    <div className="sport-news-list">
      {articles.map((article) => {
        const href = articleHref(article);
        const content = (
          <>
            <span>
              {article.sourceLabel} · {formatArticleTime(article.publishedAt)}
            </span>
            <strong>{article.title}</strong>
            <p>{article.excerpt}</p>
          </>
        );
        return href ? (
          <a key={article.id} href={href} target="_blank" rel="noreferrer noopener">
            {content}
          </a>
        ) : (
          <article key={article.id}>{content}</article>
        );
      })}
      {error ? <p className="sport-news-state">{error}</p> : null}
    </div>
  );
}

export function WorldCupSportDashboard({
  articles = [],
  loadingArticles = false,
  articleError,
}: WorldCupSportDashboardProps) {
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("today");
  const visibleMatches = useMemo(() => {
    if (matchFilter === "norway") return roundOf32Matches.filter((match) => match.norwayFocus);
    if (matchFilter === "today")
      return roundOf32Matches.filter((match) => match.status === "today");
    return roundOf32Matches;
  }, [matchFilter]);
  const finishedCount = roundOf32Matches.filter((match) => match.status === "finished").length;
  const todayCount = roundOf32Matches.filter((match) => match.status === "today").length;
  const nextNorwayMatch = roundOf32Matches.find((match) => match.norwayFocus);

  return (
    <main className="sport-page">
      <section className="sport-hero" aria-labelledby="sport-title">
        <div>
          <p className="label">Sport · VM 2026</p>
          <h1 id="sport-title">VM 2026</h1>
          <p>
            Sluttspill, Norge-spor og lokale sportssaker samlet på ett sted. Kampdata er et kuratert
            øyeblikksbilde med offisielle kildelenker.
          </p>
        </div>
        <div className="sport-hero-meta" aria-label="VM-kilder">
          <span>Sist oppdatert {formatKickoff(worldCupSnapshotUpdatedAt)}</span>
          {sourceLinks.map((link) => (
            <ExternalLink key={link.href} link={link} />
          ))}
        </div>
      </section>

      <section className="sport-summary-grid" aria-label="VM-status">
        <article className="sport-summary-card sport-summary-card-norway">
          <span>Norge nå</span>
          <strong>{nextNorwayMatch ? formatKickoff(nextNorwayMatch.kickoff) : "Ikke satt"}</strong>
          <p>
            {nextNorwayMatch ? `${nextNorwayMatch.home} - ${nextNorwayMatch.away}` : "Avventer"}
          </p>
        </article>
        <article className="sport-summary-card">
          <span>Kamper i dag</span>
          <strong>{todayCount}</strong>
          <p>Tre 32-delsfinaler i kveldens VM-vindu.</p>
        </article>
        <article className="sport-summary-card">
          <span>Sluttspill</span>
          <strong>{finishedCount}/16</strong>
          <p>Ferdigspilte 32-delsfinaler i denne visningen.</p>
        </article>
        <article className="sport-summary-card">
          <span>Tabellfokus</span>
          <strong>Gruppe I/E</strong>
          <p>Norges gruppe og motstanderens gruppe.</p>
        </article>
      </section>

      <section className="sport-workspace">
        <section className="sport-panel sport-match-panel" aria-labelledby="sport-next-heading">
          <header className="sport-panel-heading">
            <div>
              <p className="label">32-delsfinaler</p>
              <h2 id="sport-next-heading">Neste kamper</h2>
            </div>
            <div className="sport-segmented" aria-label="Kampfilter">
              <button
                type="button"
                className={matchFilter === "today" ? "selected" : ""}
                aria-pressed={matchFilter === "today"}
                onClick={() => setMatchFilter("today")}
              >
                I dag
              </button>
              <button
                type="button"
                className={matchFilter === "norway" ? "selected" : ""}
                aria-pressed={matchFilter === "norway"}
                onClick={() => setMatchFilter("norway")}
              >
                Norge
              </button>
              <button
                type="button"
                className={matchFilter === "all" ? "selected" : ""}
                aria-pressed={matchFilter === "all"}
                onClick={() => setMatchFilter("all")}
              >
                Alle
              </button>
            </div>
          </header>
          <div className="sport-match-list">
            {visibleMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        </section>

        <aside className="sport-panel sport-news-panel" aria-labelledby="sport-local-heading">
          <header className="sport-panel-heading">
            <div>
              <p className="label">Trondheim</p>
              <h2 id="sport-local-heading">Lokale sportssaker</h2>
            </div>
            <Link className="sport-panel-link" to="/?category=Sport">
              Flere saker
              <ArrowIcon />
            </Link>
          </header>
          <SportArticleList articles={articles} loading={loadingArticles} error={articleError} />
        </aside>
      </section>

      <section className="sport-bracket-panel" aria-labelledby="sport-bracket-heading">
        <header className="sport-panel-heading">
          <div>
            <p className="label">Bracket</p>
            <h2 id="sport-bracket-heading">Sluttspillstatus</h2>
          </div>
          <span>32-delsfinaler til åttedelsfinaler</span>
        </header>
        <div className="sport-bracket-grid">
          {roundOf32Matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </section>

      <section className="sport-table-grid" aria-label="VM-tabeller">
        {groupTables.map((table) => (
          <GroupTableCard key={table.id} table={table} />
        ))}
      </section>
    </main>
  );
}

export function SportPage({ initialArticles = [] }: SportPageProps) {
  const initialSportArticles = useMemo(
    () => initialArticles.filter((article) => article.category === "Sport").slice(0, 6),
    [initialArticles],
  );
  const [articles, setArticles] = useState<Article[]>(initialSportArticles);
  const [loadingArticles, setLoadingArticles] = useState(initialSportArticles.length === 0);
  const [articleError, setArticleError] = useState<string>();

  useEffect(() => {
    let ignore = false;
    setLoadingArticles(true);
    setArticleError(undefined);
    api
      .articles({ category: "Sport", scope: "trondelag", limit: 8 })
      .then((page) => {
        if (!ignore) setArticles(page.items.slice(0, 8));
      })
      .catch((reason: unknown) => {
        if (!ignore) {
          setArticleError(
            reason instanceof Error ? reason.message : "Kunne ikke hente sportssaker.",
          );
        }
      })
      .finally(() => {
        if (!ignore) setLoadingArticles(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <WorldCupSportDashboard
      articles={articles}
      loadingArticles={loadingArticles}
      articleError={articleError}
    />
  );
}
