import {
  fallbackWorldCupDashboard,
  worldCupSourceLinks,
  type WorldCupDashboardPayload,
  type WorldCupGroupTable,
  type WorldCupMatch,
  type WorldCupMatchStatus,
  type WorldCupPhase,
  type WorldCupSourceMode,
} from "@nytt/shared";

const espnScoreboardUrl =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260628-20260719&limit=120";
const espnStandingsUrl =
  "https://site.web.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?region=us&lang=en&contentorigin=espn&type=0&level=3&sort=rank:asc";
const fetchTimeoutMs = 6_000;
const liveRefreshSeconds = 75;
const defaultRefreshSeconds = 300;
const cacheTtlMs = 120_000;
const fallbackCacheTtlMs = 45_000;

type FetchLike = typeof fetch;

interface CacheEntry {
  expiresAt: number;
  payload: WorldCupDashboardPayload;
}

interface NormalizedCompetitor {
  id: string;
  name: string;
  abbreviation?: string;
  homeAway?: string;
  score?: number;
  winner?: boolean;
}

let cachedDashboard: CacheEntry | undefined;

const teamNameMap = new Map<string, string>([
  ["Algeria", "Algerie"],
  ["Australia", "Australia"],
  ["Austria", "Østerrike"],
  ["Belgium", "Belgia"],
  ["Bosnia-Herzegovina", "Bosnia-Hercegovina"],
  ["Brazil", "Brasil"],
  ["Cape Verde Islands", "Kapp Verde"],
  ["Cape Verde", "Kapp Verde"],
  ["Colombia", "Colombia"],
  ["Congo DR", "DR Kongo"],
  ["Croatia", "Kroatia"],
  ["Curaçao", "Curaçao"],
  ["Ecuador", "Ecuador"],
  ["Egypt", "Egypt"],
  ["England", "England"],
  ["France", "Frankrike"],
  ["Germany", "Tyskland"],
  ["Ghana", "Ghana"],
  ["Ivory Coast", "Elfenbenskysten"],
  ["Japan", "Japan"],
  ["Mexico", "Mexico"],
  ["Morocco", "Marokko"],
  ["Netherlands", "Nederland"],
  ["Norway", "Norge"],
  ["Paraguay", "Paraguay"],
  ["Portugal", "Portugal"],
  ["Senegal", "Senegal"],
  ["South Africa", "Sør-Afrika"],
  ["Spain", "Spania"],
  ["Sweden", "Sverige"],
  ["Switzerland", "Sveits"],
  ["United States", "USA"],
]);

const stageLabels = new Map<string, string>([
  ["round-of-32", "32-delsfinale"],
  ["round of 32", "32-delsfinale"],
  ["round-of-16", "Åttedelsfinale"],
  ["round of 16", "Åttedelsfinale"],
  ["quarterfinals", "Kvartfinale"],
  ["quarterfinal", "Kvartfinale"],
  ["semifinals", "Semifinale"],
  ["semifinal", "Semifinale"],
  ["third-place", "Bronsefinale"],
  ["third place", "Bronsefinale"],
  ["final", "Finale"],
]);

export function clearWorldCupDashboardCache() {
  cachedDashboard = undefined;
}

export async function loadWorldCupDashboard(
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<WorldCupDashboardPayload> {
  const nowMs = now.getTime();
  if (cachedDashboard && cachedDashboard.expiresAt > nowMs) return cachedDashboard.payload;

  try {
    const [scoreboard, standings] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, espnScoreboardUrl),
      fetchJsonWithTimeout(fetchImpl, espnStandingsUrl),
    ]);
    const payload = normalizeWorldCupDashboard(scoreboard, standings, now);
    cachedDashboard = { payload, expiresAt: nowMs + cacheTtlMs };
    return payload;
  } catch (error) {
    const payload = fallbackDashboard(now, error);
    cachedDashboard = { payload, expiresAt: nowMs + fallbackCacheTtlMs };
    return payload;
  }
}

