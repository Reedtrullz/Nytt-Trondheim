import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Article } from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon } from "../components/Icons.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

type MatchStatus = "finished" | "live" | "upcoming";
type MatchFilter = "featured" | "norway" | "all";

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
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
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
  stage: string;
  home: string;
  away: string;
  status: MatchStatus;
  kickoff?: string;
  result?: string;
  penaltyResult?: string;
  venue: string;
  note: string;
  consequence: string;
  source: string;
  featured?: boolean;
  norwayFocus?: boolean;
}

interface SportPageProps {
  initialArticles?: Article[];
}

interface WorldCupSportDashboardProps {
  articles?: Article[];
  loadingArticles?: boolean;
  articleError?: string;
  now?: Date;
}

const sourceLinks: SourceLink[] = [
  {
    label: "FIFA format",
    href: "https://www.fifa.com/en/articles/article-fifa-world-cup-2026-mexico-canada-usa-new-format-tournament-football-soccer",
  },
  {
    label: "FIFA kampoversikt",
    href: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
  },
  {
    label: "ESPN kampoppsett",
    href: "https://www.espn.com/soccer/story/_/id/48939282/2026-fifa-world-cup-fixtures-results-match-schedule-group-stage-knockout-rounds-bracket",
  },
  {
    label: "FOX live score",
    href: "https://www.foxsports.com/soccer/fifa-world-cup/scores",
  },
  {
    label: "FOX tabeller",
    href: "https://www.foxsports.com/soccer/fifa-world-cup/standings",
  },
];

const worldCupSnapshotUpdatedAt = "2026-07-01T10:30:00.000Z";

const tournamentPhases = [
  {
    id: "groups",
    label: "Gruppespill",
    value: "Ferdig",
    note: "12 grupper à fire lag.",
  },
  {
    id: "round-of-32",
    label: "32-delsfinaler",
    value: "Pågår",
    note: "Ekstra utslagsrunde i 48-lagsformatet.",
  },
  {
    id: "round-of-16",
    label: "Åttedelsfinaler",
    value: "4.–7. juli",
    note: "Norge møter Brasil 5. juli.",
  },
  {
    id: "final",
    label: "Finale",
    value: "19. juli",
    note: "Åtte kamper kreves for mesteren.",
  },
];

const norwayPath = [
  {
    label: "Forrige",
    title: "Elfenbenskysten 1–2 Norge",
    note: "Norge videre fra 32-delsfinalen.",
  },
  {
    label: "Neste",
    title: "Brasil – Norge",
    note: "Åttedelsfinale i New York/New Jersey.",
  },
  {
    label: "Mulig etterpå",
    title: "Kvartfinale-sporet",
    note: "Vinneren går inn mot kamp 92-vinneren.",
  },
];

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
        goalsFor: 10,
        goalsAgainst: 2,
        goalDifference: 8,
        points: 9,
        note: "Vant gruppa",
      },
      {
        team: "Norge",
        played: 3,
        wins: 2,
        draws: 0,
        losses: 1,
        goalsFor: 8,
        goalsAgainst: 7,
        goalDifference: 1,
        points: 6,
        note: "Videre, slo Elfenbenskysten",
      },
      {
        team: "Senegal",
        played: 3,
        wins: 1,
        draws: 0,
        losses: 2,
        goalsFor: 8,
        goalsAgainst: 6,
        goalDifference: 2,
        points: 3,
        note: "Ute",
      },
      {
        team: "Irak",
        played: 3,
        wins: 0,
        draws: 0,
        losses: 3,
        goalsFor: 1,
        goalsAgainst: 12,
        goalDifference: -11,
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
        goalsFor: 10,
        goalsAgainst: 4,
        goalDifference: 6,
        points: 6,
        note: "Videre",
      },
      {
        team: "Elfenbenskysten",
        played: 3,
        wins: 2,
        draws: 0,
        losses: 1,
        goalsFor: 4,
        goalsAgainst: 2,
        goalDifference: 2,
        points: 6,
        note: "Ute mot Norge",
      },
      {
        team: "Ecuador",
        played: 3,
        wins: 1,
        draws: 1,
        losses: 1,
        goalsFor: 2,
        goalsAgainst: 2,
        goalDifference: 0,
        points: 4,
        note: "Videre som treer",
      },
      {
        team: "Curaçao",
        played: 3,
        wins: 0,
        draws: 1,
        losses: 2,
        goalsFor: 1,
        goalsAgainst: 9,
        goalDifference: -8,
        points: 1,
        note: "Ute",
      },
    ],
  },
];

