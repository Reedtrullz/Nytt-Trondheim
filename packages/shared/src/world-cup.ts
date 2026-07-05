export type WorldCupMatchStatus = "finished" | "live" | "upcoming";
export type WorldCupSourceMode = "live" | "fallback";

export interface WorldCupSourceLink {
  label: string;
  href: string;
}

export type FootballTeamFocusId =
  | "norway-men"
  | "rosenborg-men"
  | "rosenborg-women"
  | "ranheim-men";

export interface FootballTeamFocus {
  id: FootballTeamFocusId;
  label: string;
  shortLabel: string;
  competition: string;
  region: string;
  status: string;
  next: string;
  detail: string;
  sourceLabel: string;
  sourceUrl: string;
  articleQuery: string;
  articleTopic?: string;
  featured?: boolean;
}

export interface WorldCupPhase {
  id: string;
  label: string;
  value: string;
  note: string;
}

export interface WorldCupPathStep {
  label: string;
  title: string;
  note: string;
}

export interface WorldCupGroupRow {
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

export interface WorldCupGroupTable {
  id: string;
  title: string;
  reason: string;
  rows: WorldCupGroupRow[];
}

export interface WorldCupMatch {
  id: string;
  stage: string;
  home: string;
  away: string;
  status: WorldCupMatchStatus;
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

export interface WorldCupDashboardPayload {
  generatedAt: string;
  dataUpdatedAt: string;
  sourceMode: WorldCupSourceMode;
  sourceLabel: string;
  sourceUrl: string;
  sourceDetail: string;
  nextRefreshSeconds: number;
  sourceLinks: WorldCupSourceLink[];
  localTeams: FootballTeamFocus[];
  phases: WorldCupPhase[];
  norwayPath: WorldCupPathStep[];
  groups: WorldCupGroupTable[];
  matches: WorldCupMatch[];
}

export const worldCupSourceLinks: WorldCupSourceLink[] = [
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

export const fallbackWorldCupSnapshotUpdatedAt = "2026-07-01T10:30:00.000Z";

export const footballTeamFocus: FootballTeamFocus[] = [
  {
    id: "norway-men",
    label: "Norge menn",
    shortLabel: "Norge",
    competition: "VM 2026",
    region: "Landslaget",
    status: "VM-sluttspill",
    next: "Brasil - Norge",
    detail: "Norge-sporet oppdateres fra VM-data når livefeeden svarer.",
    sourceLabel: "FIFA/ESPN",
    sourceUrl: worldCupSourceLinks[1]?.href ?? "https://www.fifa.com/",
    articleQuery: "Norge landslaget VM",
    featured: true,
  },
  {
    id: "rosenborg-men",
    label: "RBK herrer",
    shortLabel: "RBK",
    competition: "Eliteserien",
    region: "Lerkendal",
    status: "Lokal hovedprioritet",
    next: "Følg kamp, trener og overgangssaker",
    detail: "Nytt bruker lokale sportssaker som kilde inntil terminliste/API er koblet på.",
    sourceLabel: "Nytt lokale saker",
    sourceUrl: "https://nytt.reidar.tech/?category=Sport&topic=rosenborg",
    articleQuery: "RBK Rosenborg",
    articleTopic: "rosenborg",
    featured: true,
  },
  {
    id: "rosenborg-women",
    label: "RBK kvinner",
    shortLabel: "RBK K",
    competition: "Toppserien",
    region: "Koteng/Lerkendal",
    status: "Egen lokal fotballstrøm",
    next: "Se etter Toppserien og RBK kvinner",
    detail: "Skill kvinnelaget tydelig når artiklene nevner RBK kvinner eller Toppserien.",
    sourceLabel: "Nytt lokale saker",
    sourceUrl: "https://nytt.reidar.tech/?category=Sport&q=RBK%20kvinner",
    articleQuery: "RBK kvinner Toppserien",
  },
  {
    id: "ranheim-men",
    label: "Ranheim herrer",
    shortLabel: "Ranheim",
    competition: "1. divisjon",
    region: "Ranheim",
    status: "Lokalt kamp- og tabellfokus",
    next: "Følg resultater og kampreaksjoner",
    detail: "Ranheim prioriteres som egen lokal klubb selv uten autoritativ terminliste i v1.",
    sourceLabel: "Nytt lokale saker",
    sourceUrl: "https://nytt.reidar.tech/?category=Sport&q=Ranheim",
    articleQuery: "Ranheim fotball",
  },
];

export const fallbackWorldCupDashboard: WorldCupDashboardPayload = {
  generatedAt: fallbackWorldCupSnapshotUpdatedAt,
  dataUpdatedAt: fallbackWorldCupSnapshotUpdatedAt,
  sourceMode: "fallback",
  sourceLabel: "Kuratert VM-snapshot",
  sourceUrl: worldCupSourceLinks[1]?.href ?? "https://www.fifa.com/",
  sourceDetail: "Kuratert fallback når livefeeden ikke svarer.",
  nextRefreshSeconds: 300,
  sourceLinks: worldCupSourceLinks,
  localTeams: footballTeamFocus,
  phases: [
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
      value: "4.-7. juli",
      note: "Norge møter Brasil 5. juli.",
    },
    {
      id: "final",
      label: "Finale",
      value: "19. juli",
      note: "Åtte kamper kreves for mesteren.",
    },
  ],
  norwayPath: [
    {
      label: "Forrige",
      title: "Elfenbenskysten 1-2 Norge",
      note: "Norge videre fra 32-delsfinalen.",
    },
    {
      label: "Neste",
      title: "Brasil - Norge",
      note: "Åttedelsfinale i New York/New Jersey.",
    },
    {
      label: "Mulig etterpå",
      title: "Kvartfinale-sporet",
      note: "Vinneren går inn mot kamp 92-vinneren.",
    },
  ],
  groups: [
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
  ],
  matches: [
    {
      id: "canada-south-africa",
      stage: "32-delsfinale",
      home: "Canada",
      away: "Sør-Afrika",
      status: "finished",
      result: "1-0",
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
      result: "2-1",
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
      result: "1-1",
      penaltyResult: "4-3 str.",
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
      result: "1-1",
      penaltyResult: "3-2 str.",
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
      result: "1-2",
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
  ],
};