export function normalizeWorldCupDashboard(
  scoreboard: unknown,
  standings: unknown,
  generatedAt: Date,
): WorldCupDashboardPayload {
  const matches = normalizeMatches(scoreboard, generatedAt);
  if (matches.length === 0) throw new Error("ESPN World Cup scoreboard returned no matches");

  const groups = normalizeGroups(standings);
  const hasLiveMatch = matches.some((match) => match.status === "live");
  return {
    generatedAt: generatedAt.toISOString(),
    sourceMode: "live",
    sourceLabel: "ESPN livefeed",
    sourceUrl: espnScoreboardUrl,
    sourceDetail: "Kampstatus og tabeller normalisert fra ESPN uten råpayload i API-svaret.",
    nextRefreshSeconds: hasLiveMatch ? liveRefreshSeconds : defaultRefreshSeconds,
    sourceLinks: worldCupSourceLinks,
    phases: buildPhases(matches),
    norwayPath: buildNorwayPath(matches),
    groups: groups.length > 0 ? groups : fallbackWorldCupDashboard.groups,
    matches,
  };
}

function fallbackDashboard(now: Date, error: unknown): WorldCupDashboardPayload {
  return {
    ...fallbackWorldCupDashboard,
    generatedAt: now.toISOString(),
    sourceMode: "fallback" satisfies WorldCupSourceMode,
    sourceDetail: `Livefeed utilgjengelig: ${errorMessage(error)}. Viser kuratert fallback.`,
  };
}

async function fetchJsonWithTimeout(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "NyttTrondheim/1.0 (+https://nytt.reidar.tech)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ESPN svarte ${response.status}`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMatches(scoreboard: unknown, now: Date): WorldCupMatch[] {
  const events = arrayValue(recordValue(scoreboard)?.events);
  return events
    .map((event) => normalizeEvent(event, now))
    .filter((match): match is WorldCupMatch => match !== undefined)
    .sort((left, right) => {
      const leftMs = Date.parse(left.kickoff ?? "");
      const rightMs = Date.parse(right.kickoff ?? "");
      if (Number.isNaN(leftMs) && Number.isNaN(rightMs)) return left.id.localeCompare(right.id);
      if (Number.isNaN(leftMs)) return 1;
      if (Number.isNaN(rightMs)) return -1;
      return leftMs - rightMs;
    });
}

function normalizeEvent(eventValue: unknown, now: Date): WorldCupMatch | undefined {
  const event = recordValue(eventValue);
  if (!event) return undefined;
  const competition = firstRecord(event.competitions);
  if (!competition) return undefined;
  const competitors = arrayValue(competition.competitors)
    .map(normalizeCompetitor)
    .filter((competitor): competitor is NormalizedCompetitor => competitor !== undefined);
  if (competitors.length < 2) return undefined;

  const home = competitors.find((competitor) => competitor.homeAway === "home") ?? competitors[0];
  const away = competitors.find((competitor) => competitor.homeAway === "away") ?? competitors[1];
  if (!home || !away) return undefined;

  const status = statusFromEvent(event, competition);
  const kickoff = stringValue(event.date) ?? stringValue(competition.date);
  const statusType = recordValue(recordValue(competition.status)?.type);
  const statusDetail =
    stringValue(statusType?.shortDetail) ?? stringValue(statusType?.detail) ?? undefined;
  const result = status === "upcoming" ? undefined : resultLabel(home, away);
  const penaltyResult = statusDetail?.includes("Pens")
    ? penaltyResultLabel(competition, home, away)
    : undefined;
  const winner = competitors.find((competitor) => competitor.winner);
  const stage = stageFromEvent(event, competition);
  const norwayFocus = home.name === "Norge" || away.name === "Norge";
  const featured = isFeaturedMatch({ status, kickoff, norwayFocus, now });

  return {
    id: stringValue(event.id) ?? stableMatchId(home.name, away.name, kickoff),
    stage,
    home: home.name,
    away: away.name,
    status,
    ...(kickoff ? { kickoff } : {}),
    ...(result ? { result } : {}),
    ...(penaltyResult ? { penaltyResult } : {}),
    venue: venueLabel(event, competition),
    note: matchNote({ status, stage, home: home.name, away: away.name, winner, norwayFocus }),
    consequence: consequenceLabel({ status, stage, winner }),
    source: "ESPN",
    ...(featured ? { featured } : {}),
    ...(norwayFocus ? { norwayFocus } : {}),
  };
}