const roundOf32Matches: WorldCupMatch[] = [
  {
    id: "canada-south-africa",
    stage: "32-delsfinale",
    home: "Canada",
    away: "Sør-Afrika",
    status: "finished",
    result: "1–0",
    venue: "Dallas",
    note: "Canada videre til åttedelsfinale.",
    consequence: "Møter Marokko.",
    source: "ESPN",
  },
  {
    id: "brazil-japan",
    stage: "32-delsfinale",
    home: "Brasil",
    away: "Japan",
    status: "finished",
    result: "2–1",
    venue: "Philadelphia",
    note: "Brasil avgjorde sent.",
    consequence: "Møter Norge.",
    source: "ESPN",
  },
  {
    id: "paraguay-germany",
    stage: "32-delsfinale",
    home: "Paraguay",
    away: "Tyskland",
    status: "finished",
    result: "1–1",
    penaltyResult: "4–3 str.",
    venue: "Kansas City",
    note: "Paraguay videre etter straffer.",
    consequence: "Tyskland ute.",
    source: "ESPN",
  },
  {
    id: "morocco-netherlands",
    stage: "32-delsfinale",
    home: "Marokko",
    away: "Nederland",
    status: "finished",
    result: "1–1",
    penaltyResult: "3–2 str.",
    venue: "Guadalupe",
    note: "Marokko møter Canada.",
    consequence: "Nederland ute.",
    source: "ESPN",
  },
  {
    id: "ivory-coast-norway",
    stage: "32-delsfinale",
    home: "Elfenbenskysten",
    away: "Norge",
    status: "finished",
    kickoff: "2026-06-30T17:00:00.000Z",
    result: "1–2",
    venue: "Arlington / Dallas",
    note: "Norge vant første utslagskamp.",
    consequence: "Møter Brasil i åttedelsfinalen.",
    source: "FOX / ESPN",
    featured: true,
    norwayFocus: true,
  },
  {
    id: "brazil-norway",
    stage: "Åttedelsfinale",
    home: "Brasil",
    away: "Norge",
    status: "upcoming",
    kickoff: "2026-07-05T20:00:00.000Z",
    venue: "New York/New Jersey",
    note: "Neste Norge-kamp i sluttspillet.",
    consequence: "Vinneren går til kvartfinale-sporet.",
    source: "FOX / ESPN",
    featured: true,
    norwayFocus: true,
  },
  {
    id: "france-sweden",
    stage: "32-delsfinale",
    home: "Frankrike",
    away: "Sverige",
    status: "live",
    kickoff: "2026-06-30T21:00:00.000Z",
    venue: "East Rutherford",
    note: "Gruppevinneren fra Norges gruppe møter Sverige.",
    consequence: "Sjekk live score før publisering.",
    source: "FOX / ESPN",
  },
  {
    id: "mexico-ecuador",
    stage: "32-delsfinale",
    home: "Mexico",
    away: "Ecuador",
    status: "upcoming",
    kickoff: "2026-07-01T01:00:00.000Z",
    venue: "Mexico by",
    note: "Nattkamp norsk tid.",
    consequence: "Vinneren går inn i Norges side av bracketen.",
    source: "FOX / ESPN",
  },
  {
    id: "england-dr-congo",
    stage: "32-delsfinale",
    home: "England",
    away: "DR Kongo",
    status: "upcoming",
    kickoff: "2026-07-01T16:00:00.000Z",
    venue: "Miami",
    note: "Neste sluttspilldag.",
    consequence: "Aktuell i dagens kampvindu.",
    source: "FOX / ESPN",
    featured: true,
  },
  {
    id: "belgium-senegal",
    stage: "32-delsfinale",
    home: "Belgia",
    away: "Senegal",
    status: "upcoming",
    kickoff: "2026-07-01T20:00:00.000Z",
    venue: "Houston",
    note: "Senegal videre som tredjelag.",
    consequence: "Aktuell i kveldsvinduet.",
    source: "FOX / ESPN",
    featured: true,
  },
  {
    id: "usa-bosnia",
    stage: "32-delsfinale",
    home: "USA",
    away: "Bosnia-Hercegovina",
    status: "upcoming",
    kickoff: "2026-07-02T00:00:00.000Z",
    venue: "Los Angeles",
    note: "Vertsnasjon i kveldskamp amerikansk tid.",
    consequence: "Avslutter dagens norske nattvindu.",
    source: "FOX / ESPN",
    featured: true,
  },
  {
    id: "spain-austria",
    stage: "32-delsfinale",
    home: "Spania",
    away: "Østerrike",
    status: "upcoming",
    kickoff: "2026-07-02T19:00:00.000Z",
    venue: "Seattle",
    note: "Spania inn i sluttspillet.",
    consequence: "Neste runde etter dagens kamper.",
    source: "ESPN",
  },
  {
    id: "portugal-croatia",
    stage: "32-delsfinale",
    home: "Portugal",
    away: "Kroatia",
    status: "upcoming",
    kickoff: "2026-07-02T23:00:00.000Z",
    venue: "Atlanta",
    note: "Europeisk tungvekterkamp.",
    consequence: "Neste runde etter dagens kamper.",
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
    case "live":
      return "Pågår";
    case "upcoming":
      return "Neste";
  }
}

