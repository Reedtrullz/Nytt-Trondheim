import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fallbackWorldCupDashboard,
  type Article,
  type FootballTeamFocus,
  type WorldCupDashboardPayload,
  type WorldCupGroupTable,
  type WorldCupMatch,
  type WorldCupMatchStatus,
  type WorldCupSourceLink,
} from "@nytt/shared";
import { api } from "../api.js";
import { ArrowIcon } from "../components/Icons.js";
import { safeExternalUrl } from "../safeExternalUrl.js";

type MatchFilter = "featured" | "norway" | "all";

interface SportPageProps {
  initialArticles?: Article[];
}

interface WorldCupSportDashboardProps {
  worldCup?: WorldCupDashboardPayload;
  loadingWorldCup?: boolean;
  worldCupError?: string;
  articles?: Article[];
  loadingArticles?: boolean;
  articleError?: string;
  now?: Date;
}

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

function statusLabel(status: WorldCupMatchStatus): string {
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

function dataAgeHours(now: Date, generatedAt: string): number | undefined {
  const generatedDate = new Date(generatedAt);
  if (Number.isNaN(generatedDate.getTime()) || Number.isNaN(now.getTime())) return undefined;
  return Math.max(0, Math.round((now.getTime() - generatedDate.getTime()) / 36_000) / 100);
}

function worldCupDataUpdatedAt(worldCup: WorldCupDashboardPayload): string {
  return worldCup.dataUpdatedAt ?? worldCup.generatedAt;
}

function isFallbackStale(worldCup: WorldCupDashboardPayload, now: Date): boolean {
  if (worldCup.sourceMode !== "fallback") return false;
  const age = dataAgeHours(now, worldCupDataUpdatedAt(worldCup));
  return age === undefined || age >= 12;
}

function isOutdatedScheduledMatch(match: WorldCupMatch, now: Date): boolean {
  if (match.status === "finished") return false;
  const kickoffMs = Date.parse(match.kickoff ?? "");
  if (Number.isNaN(kickoffMs)) return false;
  return kickoffMs < now.getTime() - 2 * 60 * 60 * 1000;
}

function worldCupStatusLabel(worldCup: WorldCupDashboardPayload, now: Date): string {
  const age = dataAgeHours(now, worldCupDataUpdatedAt(worldCup));
  if (worldCup.sourceMode === "live") {
    if (age === undefined) return "Livefeed aktiv";
    if (age < 0.25) return "Livefeed oppdatert nå";
    if (age < 2) return "Livefeed nylig oppdatert";
    return "Livefeed bør oppdateres";
  }
  if (age === undefined) return "Kuratert fallback";
  if (age < 12) return "Kuratert fallback";
  return "Fallback bør kontrolleres";
}

function ExternalLink({ link }: { link: WorldCupSourceLink }) {
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

function articleSearchText(article: Article): string {
  return [
    article.title,
    article.excerpt,
    article.sourceLabel,
    ...(article.topics ?? []),
    ...(article.places ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function hasTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
  });
}

function isTeamArticle(team: FootballTeamFocus, article: Article): boolean {
  const text = articleSearchText(article);
  switch (team.id) {
    case "norway-men":
      return hasTerm(text, ["norge", "landslaget", "haaland", "håland", "odegaard", "ødegård"]);
    case "rosenborg-men":
      return (
        (article.topics?.includes("rosenborg") === true ||
          hasTerm(text, ["rbk", "rosenborg", "lerkendal"])) &&
        !isRosenborgWomenArticle(text)
      );
    case "rosenborg-women":
      return isRosenborgWomenArticle(text);
    case "ranheim-men":
      return hasTerm(text, ["ranheim"]);
  }
}

function isRosenborgWomenArticle(text: string): boolean {
  return hasTerm(text, ["rbk kvinner", "rosenborg kvinner", "toppserien", "kvinnelaget"]);
}

function teamArticleLink(team: FootballTeamFocus): string {
  const params = new URLSearchParams({ category: "Sport" });
  if (team.articleTopic) {
    params.set("topic", team.articleTopic);
  } else {
    params.set("q", team.articleQuery);
  }
  return `/?${params.toString()}`;
}

function SportSectionNav() {
  return (
    <nav className="sport-section-nav" aria-label="Sportseksjoner">
      <a href="#sport-local-teams">Lokale lag</a>
      <a href="#sport-today">I dag</a>
      <a href="#sport-matches">Kamper</a>
      <a href="#sport-bracket">Sluttspill</a>
      <a href="#sport-tables">Tabeller</a>
      <a href="#sport-sources">Kilder</a>
    </nav>
  );
}

function LocalTeamFocusPanel({
  teams,
  articles,
}: {
  teams: FootballTeamFocus[];
  articles: Article[];
}) {
  return (
    <section
      id="sport-local-teams"
      className="sport-panel sport-team-panel"
      aria-labelledby="sport-local-teams-heading"
    >
      <header className="sport-panel-heading">
        <div>
          <p className="label">Trondheim-fotball</p>
          <h2 id="sport-local-teams-heading">Lag å følge</h2>
        </div>
        <span>Lokale saker + VM-spor</span>
      </header>
      <div className="sport-team-grid">
        {teams.map((team) => {
          const matchingArticles = articles.filter((article) => isTeamArticle(team, article));
          const latestArticle = matchingArticles[0];
          return (
            <article
              key={team.id}
              className={`sport-team-card${team.featured ? " sport-team-card-featured" : ""}`}
            >
              <header>
                <span>{team.competition}</span>
                <strong>{team.shortLabel}</strong>
              </header>
              <h3>{team.label}</h3>
              <p className="sport-team-status">{team.status}</p>
              <p>{team.next}</p>
              <small>{team.detail}</small>
              <footer>
                <span>{team.region}</span>
                <span>
                  {matchingArticles.length > 0
                    ? `${matchingArticles.length} saker i Nytt`
                    : team.sourceLabel}
                </span>
              </footer>
              {latestArticle ? (
                <p className="sport-team-latest">
                  Siste: {latestArticle.title} ({formatArticleTime(latestArticle.publishedAt)})
                </p>
              ) : null}
              <Link to={teamArticleLink(team)}>
                Se saker
                <ArrowIcon />
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MatchCard({ match, now }: { match: WorldCupMatch; now: Date }) {
  const stale = isOutdatedScheduledMatch(match, now);
  const label = stale ? "Må sjekkes" : statusLabel(match.status);
  return (
    <article
      className={`sport-match sport-match-${match.status}${stale ? " sport-match-stale" : ""}`}
    >
      <header>
        <span className="sport-match-status">
          {match.stage} · {label}
        </span>
        <time dateTime={match.kickoff}>{formatKickoff(match.kickoff)}</time>
      </header>
      <div className="sport-match-line">
        <strong>{match.home}</strong>
        <span>{match.result ?? "–"}</span>
        <strong>{match.away}</strong>
      </div>
      {match.penaltyResult ? <p className="sport-match-penalty">{match.penaltyResult}</p> : null}
      {stale ? (
        <p className="sport-match-warning">
          Tidspunktet er passert i datagrunnlaget. Sjekk offisiell kilde før du bruker raden.
        </p>
      ) : null}
      <p>{match.note}</p>
      <p className="sport-match-consequence">{match.consequence}</p>
      <small>
        {match.venue} · {match.source}
      </small>
    </article>
  );
}

function SportDataStatus({
  worldCup,
  now,
  loading,
  error,
}: {
  worldCup: WorldCupDashboardPayload;
  now: Date;
  loading?: boolean;
  error?: string;
}) {
  const dataAge = dataAgeHours(now, worldCupDataUpdatedAt(worldCup));
  const checkedAge = dataAgeHours(now, worldCup.generatedAt);
  const dataAgeLabel =
    dataAge === undefined ? "Alder ukjent" : `${dataAge.toLocaleString("nb-NO")} t gammel`;
  const checkedAgeLabel =
    checkedAge === undefined ? "Alder ukjent" : `${checkedAge.toLocaleString("nb-NO")} t siden`;

  return (
    <section id="sport-sources" className="sport-data-status" aria-label="Datastatus">
      <article>
        <span>VM-kamper</span>
        <strong>{loading ? "Oppdaterer..." : worldCupStatusLabel(worldCup, now)}</strong>
        <p>
          {worldCup.sourceMode === "live"
            ? "Oppdateres automatisk fra livefeed."
            : "Viser kuratert fallback når livefeed ikke svarer."}
        </p>
      </article>
      <article>
        <span>Datasett</span>
        <strong>{formatKickoff(worldCupDataUpdatedAt(worldCup))}</strong>
        <p>{dataAgeLabel}.</p>
      </article>
      <article>
        <span>Kontrollert</span>
        <strong>{formatKickoff(worldCup.generatedAt)}</strong>
        <p>{checkedAgeLabel}.</p>
      </article>
      <article>
        <span>Kilde</span>
        <strong>{worldCup.sourceLabel}</strong>
        <p>{error ?? worldCup.sourceDetail}</p>
      </article>
    </section>
  );
}

function SportSourceNotice({ worldCup, now }: { worldCup: WorldCupDashboardPayload; now: Date }) {
  if (!isFallbackStale(worldCup, now)) return null;
  const sourceHref = safeExternalUrl(worldCup.sourceUrl);
  return (
    <section className="sport-source-notice" aria-label="VM-data må kontrolleres">
      <div>
        <strong>VM-data er fallback og må kontrolleres</strong>
        <p>
          Datasettet er fra {formatKickoff(worldCupDataUpdatedAt(worldCup))}. Nytt viser lokale
          sportssaker, men kampstatus og tidspunkt bør sjekkes hos offisiell kilde.
        </p>
      </div>
      {sourceHref ? (
        <a href={sourceHref} target="_blank" rel="noreferrer noopener">
          Sjekk kampoversikt
          <ArrowIcon />
        </a>
      ) : null}
    </section>
  );
}

function TournamentPhaseStrip({ phases }: { phases: WorldCupDashboardPayload["phases"] }) {
  return (
    <section id="sport-phases" className="sport-phase-strip" aria-label="Turneringsfase">
      {phases.map((phase) => (
        <article key={phase.id}>
          <span>{phase.label}</span>
          <strong>{phase.value}</strong>
          <p>{phase.note}</p>
        </article>
      ))}
    </section>
  );
}

function NorwayPathPanel({ path }: { path: WorldCupDashboardPayload["norwayPath"] }) {
  return (
    <section className="sport-panel sport-path-panel" aria-labelledby="sport-path-heading">
      <header className="sport-panel-heading">
        <div>
          <p className="label">Norge-sporet</p>
          <h2 id="sport-path-heading">Veien videre</h2>
        </div>
      </header>
      <div className="sport-path-list">
        {path.map((step) => (
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

function GroupTableCard({ table }: { table: WorldCupGroupTable }) {
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
  worldCup = fallbackWorldCupDashboard,
  loadingWorldCup = false,
  worldCupError,
  articles = [],
  loadingArticles = false,
  articleError,
  now = new Date(),
}: WorldCupSportDashboardProps) {
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("featured");
  const matches = worldCup.matches;
  const currentMatches = useMemo(
    () => matches.filter((match) => !isOutdatedScheduledMatch(match, now)),
    [matches, now],
  );
  const featuredMatches = useMemo(() => {
    const direct = currentMatches.filter((match) => match.featured || match.status === "live");
    return direct.length > 0 ? direct : currentMatches.slice(0, 3);
  }, [currentMatches]);
  const visibleMatches = useMemo(() => {
    if (matchFilter === "norway") return matches.filter((match) => match.norwayFocus);
    if (matchFilter === "featured") return featuredMatches;
    return matches;
  }, [featuredMatches, matchFilter, matches]);
  const finishedCount = matches.filter((match) => match.status === "finished").length;
  const liveCount = currentMatches.filter((match) => match.status === "live").length;
  const upcomingCount = currentMatches.filter((match) => match.status === "upcoming").length;
  const nextNorwayMatch = currentMatches.find(
    (match) => match.norwayFocus && match.status !== "finished",
  );
  const localTeams = worldCup.localTeams ?? fallbackWorldCupDashboard.localTeams;

  return (
    <main className="sport-page">
      <section className="sport-hero" aria-labelledby="sport-title">
        <div>
          <p className="label">Sport · Trondheim-fotball + VM 2026</p>
          <h1 id="sport-title">Fotballoversikt</h1>
          <p>
            Norge i VM, RBK herrer, RBK kvinner og Ranheim samlet først. Kampdata oppdateres når
            livefeeden er tilgjengelig, mens lokale klubbkort bygger på Nytt-saker.
          </p>
        </div>
        <div className="sport-hero-meta" aria-label="VM-kilder">
          <span>
            {worldCup.sourceMode === "live" ? "Live" : "Fallback"} · datasett{" "}
            {formatKickoff(worldCupDataUpdatedAt(worldCup))}
          </span>
          {worldCup.sourceLinks.map((link) => (
            <ExternalLink key={link.href} link={link} />
          ))}
        </div>
      </section>

      <SportSourceNotice worldCup={worldCup} now={now} />
      <SportSectionNav />
      <LocalTeamFocusPanel teams={localTeams} articles={articles} />

      <section id="sport-today" className="sport-summary-grid" aria-label="VM-status">
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
          <p>{worldCup.sourceMode === "live" ? "Direkte fra livefeed." : "Fra fallback-data."}</p>
        </article>
        <article className="sport-summary-card">
          <span>Sluttspill</span>
          <strong>
            {finishedCount}/{matches.length}
          </strong>
          <p>Ferdigspilte kamper i VM-visningen.</p>
        </article>
        <article className="sport-summary-card">
          <span>Neste vindu</span>
          <strong>{upcomingCount}</strong>
          <p>Kamper med tidspunkt i aktivt datasett.</p>
        </article>
      </section>

      <NorwayPathPanel path={worldCup.norwayPath} />

      <section className="sport-workspace">
        <section
          id="sport-matches"
          className="sport-panel sport-match-panel"
          aria-labelledby="sport-next-heading"
        >
          <header className="sport-panel-heading">
            <div>
              <p className="label">Kampvindu</p>
              <h2 id="sport-next-heading">Aktuelle VM-kamper</h2>
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
            {visibleMatches.length > 0 ? (
              visibleMatches.map((match) => <MatchCard key={match.id} match={match} now={now} />)
            ) : (
              <p className="sport-news-state">Ingen kamper i dette filteret akkurat nå.</p>
            )}
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

      <section
        id="sport-bracket"
        className="sport-bracket-panel"
        aria-labelledby="sport-bracket-heading"
      >
        <header className="sport-panel-heading">
          <div>
            <p className="label">Bracket</p>
            <h2 id="sport-bracket-heading">Sluttspillstatus</h2>
          </div>
          <span>Resultat, neste steg og kildeoppdatert status</span>
        </header>
        <BracketStatusTable matches={matches} />
      </section>

      <section id="sport-tables" className="sport-table-grid" aria-label="VM-tabeller">
        {worldCup.groups.map((table) => (
          <GroupTableCard key={table.id} table={table} />
        ))}
      </section>

      <TournamentPhaseStrip phases={worldCup.phases} />
      <SportDataStatus
        worldCup={worldCup}
        now={now}
        loading={loadingWorldCup}
        error={worldCupError}
      />
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
  const [worldCup, setWorldCup] = useState<WorldCupDashboardPayload>(fallbackWorldCupDashboard);
  const [loadingWorldCup, setLoadingWorldCup] = useState(true);
  const [worldCupError, setWorldCupError] = useState<string>();

  useEffect(() => {
    let ignore = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleRefresh(seconds: number) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => {
          void loadWorldCup();
        },
        Math.max(60, seconds) * 1000,
      );
    }

    async function loadWorldCup() {
      setLoadingWorldCup(true);
      try {
        const dashboard = await api.worldCupDashboard();
        if (ignore) return;
        setWorldCup(dashboard);
        setWorldCupError(undefined);
        scheduleRefresh(dashboard.nextRefreshSeconds);
      } catch (reason: unknown) {
        if (ignore) return;
        setWorldCupError(reason instanceof Error ? reason.message : "Kunne ikke hente VM-data.");
        scheduleRefresh(fallbackWorldCupDashboard.nextRefreshSeconds);
      } finally {
        if (!ignore) setLoadingWorldCup(false);
      }
    }

    void loadWorldCup();
    return () => {
      ignore = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoadingArticles(true);
    setArticleError(undefined);
    api
      .articles({ category: "Sport", scope: "trondelag", limit: 12 })
      .then((page) => {
        if (!ignore) setArticles(page.items.slice(0, 12));
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
      worldCup={worldCup}
      loadingWorldCup={loadingWorldCup}
      worldCupError={worldCupError}
    />
  );
}