function normalizeCompetitor(value: unknown): NormalizedCompetitor | undefined {
  const competitor = recordValue(value);
  if (!competitor) return undefined;
  const team = recordValue(competitor.team);
  const displayName =
    stringValue(team?.displayName) ??
    stringValue(team?.shortDisplayName) ??
    stringValue(team?.name);
  if (!displayName) return undefined;
  const scoreValue = Number(stringValue(competitor.score));
  const abbreviation = stringValue(team?.abbreviation);
  const homeAway = stringValue(competitor.homeAway);
  const winner = booleanValue(competitor.winner);
  return {
    id: stringValue(competitor.id) ?? stringValue(team?.id) ?? displayName,
    name: norwegianTeamName(displayName),
    ...(abbreviation ? { abbreviation } : {}),
    ...(homeAway ? { homeAway } : {}),
    ...(Number.isFinite(scoreValue) ? { score: scoreValue } : {}),
    ...(winner !== undefined ? { winner } : {}),
  };
}

function normalizeGroups(standings: unknown): WorldCupGroupTable[] {
  const children = arrayValue(recordValue(standings)?.children);
  return children
    .map(normalizeGroup)
    .filter((group): group is WorldCupGroupTable => group !== undefined)
    .sort((left, right) => groupSortWeight(left) - groupSortWeight(right));
}

function normalizeGroup(groupValue: unknown): WorldCupGroupTable | undefined {
  const group = recordValue(groupValue);
  if (!group) return undefined;
  const entries = arrayValue(recordValue(group.standings)?.entries);
  const rows = entries
    .map(normalizeGroupRow)
    .filter((row): row is WorldCupGroupTable["rows"][number] => row !== undefined);
  if (rows.length === 0) return undefined;
  const name = stringValue(group.name) ?? stringValue(group.abbreviation) ?? "Gruppe";
  const title = groupTitle(name);
  return {
    id: slug(title),
    title,
    reason: groupReason(title, rows),
    rows,
  };
}

function normalizeGroupRow(entryValue: unknown): WorldCupGroupTable["rows"][number] | undefined {
  const entry = recordValue(entryValue);
  if (!entry) return undefined;
  const team = recordValue(entry.team);
  const name = stringValue(team?.displayName) ?? stringValue(team?.shortDisplayName);
  if (!name) return undefined;
  const stats = statMap(arrayValue(entry.stats));
  const goalsFor = numberStat(stats, "pointsFor");
  const goalsAgainst = numberStat(stats, "pointsAgainst");
  const goalDifference = numberStat(stats, "pointDifferential", goalsFor - goalsAgainst);
  return {
    team: norwegianTeamName(name),
    played: numberStat(stats, "gamesPlayed"),
    wins: numberStat(stats, "wins"),
    draws: numberStat(stats, "ties"),
    losses: numberStat(stats, "losses"),
    goalsFor,
    goalsAgainst,
    goalDifference,
    points: numberStat(stats, "points"),
    note: stringValue(recordValue(entry.note)?.description) ?? "",
  };
}

function statMap(stats: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of stats) {
    const stat = recordValue(value);
    const name = stringValue(stat?.name);
    if (!name) continue;
    const numeric =
      numberValue(stat?.value) ??
      numberValue(stat?.displayValue) ??
      numberValue(stat?.shortDisplayValue);
    if (numeric !== undefined) map.set(name, numeric);
  }
  return map;
}

function numberStat(stats: Map<string, number>, key: string, fallback = 0): number {
  return stats.get(key) ?? fallback;
}