function formatGoalDifference(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function snapshotAgeHours(now: Date): number | undefined {
  const snapshotDate = new Date(worldCupSnapshotUpdatedAt);
  if (Number.isNaN(snapshotDate.getTime()) || Number.isNaN(now.getTime())) return undefined;
  return Math.max(0, Math.round((now.getTime() - snapshotDate.getTime()) / 36_000) / 100);
}

function snapshotStatusLabel(now: Date): string {
  const age = snapshotAgeHours(now);
  if (age === undefined) return "Kuratert øyeblikksbilde";
  if (age < 2) return "Nylig kontrollert";
  if (age < 12) return "Kuratert i dag";
  return "Bør kontrolleres mot live score";
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
        <span className="sport-match-status">
          {match.stage} · {statusLabel(match.status)}
        </span>
        <time dateTime={match.kickoff}>{formatKickoff(match.kickoff)}</time>
      </header>
      <div className="sport-match-line">
        <strong>{match.home}</strong>
        <span>{match.result ?? "–"}</span>
        <strong>{match.away}</strong>
      </div>
      {match.penaltyResult ? <p className="sport-match-penalty">{match.penaltyResult}</p> : null}
      <p>{match.note}</p>
      <p className="sport-match-consequence">{match.consequence}</p>
      <small>
        {match.venue} · {match.source}
      </small>
    </article>
  );
}

function SportDataStatus({ now }: { now: Date }) {
  const age = snapshotAgeHours(now);
  const ageLabel = age === undefined ? "Alder ukjent" : `${age.toLocaleString("nb-NO")} t gammel`;

  return (
    <section className="sport-data-status" aria-label="Datastatus">
      <article>
        <span>VM-kamper</span>
        <strong>{snapshotStatusLabel(now)}</strong>
        <p>Kuratert snapshot, ikke live-resultater.</p>
      </article>
      <article>
        <span>Sist kontrollert</span>
        <strong>{formatKickoff(worldCupSnapshotUpdatedAt)}</strong>
        <p>{ageLabel}.</p>
      </article>
      <article>
        <span>Lokale saker</span>
        <strong>Fra Nytt</strong>
        <p>Hentes fra lokale sportssaker i Trøndelag.</p>
      </article>
    </section>
  );
}

function TournamentPhaseStrip() {
  return (
    <section className="sport-phase-strip" aria-label="Turneringsfase">
      {tournamentPhases.map((phase) => (
        <article key={phase.id}>
          <span>{phase.label}</span>
          <strong>{phase.value}</strong>
          <p>{phase.note}</p>
        </article>
      ))}
    </section>
  );
}