function buildPhases(matches: WorldCupMatch[]): WorldCupPhase[] {
  const counts = (stage: string) => ({
    total: matches.filter((match) => match.stage === stage).length,
    finished: matches.filter((match) => match.stage === stage && match.status === "finished")
      .length,
    live: matches.filter((match) => match.stage === stage && match.status === "live").length,
  });
  const round32 = counts("32-delsfinale");
  const round16 = counts("Åttedelsfinale");
  const quarters = counts("Kvartfinale");
  const semis = counts("Semifinale");
  const finalMatch = counts("Finale");

  return [
    {
      id: "groups",
      label: "Gruppespill",
      value: "Ferdig",
      note: "12 grupper à fire lag.",
    },
    {
      id: "round-of-32",
      label: "32-delsfinaler",
      value: phaseValue(round32, "Pågår"),
      note: "Ekstra utslagsrunde i 48-lagsformatet.",
    },
    {
      id: "round-of-16",
      label: "Åttedelsfinaler",
      value: phaseValue(round16, "4.-7. juli"),
      note: "Norge-sporet oppdateres fra livefeeden.",
    },
    {
      id: "quarterfinals",
      label: "Kvartfinaler",
      value: phaseValue(quarters, "9.-11. juli"),
      note: "Vinnerne fra åttedelsfinalene møtes.",
    },
    {
      id: "semifinals",
      label: "Semifinaler",
      value: phaseValue(semis, "14.-15. juli"),
      note: "Siste runde før medaljekampene.",
    },
    {
      id: "final",
      label: "Finale",
      value: phaseValue(finalMatch, "19. juli"),
      note: "VM-finalen avslutter sluttspillet.",
    },
  ];
}

function phaseValue(counts: { total: number; finished: number; live: number }, fallback: string) {
  if (counts.total === 0) return fallback;
  if (counts.finished === counts.total) return "Ferdig";
  if (counts.live > 0 || counts.finished > 0) return "Pågår";
  return fallback;
}

function buildNorwayPath(matches: WorldCupMatch[]) {
  const norwayMatches = matches
    .filter((match) => match.norwayFocus)
    .sort((left, right) => Date.parse(left.kickoff ?? "") - Date.parse(right.kickoff ?? ""));
  if (norwayMatches.length === 0) return fallbackWorldCupDashboard.norwayPath;

  const previous = [...norwayMatches].reverse().find((match) => match.status === "finished");
  const next = norwayMatches.find((match) => match.status !== "finished");
  const steps = [];
  if (previous) {
    steps.push({
      label: "Forrige",
      title: `${previous.home} ${previous.result ?? "-"} ${previous.away}`,
      note: previous.note,
    });
  }
  if (next) {
    steps.push({
      label: "Neste",
      title: `${next.home} - ${next.away}`,
      note: `${next.stage}. ${next.venue}.`,
    });
    steps.push({
      label: "Mulig etterpå",
      title: next.stage === "Åttedelsfinale" ? "Kvartfinale-sporet" : "Neste sluttspillrunde",
      note: next.consequence,
    });
  }
  return steps.length > 0 ? steps : fallbackWorldCupDashboard.norwayPath;
}

function statusFromEvent(
  event: Record<string, unknown>,
  competition: Record<string, unknown>,
): WorldCupMatchStatus {
  const type =
    recordValue(recordValue(competition.status)?.type) ??
    recordValue(recordValue(event.status)?.type);
  if (booleanValue(type?.completed)) return "finished";
  if (stringValue(type?.state) === "in") return "live";
  return "upcoming";
}

function stageFromEvent(event: Record<string, unknown>, competition: Record<string, unknown>) {
  const candidates = [
    stringValue(recordValue(event.season)?.slug),
    stringValue(competition.altGameNote),
    stringValue(event.name),
  ].filter((value): value is string => value !== undefined);
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    for (const [needle, label] of stageLabels) {
      if (normalized.includes(needle)) return label;
    }
  }
  return "Sluttspill";
}

function venueLabel(event: Record<string, unknown>, competition: Record<string, unknown>) {
  const venue = recordValue(competition.venue) ?? recordValue(event.venue);
  const name =
    stringValue(venue?.fullName) ?? stringValue(venue?.displayName) ?? "Arena ikke oppgitt";
  const city = stringValue(recordValue(venue?.address)?.city);
  return city && !name.includes(city) ? `${name}, ${city}` : name;
}

function resultLabel(home: NormalizedCompetitor, away: NormalizedCompetitor) {
  if (home.score === undefined || away.score === undefined) return undefined;
  return `${home.score}-${away.score}`;
}