function NorwayPathPanel() {
  return (
    <section className="sport-panel sport-path-panel" aria-labelledby="sport-path-heading">
      <header className="sport-panel-heading">
        <div>
          <p className="label">Norge-sporet</p>
          <h2 id="sport-path-heading">Veien videre</h2>
        </div>
      </header>
      <div className="sport-path-list">
        {norwayPath.map((step) => (
          <article key={step.label}>
            <span>{step.label}</span>
            <strong>{step.title}</strong>
            <p>{step.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function BracketStatusTable({ matches }: { matches: WorldCupMatch[] }) {
  return (
    <div className="sport-bracket-table" role="table" aria-label="Sluttspillstatus">
      <div className="sport-bracket-row sport-bracket-row-head" role="row">
        <span role="columnheader">Kamp</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Følge</span>
      </div>
      {matches.map((match) => (
        <article key={match.id} className="sport-bracket-row" role="row">
          <span role="cell">
            <strong>
              {match.home} – {match.away}
            </strong>
            <small>{formatKickoff(match.kickoff)}</small>
          </span>
          <span role="cell">
            {statusLabel(match.status)}
            {match.result ? ` · ${match.result}` : ""}
            {match.penaltyResult ? ` (${match.penaltyResult})` : ""}
          </span>
          <span role="cell">{match.consequence}</span>
        </article>
      ))}
    </div>
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
              <th>MF</th>
              <th>MM</th>
              <th>±</th>
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
                <td>{row.goalsFor}</td>
                <td>{row.goalsAgainst}</td>
                <td>{formatGoalDifference(row.goalDifference)}</td>
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
  now = new Date(),
}: WorldCupSportDashboardProps) {
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("featured");
  const featuredMatches = useMemo(
    () => roundOf32Matches.filter((match) => match.featured || match.status === "live"),
    [],
  );
  const visibleMatches = useMemo(() => {
    if (matchFilter === "norway") return roundOf32Matches.filter((match) => match.norwayFocus);
    if (matchFilter === "featured") return featuredMatches;
    return roundOf32Matches;
  }, [featuredMatches, matchFilter]);
  const finishedCount = roundOf32Matches.filter((match) => match.status === "finished").length;
  const liveCount = roundOf32Matches.filter((match) => match.status === "live").length;
  const upcomingCount = roundOf32Matches.filter((match) => match.status === "upcoming").length;
  const nextNorwayMatch = roundOf32Matches.find(
    (match) => match.norwayFocus && match.status !== "finished",
  );

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

      <SportDataStatus now={now} />
      <TournamentPhaseStrip />

      <section className="sport-summary-grid" aria-label="VM-status">
        <article className="sport-summary-card sport-summary-card-norway">
          <span>Norge nå</span>
          <strong>{nextNorwayMatch ? formatKickoff(nextNorwayMatch.kickoff) : "Ikke satt"}</strong>
          <p>
            {nextNorwayMatch ? `${nextNorwayMatch.home} - ${nextNorwayMatch.away}` : "Avventer"}
          </p>
        </article>
        <article className="sport-summary-card">
          <span>Pågående</span>
          <strong>{liveCount}</strong>
          <p>Live-status krever kontroll mot FOX/FIFA før bruk.</p>
        </article>
        <article className="sport-summary-card">
          <span>Sluttspill</span>
          <strong>{finishedCount}/16</strong>
          <p>Ferdigspilte 32-delsfinaler i denne visningen.</p>
        </article>
        <article className="sport-summary-card">
          <span>Neste vindu</span>
          <strong>{upcomingCount}</strong>
          <p>Kamper med tidspunkt i snapshotet.</p>
        </article>
      </section>

      <NorwayPathPanel />

      <section className="sport-workspace">
        <section className="sport-panel sport-match-panel" aria-labelledby="sport-next-heading">
          <header className="sport-panel-heading">
            <div>
              <p className="label">Kampvindu</p>
              <h2 id="sport-next-heading">Neste kamper</h2>
            </div>
            <div className="sport-segmented" aria-label="Kampfilter">
              <button
                type="button"
                className={matchFilter === "featured" ? "selected" : ""}
                aria-pressed={matchFilter === "featured"}
                onClick={() => setMatchFilter("featured")}
              >
                Aktuelt
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
          <span>Resultat, neste steg og kontrollbehov</span>
        </header>
        <BracketStatusTable matches={roundOf32Matches} />
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