function penaltyResultLabel(
  competition: Record<string, unknown>,
  home: NormalizedCompetitor,
  away: NormalizedCompetitor,
) {
  const scores = new Map<string, number>([
    [home.id, 0],
    [away.id, 0],
  ]);
  for (const detail of arrayValue(competition.details)) {
    const record = recordValue(detail);
    if (!record || !booleanValue(record.shootout) || !booleanValue(record.scoringPlay)) continue;
    const teamId = stringValue(recordValue(record.team)?.id);
    if (!teamId || !scores.has(teamId)) continue;
    scores.set(teamId, (scores.get(teamId) ?? 0) + 1);
  }
  const homePens = scores.get(home.id) ?? 0;
  const awayPens = scores.get(away.id) ?? 0;
  return homePens > 0 || awayPens > 0 ? `${homePens}-${awayPens} str.` : undefined;
}

function matchNote(input: {
  status: WorldCupMatchStatus;
  stage: string;
  home: string;
  away: string;
  winner?: NormalizedCompetitor;
  norwayFocus: boolean;
}) {
  if (input.status === "finished") {
    if (input.norwayFocus && input.winner?.name === "Norge") {
      return "Norge videre i VM-sluttspillet.";
    }
    return input.winner ? `${input.winner.name} videre.` : `${input.stage} ferdigspilt.`;
  }
  if (input.status === "live") return `Livekamp i ${input.stage.toLowerCase()}.`;
  if (input.norwayFocus) return "Neste Norge-kamp i sluttspillet.";
  return `${input.home} mot ${input.away} i ${input.stage.toLowerCase()}.`;
}

function consequenceLabel(input: {
  status: WorldCupMatchStatus;
  stage: string;
  winner?: NormalizedCompetitor;
}) {
  if (input.status === "finished") {
    return input.winner ? `${input.winner.name} gikk videre.` : "Resultatet er registrert.";
  }
  if (input.stage === "32-delsfinale") return "Vinneren går til åttedelsfinale.";
  if (input.stage === "Åttedelsfinale") return "Vinneren går til kvartfinale.";
  if (input.stage === "Kvartfinale") return "Vinneren går til semifinale.";
  if (input.stage === "Semifinale") return "Vinneren går til finalen.";
  if (input.stage === "Finale") return "Vinneren blir verdensmester.";
  return "Vinneren går videre i sluttspillet.";
}

function isFeaturedMatch(input: {
  status: WorldCupMatchStatus;
  kickoff?: string;
  norwayFocus: boolean;
  now: Date;
}) {
  if (input.norwayFocus || input.status === "live") return true;
  const kickoffMs = Date.parse(input.kickoff ?? "");
  if (Number.isNaN(kickoffMs)) return false;
  const diffHours = (kickoffMs - input.now.getTime()) / 3_600_000;
  if (input.status === "finished") return diffHours >= -18 && diffHours <= 0;
  return diffHours >= 0 && diffHours <= 48;
}

function groupTitle(value: string) {
  const groupMatch = value.match(/group\s+([a-l])/i);
  if (groupMatch?.[1]) return `Gruppe ${groupMatch[1].toUpperCase()}`;
  return value.replace(/^Group\b/i, "Gruppe");
}

function groupReason(title: string, rows: WorldCupGroupTable["rows"]) {
  if (rows.some((row) => row.team === "Norge")) return "Norge-gruppa";
  if (title === "Gruppe E") return "Motstander-sporet";
  return "Gruppespill";
}

function groupSortWeight(table: WorldCupGroupTable) {
  if (table.rows.some((row) => row.team === "Norge")) return 0;
  if (table.title === "Gruppe E") return 1;
  const letter = table.title.match(/Gruppe ([A-L])/)?.[1];
  return letter ? letter.charCodeAt(0) : 99;
}

function norwegianTeamName(value: string) {
  return teamNameMap.get(value) ?? value;
}

function stableMatchId(home: string, away: string, kickoff?: string) {
  return slug(`${home}-${away}-${kickoff ?? "unknown"}`);
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return arrayValue(value)
    .map(recordValue)
    .find((record) => record !== undefined);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "ukjent feil";
}
