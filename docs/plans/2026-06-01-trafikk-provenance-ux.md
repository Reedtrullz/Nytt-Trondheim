# Trafikk Provenance UX Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rework `/trafikk` into a provenance-first traffic page with a top “Nå i trafikken” summary, a cleaner map-first workspace, a ranked active event list, and an incident detail drawer.

**Architecture:** Keep the existing ingestion architecture intact: `worker` keeps collecting official/telemetry feeds, `server` keeps composing authenticated API payloads, and `frontend` turns those payloads into a ranked, layered traffic workspace. Add only one small API-safe enrichment for related article estimated locations; all other changes are frontend view-model, presentation, and map-layer refactors over existing `TrafficMapPayload` and `PublicTransportMapPayload`. DATEX TravelTime, road weather, CCTV, counters, Entur vehicles, and weather/risk context remain telemetry/context and must not create source items, official events, or situations.

**Tech Stack:** TypeScript, Node 22 via nvm, React/Vite, React Router, Leaflet/react-leaflet, Express, PostgreSQL/PostGIS, Vitest, Playwright, existing Nytt shared contracts.

---

## User requirements captured

The page should answer, in order:

1. Is something serious happening now?
2. Where is it?
3. How does it affect movement?
4. How trustworthy/fresh is the information?
5. What should I monitor or do next?

Required UI shape:

- Top zone: 3-5 “Nå i trafikken” cards only: critical incidents, delays now, roadworks, public transport impact, updated/source freshness.
- Middle zone: map-first workspace with explicit layer controls: incidents, roadworks, travel-time corridors, public transport disruptions, weather/risk overlays, estimated/news-derived locations, and private notes/drawings only if relevant.
- Bottom/side zone: ranked event list, not a raw feed. Ranking should prefer active/high-impact, visible/nearby, fresh, official/confident, and major corridors/public transport impact.
- Detail drawer: click a row or map object to see what happened, where, source, updated time, confidence, evidence role, related articles/messages, official vs estimated location, active/resolved state, and matching traffic-pulse context.
- Progressive disclosure: default to high-impact active incidents and main delay corridors; “Vis alle” reveals minor/resolved/stale items; advanced filters are collapsed; raw source/evidence detail lives in the drawer.
- Provenance should be visible through badges: `OFFISIELL`, `ESTIMERT`, `REISETID`, `VARSELKONTEKST`, `KOLLEKTIV`, `NYHETSKILDE`.
- Map should use semantic objects instead of identical pins: road/line segments for official road events, warning markers for incidents, dashed estimated markers for news-derived locations, weather/risk context styling, and de-emphasized historical/resolved items.

## Current codebase findings

Docs read before writing this plan:

- `docs/ARCHITECTURE.md`
- `docs/SOURCES.md`
- `docs/plans/2026-05-29-traffic-map-great.md`
- `docs/plans/2026-05-31-entur-public-transport-situation-map-tools.md`
- `docs/plans/2026-05-28-datex-travel-time-traffic-pulse.md`
- `writing-plans/references/external-feed-ingestion-plan-checklist.md`
- `writing-plans/references/source-item-ledger-feed-ingestion-notes.md`
- `writing-plans/references/external-feed-map-plan-review-blockers.md`
- `subagent-driven-development/references/traffic-map-implementation-audit.md`

Relevant current runtime:

```text
frontend
  apps/frontend/src/App.tsx
    -> /trafikk route -> TrafficMapPage
  apps/frontend/src/pages/TrafficMapPage.tsx
    -> useTrafficMap() -> GET /api/map/traffic-events
    -> usePublicTransportMap() -> GET /api/map/public-transport only when public-transport layer is enabled
    -> TrafficFilterPanel / TrafficLayer / RoadContextLayer / PublicTransportLayer
    -> TrafficBriefCard / TrafficEventList / CorridorImpactCard / route planner

server
  apps/server/src/app.ts
    -> GET /api/map/traffic-events
      -> store.listTrafficMapEvents(source=vegvesen_traffic_info)
      -> store.listOfficialEvents(source=datex)
      -> relatedTrafficArticlesForEvent()
      -> buildTrafficBrief(events)
      -> buildCorridorImpacts(events, trafficPulse)
      -> trafficMapSourceStatuses(sourceHealth)
      -> road weather/camera/counter context
    -> GET /api/map/public-transport
      -> public transport vehicles + service alerts + Entur source health

shared
  packages/shared/src/traffic-map.ts
    -> TrafficMapEvent, RelatedTrafficArticle, TrafficBrief, TrafficCorridorImpact, TrafficMapPayload
  packages/shared/src/public-transport.ts
    -> PublicTransportVehicle, PublicTransportServiceAlert, PublicTransportMapPayload
```

Important existing boundaries from architecture docs:

- DATEX Situation and Vegvesen TrafficInfo can produce official map events; high-impact DATEX may promote official situations through existing rules only.
- DATEX TravelTime is traffic pulse only. It stays in `datex_travel_times` and must not infer accident/closure causes or create official events/source items/situations.
- DATEX Weather, DATEX CCTV, Trafikkdata counters, and Entur vehicles are operations-only telemetry/context.
- Entur service alerts are ledger-worthy official public-transport notices, but they are not automatic situation activators in this release.
- News/article locations are reporting estimates and must be marked as estimated, never official operational truth.
- Private annotations belong to Situation Room workspaces; `/trafikk` must not invent a public-private evidence mix without an explicit future workspace feature.

## Scope

In scope for this plan:

- `/trafikk` information architecture and visual hierarchy.
- Client-side summary/ranking/provenance view-model over existing traffic/public-transport payloads.
- A small API-safe enrichment so related article estimated locations can be displayed as `ESTIMERT` when the layer is enabled.
- Layer controls with sensible defaults and collapsed advanced filters.
- Semantic map styling and a visible legend.
- Detail drawer and ranked event list.
- Mobile bottom-sheet layout.
- Tests/gates proving TravelTime/weather/vehicles remain context, not incidents.

Out of scope for this plan:

- New external feed ingestion.
- Push/email/Telegram/Discord alerts.
- Saved home/work/school locations and watched corridors/bus lines.
- Historical delay baselines.
- Alternative-route/mode recommendations beyond the existing route-planner card.
- Private notes/drawings on `/trafikk`; keep the layer entry disabled/help-text only unless a future owner traffic workspace is explicitly designed.
- Changing DATEX/Entur promotion rules.

## Semantic layer defaults

Default visible layers:

```ts
const defaultTrafficLayers = {
  incidents: true,
  roadworks: true,
  travelTime: true,
  publicTransportDisruptions: true,
  publicTransportVehicles: false,
  weatherRisk: false,
  estimatedNews: false,
  privateNotes: false,
  showAll: false,
} satisfies TrafficLayerVisibility;
```

Default query/filter behavior:

- API query should still request active/planned official road events so the page can count roadworks and incidents.
- The frontend view model hides low-impact/stale/minor rows unless `showAll=true`.
- Public transport should fetch service alerts by default, but vehicles only when `publicTransportVehicles=true`.
- Weather/risk remains an optional context layer; do not show it as an incident card unless a real traffic event also exists.
- Estimated/news locations are off by default and dashed when enabled.

## Architecture and safety audit

Runtime heartbeat chain touched by this plan:

```text
TrafficMapPage render
  -> useTrafficMap / fetchTrafficMap
    -> GET /api/map/traffic-events
      -> traffic_map_events + DATEX official_events + datex_travel_times + source_health
  -> usePublicTransportMap / fetchPublicTransportMap
    -> GET /api/map/public-transport
      -> public_transport_vehicles + public_transport_service_alerts + source_health
  -> frontend traffic view-model helpers
  -> semantic map/list/drawer components
```

Risky changes and explicit defenses:

- Related article location enrichment touches API payload shape. It is optional and API-safe; it exposes only `lat`, `lng`, and `label` already present in `Article.location`, not raw source payloads.
- Ranking and summary helpers must not count TravelTime, weather, counters, CCTV, or Entur vehicles as incidents. Tests must include negative cases.
- Public transport service alerts can appear as `KOLLEKTIV` disruptions, but tests must not imply situation activation or road-incident confirmation.
- `TrafficLayer` must preserve strict GeoJSON guards: do not read `coordinates[0]`/`[1]` without checking both are finite numbers.
- Segment-aware geospatial behavior already exists server-side; frontend estimated-point rendering must not replace server proximity with vertex-only claims.
- React request hooks must keep unmount invalidation; if `usePublicTransportMap` fetch behavior changes, retain `requestIdRef`/abort guards.
- Complex TSX edits should use full-file rewrites rather than fuzzy patches to avoid syntax corruption.

## Plan review history

- Initial self-review against current code: completed. Existing project is React/Vite, not Next.js. Existing traffic page already has route planner, source freshness, road context, public transport layer, and corridor impacts; this plan refactors those into the requested hierarchy instead of adding duplicate feeds.
- External feed checklist applied: this is mostly UI/view-model work. The only API enrichment preserves feed boundaries and does not add ingestion, ledger rows, official events, or situations.
- Source-item ledger checklist applied: TravelTime, weather, CCTV, counters, and Entur vehicles remain operations-only/context-only. Entur service alerts remain official transit notices, not situation activators.
- Map blocker checklist applied: estimated article coordinates are explicitly dashed/estimated; unlocated alerts remain off-map; public transport vehicles are not evidence; GeoJSON helpers must guard tuple indexes.
- Reviewer pass 1: REQUEST_CHANGES. Blockers found: component API tasks would fail typecheck before page wiring; shared contract rebuild was missing; default query/show-all semantics did not fetch planned/expired rows; semantic layer toggles were not wired to map filtering; public-transport vehicles could leak into default alerts-only display; existing e2e tests needed updates; source-health/degraded copy and type unions needed tightening.
- Patch pass after review 1: tasks were updated to make cross-component API changes PARENT-DIRECT or page-wired in the same task, add shared rebuild/typecheck gates, broaden default/show-all query states, add explicit layer-filtered event arrays, filter public-transport vehicles out unless enabled, update existing Playwright traffic tests, copy article locations field-by-field, add strict official point guards, include degraded source details, and record these blockers for re-review.
- Reviewer pass 2: REQUEST_CHANGES. Blockers found: local-time formatters with `Z` fixtures produced CEST/UTC mismatches; `compactTrafficEventRow()` returned `detail` while ranked rows required `meta`. Important issues found: view-model memo dependency used raw public-transport data instead of display-filtered data; map visibility did not reuse default progressive-disclosure filtering; `showAll` query semantics for non-now presets were ambiguous; `ESTIMERT` was not emitted as a visible badge for estimated article locations.
- Patch pass after review 2: time formatting was made deterministic with `timeZone: "Europe/Oslo"` and fixtures were shifted to UTC values that display as local Trondheim examples; compact row helpers now return `meta`; `visibleByDefault` is exported and reused for map filtering; `showAll` broadens states for every preset while preserving date windows; public-transport memo dependencies use display-filtered data; estimated article locations add both `ESTIMERT` and `NYHETSKILDE`; temporary page-wiring imports are explicit.
- Reviewer pass 3: APPROVED. No critical blockers remained. Non-blocking notes to watch during implementation: default progressive-disclosure threshold may need tightening, planned-preset wording/filtering should be checked, source freshness should not hide degraded details, private notes must remain disabled, and client-side vehicle filtering is intentionally documented as a safe-but-inefficient first pass.

---

### Task 1: Add estimated related-article locations to the traffic API payload

**Objective:** Let `/trafikk` optionally render news-derived estimated locations without treating them as official traffic coordinates.

**Files:**

- Modify: `packages/shared/src/traffic-map.ts:17-22`
- Modify: `apps/server/src/traffic/related-articles.ts:165-174`
- Test: `apps/server/test/traffic-related-articles.test.ts`

**Step 1: Write failing test**

Add this assertion to the first test in `apps/server/test/traffic-related-articles.test.ts`:

```ts
expect(related[0]).toMatchObject({
  id: "article-1",
  title: "Kø på E6 ved Tiller",
  url: "https://example.test/articles/1",
  location: { lat: 63.406, lng: 10.4, label: "Tiller" },
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/traffic-related-articles.test.ts
```

Expected: FAIL because `RelatedTrafficArticle` currently omits `location`.

**Step 3: Add optional shared type**

In `packages/shared/src/traffic-map.ts`, change `RelatedTrafficArticle` to:

```ts
export interface RelatedTrafficArticle {
  id: string;
  title: string;
  url: string;
  distanceMeters: number;
  location?: {
    lat: number;
    lng: number;
    label: string;
  };
}
```

**Step 4: Preserve the article location in the mapper**

In `apps/server/src/traffic/related-articles.ts`, change `relatedTrafficArticlesForEvent()` to copy only the API-safe normalized location fields:

```ts
export function relatedTrafficArticlesForEvent(
  event: TrafficMapEvent,
  articles: Article[],
): RelatedTrafficArticle[] {
  return findRelatedTrafficArticles(event, articles).map((match) => {
    const location = match.article.location;
    return {
      id: match.article.id,
      title: match.article.title,
      url: match.article.url,
      distanceMeters: Math.round(match.distance),
      ...(location
        ? { location: { lat: location.lat, lng: location.lng, label: location.label } }
        : {}),
    };
  });
}
```

Do not copy any raw article/source payload fields into `RelatedTrafficArticle`.

**Step 5: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/server/test/traffic-related-articles.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build -w @nytt/shared
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/server
```

Expected: PASS. The shared build is mandatory because workspace consumers import `@nytt/shared` through package exports/dist declarations.

**Step 6: Commit**

```bash
git add packages/shared/src/traffic-map.ts apps/server/src/traffic/related-articles.ts apps/server/test/traffic-related-articles.test.ts
git commit -m "feat: expose estimated related traffic article locations"
```

---

### Task 2: Add provenance badge helper tests

**Objective:** Define the user-facing trust/provenance labels before rendering badges in cards, list rows, map popups and the drawer.

**Files:**

- Create: `apps/frontend/src/trafficProvenance.test.ts`
- Modify later: `apps/frontend/src/trafficProvenance.ts`

**Step 1: Write failing tests**

Create `apps/frontend/src/trafficProvenance.test.ts`:

```ts
import type { PublicTransportServiceAlert, PublicTransportVehicle } from "@nytt/shared";
import type { TrafficMapEvent, TrafficCorridorImpact } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import {
  badgeForPublicTransportAlert,
  badgeForPublicTransportVehicle,
  badgesForTrafficEvent,
  badgeForTrafficPulse,
  sourceDisplayLabel,
} from "./trafficProvenance.js";

const event: TrafficMapEvent = {
  id: "vegvesen-traffic-info:1",
  source: "vegvesen_traffic_info",
  sourceEventId: "1",
  category: "closure",
  severity: "critical",
  state: "active",
  title: "E6 stengt ved Sluppen",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  confidence: 0.98,
};

const pulse: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 sør inn mot Trondheim",
  eventCount: 0,
  affectedEventIds: [],
  highestSeverity: "low",
  travelTime: {
    id: "100141",
    name: "E6 Okstadbakken - E6 Sluppenrampene",
    state: "slow",
    travelTimeSeconds: 1020,
    freeFlowSeconds: 540,
    delaySeconds: 480,
    delayRatio: 1.88,
    updatedAt: "2026-06-01T16:40:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

const alert: PublicTransportServiceAlert = {
  id: "entur-service-alert:ATB:line3",
  source: "entur_service_alerts",
  codespaceId: "ATB",
  situationNumber: "line3",
  summary: "Forsinkelse på linje 3",
  updatedAt: "2026-06-01T16:40:00.000Z",
  state: "active",
};

const vehicle: PublicTransportVehicle = {
  id: "entur-vehicle:ATB:bus1",
  source: "entur_vehicle_positions",
  codespaceId: "ATB",
  vehicleId: "bus1",
  mode: "bus",
  lastUpdated: "2026-06-01T16:40:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  stale: false,
};

describe("traffic provenance labels", () => {
  it("labels official road events as official, not estimated", () => {
    expect(badgesForTrafficEvent(event)).toEqual(["OFFISIELL"]);
    expect(sourceDisplayLabel(event.source)).toBe("Statens vegvesen TrafficInfo");
  });

  it("adds ESTIMERT and NYHETSKILDE when related estimated article locations exist", () => {
    expect(
      badgesForTrafficEvent({
        ...event,
        relatedArticles: [
          {
            id: "article-1",
            title: "Kø ved Sluppen",
            url: "https://example.test/article",
            distanceMeters: 80,
            location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
          },
        ],
      }),
    ).toEqual(["OFFISIELL", "ESTIMERT", "NYHETSKILDE"]);
  });

  it("labels traffic pulse, public transport alerts and vehicles distinctly", () => {
    expect(badgeForTrafficPulse(pulse)).toBe("REISETID");
    expect(badgeForPublicTransportAlert(alert)).toBe("KOLLEKTIV");
    expect(badgeForPublicTransportVehicle(vehicle)).toBe("KOLLEKTIV");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficProvenance.test.ts
```

Expected: FAIL because `trafficProvenance.ts` does not exist.

**Step 3: Commit?**

Do not commit red-only unless needed. Task 3 commits tests and implementation together after GREEN.

---

### Task 3: Implement provenance badge helpers

**Objective:** Centralize trust labels so every surface uses the same source/provenance vocabulary.

**Files:**

- Create: `apps/frontend/src/trafficProvenance.ts`
- Test: `apps/frontend/src/trafficProvenance.test.ts`

**Step 1: Implement helper**

Create `apps/frontend/src/trafficProvenance.ts`:

```ts
import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  TrafficCorridorImpact,
  TrafficMapEvent,
} from "@nytt/shared";

export type TrafficTrustBadge =
  | "OFFISIELL"
  | "ESTIMERT"
  | "REISETID"
  | "VARSELKONTEKST"
  | "KOLLEKTIV"
  | "NYHETSKILDE";

export function sourceDisplayLabel(source: TrafficMapEvent["source"]): string {
  switch (source) {
    case "vegvesen_traffic_info":
      return "Statens vegvesen TrafficInfo";
    case "datex":
      return "Statens vegvesen DATEX Situation";
    default:
      return source;
  }
}

export function badgesForTrafficEvent(event: TrafficMapEvent): TrafficTrustBadge[] {
  const badges: TrafficTrustBadge[] = ["OFFISIELL"];
  if (event.relatedArticles?.some((article) => article.location)) {
    badges.push("ESTIMERT", "NYHETSKILDE");
  }
  return badges;
}

export function badgeForTrafficPulse(impact: TrafficCorridorImpact): TrafficTrustBadge | undefined {
  return impact.travelTime ? "REISETID" : undefined;
}

export function badgeForWeatherContext(): TrafficTrustBadge {
  return "VARSELKONTEKST";
}

export function badgeForPublicTransportAlert(
  _alert: PublicTransportServiceAlert,
): TrafficTrustBadge {
  return "KOLLEKTIV";
}

export function badgeForPublicTransportVehicle(
  _vehicle: PublicTransportVehicle,
): TrafficTrustBadge {
  return "KOLLEKTIV";
}
```

**Step 2: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficProvenance.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/frontend/src/trafficProvenance.ts apps/frontend/src/trafficProvenance.test.ts
git commit -m "feat: add traffic provenance badge helpers"
```

---

### Task 4: Add traffic view-model tests for summary cards and progressive disclosure

**Objective:** Specify the top “Nå i trafikken” cards and default hidden/minor behavior before wiring UI.

**Files:**

- Create: `apps/frontend/src/trafficViewModel.test.ts`
- Modify later: `apps/frontend/src/trafficViewModel.ts`

**Step 1: Write failing tests**

Create `apps/frontend/src/trafficViewModel.test.ts`:

```ts
import type {
  PublicTransportMapPayload,
  TrafficMapEvent,
  TrafficMapPayload,
  TrafficMapSourceStatus,
} from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { buildTrafficViewModel } from "./trafficViewModel.js";

function event(overrides: Partial<TrafficMapEvent> = {}): TrafficMapEvent {
  return {
    id: "event-1",
    source: "vegvesen_traffic_info",
    sourceEventId: "1",
    category: "closure",
    severity: "critical",
    state: "active",
    title: "E6 stengt ved Sluppen",
    roadName: "E6",
    locationName: "Sluppen",
    updatedAt: "2026-06-01T16:40:00.000Z",
    geometry: { type: "Point", coordinates: [10.4, 63.4] },
    confidence: 0.98,
    ...overrides,
  };
}

const sources: TrafficMapSourceStatus[] = [
  {
    source: "vegvesen_traffic_info",
    label: "Vegvesen TrafficInfo",
    state: "ok",
    detail: "Meldinger hentet",
    lastCheckedAt: "2026-06-01T16:42:00.000Z",
  },
  {
    source: "datex_travel_time",
    label: "DATEX reisetid",
    state: "ok",
    detail: "26 korridorer",
    lastCheckedAt: "2026-06-01T16:41:00.000Z",
  },
];

const traffic: TrafficMapPayload = {
  events: [
    event(),
    event({
      id: "roadwork-1",
      category: "roadworks",
      severity: "medium",
      title: "Veiarbeid på Omkjøringsvegen",
    }),
    event({
      id: "minor-expired",
      category: "other",
      severity: "low",
      state: "expired",
      title: "Gammel melding",
    }),
  ],
  brief: {
    headline: "2 trafikkhendelser",
    severity: "critical",
    freshness: "fresh",
    generatedAt: "2026-06-01T16:42:00.000Z",
    bullets: [],
    primaryEventIds: ["event-1"],
    counts: { total: 2, byCategory: {}, bySeverity: {} },
  },
  corridorImpacts: [
    {
      id: "e6-south",
      name: "E6 sør inn mot Trondheim",
      eventCount: 1,
      affectedEventIds: ["event-1"],
      highestSeverity: "critical",
      travelTime: {
        id: "100141",
        name: "E6 Sluppen → Tiller",
        state: "congested",
        travelTimeSeconds: 1020,
        freeFlowSeconds: 540,
        delaySeconds: 480,
        delayRatio: 1.88,
        updatedAt: "2026-06-01T16:40:00.000Z",
        sourceUrl: "https://example.test/datex/travel-time",
      },
    },
  ],
  sources,
};

const publicTransport: PublicTransportMapPayload = {
  vehicles: [],
  alerts: [
    {
      id: "entur-service-alert:ATB:line3",
      source: "entur_service_alerts",
      codespaceId: "ATB",
      situationNumber: "line3",
      summary: "Forsinkelse på linje 3",
      updatedAt: "2026-06-01T16:41:00.000Z",
      state: "active",
      affectedLineNames: ["Linje 3"],
    },
  ],
  sources: [
    {
      source: "entur_service_alerts",
      label: "Entur avvik",
      state: "ok",
      detail: "1 aktivt avvik",
      lastCheckedAt: "2026-06-01T16:41:00.000Z",
    },
  ],
  generatedAt: "2026-06-01T16:42:00.000Z",
};

describe("traffic view model", () => {
  it("builds the five top cards without exposing raw feeds", () => {
    const model = buildTrafficViewModel({ traffic, publicTransport, showAll: false });

    expect(model.summaryCards.map((card) => card.id)).toEqual([
      "critical",
      "delays",
      "roadworks",
      "publicTransport",
      "updated",
    ]);
    expect(model.summaryCards[0]).toMatchObject({ title: "Kritisk", count: 1, badge: "OFFISIELL" });
    expect(model.summaryCards[1]?.detail).toContain("+8 min");
    expect(model.summaryCards[3]).toMatchObject({
      title: "Kollektiv",
      count: 1,
      badge: "KOLLEKTIV",
    });
    expect(model.summaryCards[4]?.detail).toContain("18:42");
  });

  it("hides expired/minor rows by default but shows them with showAll", () => {
    expect(
      buildTrafficViewModel({ traffic, publicTransport, showAll: false }).rankedEvents.map(
        (row) => row.id,
      ),
    ).not.toContain("minor-expired");
    expect(
      buildTrafficViewModel({ traffic, publicTransport, showAll: true }).rankedEvents.map(
        (row) => row.id,
      ),
    ).toContain("minor-expired");
  });

  it("keeps TravelTime as a delay card, not an incident row", () => {
    const model = buildTrafficViewModel({
      traffic: { ...traffic, events: [] },
      publicTransport,
      showAll: false,
    });
    expect(model.summaryCards.find((card) => card.id === "delays")?.count).toBe(1);
    expect(model.rankedEvents).toEqual([]);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficViewModel.test.ts
```

Expected: FAIL because `trafficViewModel.ts` does not exist.

**Step 3: Commit?**

Do not commit red-only unless needed. Task 5 commits tests and implementation together after GREEN.

---

### Task 5: Implement traffic view-model helpers

**Objective:** Produce top cards, filtered/default rows, combined source freshness, and traffic-pulse summaries from existing payloads.

**Files:**

- Create: `apps/frontend/src/trafficViewModel.ts`
- Test: `apps/frontend/src/trafficViewModel.test.ts`

**Step 1: Implement helper**

Create `apps/frontend/src/trafficViewModel.ts`:

```ts
import type {
  PublicTransportMapPayload,
  SourceHealth,
  TrafficCorridorImpact,
  TrafficEventSeverity,
  TrafficMapEvent,
  TrafficMapPayload,
  TrafficMapSourceStatus,
} from "@nytt/shared";
import type { TrafficTrustBadge } from "./trafficProvenance.js";
import { badgesForTrafficEvent, sourceDisplayLabel } from "./trafficProvenance.js";

export interface TrafficSummaryCardModel {
  id: "critical" | "delays" | "roadworks" | "publicTransport" | "updated";
  title: string;
  count: number;
  detail: string;
  badge?: TrafficTrustBadge;
  severity?: TrafficEventSeverity;
}

export interface RankedTrafficEventModel {
  id: string;
  event: TrafficMapEvent;
  title: string;
  meta: string;
  badges: TrafficTrustBadge[];
  score: number;
}

export type TrafficFreshnessSource = Pick<
  TrafficMapSourceStatus | SourceHealth,
  "source" | "label" | "state" | "detail" | "lastCheckedAt"
>;

export interface TrafficViewModel {
  summaryCards: TrafficSummaryCardModel[];
  rankedEvents: RankedTrafficEventModel[];
  delayCorridors: TrafficCorridorImpact[];
  sources: TrafficFreshnessSource[];
}

const severityRank: Record<TrafficEventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function formatClock(value?: string): string {
  if (!value) return "ukjent";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function minutes(seconds?: number): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function delaySummary(impact: TrafficCorridorImpact): string | undefined {
  const travelTime = impact.travelTime;
  if (!travelTime) return undefined;
  const now = minutes(travelTime.travelTimeSeconds);
  const normal = minutes(travelTime.freeFlowSeconds);
  const delay = minutes(travelTime.delaySeconds);
  if (normal && now && delay && (travelTime.delaySeconds ?? 0) > 0) {
    return `Normal: ${normal} · Nå: ${now} · +${delay}`;
  }
  if (now) return `Nå: ${now} · ${travelTime.state}`;
  return travelTime.state;
}

function sourceFreshness(sources: TrafficFreshnessSource[]): string {
  const newest = sources
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const degradedCount = sources.filter((source) => source.state === "degraded").length;
  const base = newest ? `Sist hentet ${formatClock(newest)}` : "Oppdatering ukjent";
  if (degradedCount === 1) return `${base} · 1 kilde degradert`;
  return degradedCount > 1 ? `${base} · ${degradedCount} kilder degradert` : base;
}

function eventMeta(event: TrafficMapEvent): string {
  const state =
    event.state === "active" ? "Aktiv" : event.state === "planned" ? "Planlagt" : event.state;
  const source = sourceDisplayLabel(event.source);
  const updated = `Oppdatert ${formatClock(event.updatedAt)}`;
  const place = event.locationName ?? event.roadName;
  return [state, source, updated, place].filter(Boolean).join(" · ");
}

function eventScore(event: TrafficMapEvent): number {
  const active = event.state === "active" ? 1000 : event.state === "planned" ? 500 : 0;
  const severity = severityRank[event.severity] * 100;
  const official = event.source === "datex" || event.source === "vegvesen_traffic_info" ? 25 : 0;
  const freshness = Math.max(
    0,
    50 - Math.max(0, Date.now() - Date.parse(event.updatedAt)) / 60_000 / 10,
  );
  return active + severity + official + freshness;
}

export function visibleByDefault(event: TrafficMapEvent): boolean {
  if (event.state === "expired" || event.state === "cancelled") return false;
  if (event.severity === "low" && event.category === "other") return false;
  return true;
}

export function buildTrafficViewModel({
  traffic,
  publicTransport,
  showAll,
}: {
  traffic?: TrafficMapPayload;
  publicTransport?: PublicTransportMapPayload;
  showAll: boolean;
}): TrafficViewModel {
  const events = traffic?.events ?? [];
  const visibleEvents = showAll ? events : events.filter(visibleByDefault);
  const critical = visibleEvents.filter(
    (event) => event.severity === "critical" || event.severity === "high",
  );
  const roadworks = visibleEvents.filter((event) => event.category === "roadworks");
  const delayCorridors = (traffic?.corridorImpacts ?? [])
    .filter((impact) => (impact.travelTime?.delaySeconds ?? 0) > 0)
    .sort(
      (left, right) => (right.travelTime?.delaySeconds ?? 0) - (left.travelTime?.delaySeconds ?? 0),
    );
  const transitAlerts = publicTransport?.alerts.filter((alert) => alert.state === "active") ?? [];
  const allSources = [...(traffic?.sources ?? []), ...(publicTransport?.sources ?? [])];

  return {
    summaryCards: [
      {
        id: "critical",
        title: critical.length ? "Kritisk" : "Rolig",
        count: critical.length,
        detail: critical[0]?.title ?? "Ingen alvorlige aktive hendelser i kartutsnittet.",
        badge: "OFFISIELL",
        severity: critical[0]?.severity ?? "low",
      },
      {
        id: "delays",
        title: "Forsinkelser",
        count: delayCorridors.length,
        detail: delayCorridors[0]
          ? `${delayCorridors[0].name}: ${delaySummary(delayCorridors[0])}`
          : "Ingen unormal reisetid i kjente korridorer.",
        badge: "REISETID",
        severity: delayCorridors[0]?.highestSeverity ?? "low",
      },
      {
        id: "roadworks",
        title: "Veiarbeid",
        count: roadworks.length,
        detail: roadworks[0]?.title ?? "Ingen filtrerte veiarbeid i kartutsnittet.",
        badge: "OFFISIELL",
        severity: roadworks[0]?.severity ?? "low",
      },
      {
        id: "publicTransport",
        title: "Kollektiv",
        count: transitAlerts.length,
        detail: transitAlerts[0]?.summary ?? "Ingen aktive AtB/Entur-avvik i kartutsnittet.",
        badge: "KOLLEKTIV",
        severity: transitAlerts.length ? "medium" : "low",
      },
      {
        id: "updated",
        title: "Oppdatert",
        count: allSources.filter((source) => source.state === "ok").length,
        detail: sourceFreshness(allSources),
      },
    ],
    rankedEvents: [...visibleEvents]
      .map((event) => ({
        id: event.id,
        event,
        title: event.title,
        meta: eventMeta(event),
        badges: badgesForTrafficEvent(event),
        score: eventScore(event),
      }))
      .sort(
        (left, right) => right.score - left.score || left.title.localeCompare(right.title, "nb"),
      ),
    delayCorridors,
    sources: allSources,
  };
}
```

**Step 2: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficViewModel.test.ts
```

Expected: PASS.

**Step 3: Run related tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficViewModel.test.ts apps/frontend/src/trafficProvenance.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/frontend/src/trafficViewModel.ts apps/frontend/src/trafficViewModel.test.ts
git commit -m "feat: build traffic page view model"
```

---

### Task 6: Add ranked event row formatting tests

**Objective:** Ensure the event list row says what users need: road/corridor, status, source, updated time, and delay impact when available.

**Files:**

- Create: `apps/frontend/src/trafficEventRows.test.ts`
- Modify later: `apps/frontend/src/trafficEventRows.ts`

**Step 1: Write failing test**

Create `apps/frontend/src/trafficEventRows.test.ts`:

```ts
import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { compactTrafficEventRow } from "./trafficEventRows.js";

const event: TrafficMapEvent = {
  id: "datex:e6-sluppen",
  source: "datex",
  sourceEventId: "e6-sluppen",
  category: "closure",
  severity: "critical",
  state: "active",
  title: "E6 Omkjøring ved Sluppen",
  roadName: "E6",
  locationName: "Sluppen",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
};

const corridor: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 Sluppen → Tiller",
  eventCount: 1,
  affectedEventIds: ["datex:e6-sluppen"],
  highestSeverity: "critical",
  travelTime: {
    id: "100141",
    name: "E6 Sluppen → Tiller",
    state: "congested",
    travelTimeSeconds: 1260,
    freeFlowSeconds: 540,
    delaySeconds: 720,
    delayRatio: 2.33,
    updatedAt: "2026-06-01T16:41:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

describe("compact traffic event rows", () => {
  it("formats a useful one-line official event row with delay context", () => {
    expect(compactTrafficEventRow(event, [corridor])).toEqual({
      title: "E6 Omkjøring ved Sluppen",
      meta: "Stengt vei · Statens vegvesen DATEX Situation · Oppdatert 18:42 · påvirker reisetid +12 min",
    });
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficEventRows.test.ts
```

Expected: FAIL because `trafficEventRows.ts` does not exist.

**Step 3: Commit?**

Do not commit red-only unless needed. Task 7 commits test and implementation.

---

### Task 7: Implement compact ranked event row formatter

**Objective:** Provide reusable row text for the ranked list and drawer headers.

**Files:**

- Create: `apps/frontend/src/trafficEventRows.ts`
- Test: `apps/frontend/src/trafficEventRows.test.ts`

**Step 1: Implement formatter**

Create `apps/frontend/src/trafficEventRows.ts`:

```ts
import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { sourceDisplayLabel } from "./trafficProvenance.js";

function categoryLabel(category: TrafficMapEvent["category"]): string {
  switch (category) {
    case "roadworks":
      return "Veiarbeid";
    case "accident":
      return "Ulykke";
    case "closure":
      return "Stengt vei";
    case "congestion":
      return "Kø/forsinkelse";
    case "weather":
      return "Vær/føre";
    case "restriction":
      return "Restriksjon";
    case "obstruction":
      return "Hindring";
    default:
      return "Trafikkmelding";
  }
}

function clock(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function delayForEvent(
  event: TrafficMapEvent,
  corridors: TrafficCorridorImpact[],
): string | undefined {
  const impact = corridors.find((item) => item.affectedEventIds.includes(event.id));
  const delaySeconds = impact?.travelTime?.delaySeconds;
  if (typeof delaySeconds !== "number" || delaySeconds <= 0) return undefined;
  return `påvirker reisetid +${Math.max(1, Math.round(delaySeconds / 60))} min`;
}

export function compactTrafficEventRow(
  event: TrafficMapEvent,
  corridors: TrafficCorridorImpact[] = [],
): { title: string; meta: string } {
  return {
    title: event.title,
    meta: [
      categoryLabel(event.category),
      sourceDisplayLabel(event.source),
      `Oppdatert ${clock(event.updatedAt)}`,
      delayForEvent(event, corridors),
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
```

**Step 2: Run test to verify pass**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficEventRows.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/frontend/src/trafficEventRows.ts apps/frontend/src/trafficEventRows.test.ts
git commit -m "feat: format ranked traffic event rows"
```

---

### Task 8: [PARENT-DIRECT] Replace raw filter vocabulary with semantic traffic layer state

**Objective:** Move the UI from category/severity-first filters to user-facing layers with collapsed advanced filters while keeping `TrafficMapPage` typecheckable in the same task.

**Why PARENT-DIRECT:** This changes a component prop API consumed by `TrafficMapPage`. Update the panel and the current page call site in one direct task; do not leave the repo between incompatible component APIs.

**Files:**

- Modify: `apps/frontend/src/components/map/TrafficFilterPanel.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx` (temporary compatibility wiring only; full layout happens in Task 16)
- Test: `apps/frontend/src/components/map/TrafficFilterPanel.test.tsx`

**Step 1: Write failing render test**

Create `apps/frontend/src/components/map/TrafficFilterPanel.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrafficFilterPanel, type TrafficLayerVisibility } from "./TrafficFilterPanel.js";

const visibleContextLayers: TrafficLayerVisibility = {
  incidents: true,
  roadworks: true,
  travelTime: true,
  publicTransportDisruptions: true,
  publicTransportVehicles: false,
  weatherRisk: false,
  estimatedNews: false,
  privateNotes: false,
  showAll: false,
};

describe("TrafficFilterPanel semantic layers", () => {
  it("renders semantic layer controls and collapses advanced filters", () => {
    const html = renderToStaticMarkup(
      <TrafficFilterPanel
        selectedCategories={["roadworks", "closure"]}
        selectedSeverities={["high", "critical"]}
        selectedPreset="now"
        visibleContextLayers={visibleContextLayers}
        onCategoriesChange={vi.fn()}
        onSeveritiesChange={vi.fn()}
        onPresetChange={vi.fn()}
        onContextLayersChange={vi.fn()}
      />,
    );

    expect(html).toContain("Kartlag");
    expect(html).toContain("Hendelser");
    expect(html).toContain("Veiarbeid");
    expect(html).toContain("Reisetidskorridorer");
    expect(html).toContain("Kollektivavvik");
    expect(html).toContain("Estimerte nyhetssteder");
    expect(html).toContain("Avanserte filtre");
    expect(html).toContain("Ikke aktivt på /trafikk ennå");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficFilterPanel.test.tsx
```

Expected: FAIL because `TrafficLayerVisibility` and labels do not exist.

**Step 3: Implement panel changes**

In `TrafficFilterPanel.tsx`:

- Rename `RoadContextLayerVisibility` to `TrafficLayerVisibility`.
- Replace the old `weather/cameras/counters/publicTransport` shape with the default layer model from this plan.
- Keep category/severity controls inside `<details><summary>Avanserte filtre</summary>...</details>`.
- Render layer labels exactly:
  - `Hendelser`
  - `Veiarbeid`
  - `Reisetidskorridorer`
  - `Kollektivavvik`
  - `Kjøretøyposisjoner`
  - `Vær/risiko-kontekst`
  - `Estimerte nyhetssteder`
  - `Private notater/tegninger` with helper text `Ikke aktivt på /trafikk ennå`
  - `Vis alle mindre/stale meldinger`

**Step 4: Update the current page call site before typecheck**

In `TrafficMapPage.tsx`, replace the imported `RoadContextLayerVisibility` type with `TrafficLayerVisibility`, replace `defaultContextLayers` with `defaultTrafficLayers`, and keep the existing page layout working by mapping the new layer state back to the old rendering decisions until Task 16:

```ts
const [visibleTrafficLayers, setVisibleTrafficLayers] =
  useState<TrafficLayerVisibility>(defaultTrafficLayers);

// Temporary compatibility until Task 16 restructures the page.
const roadContextWeatherVisible = visibleTrafficLayers.weatherRisk;
const publicTransportVisible =
  visibleTrafficLayers.publicTransportDisruptions || visibleTrafficLayers.publicTransportVehicles;
```

Update the `TrafficFilterPanel` props to pass `visibleTrafficLayers` and `setVisibleTrafficLayers`. This same-task wiring is what makes the following typecheck meaningful.

**Step 5: Run test and typecheck**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficFilterPanel.test.tsx
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/frontend/src/components/map/TrafficFilterPanel.tsx apps/frontend/src/components/map/TrafficFilterPanel.test.tsx apps/frontend/src/pages/TrafficMapPage.tsx
git commit -m "feat: add semantic traffic layer controls"
```

---

### Task 9: Add the top “Nå i trafikken” summary card component

**Objective:** Render the five-card status strip from `TrafficViewModel`.

**Files:**

- Create: `apps/frontend/src/components/map/TrafficNowSummary.tsx`
- Test: `apps/frontend/src/components/map/TrafficNowSummary.test.tsx`
- Modify later: `apps/frontend/src/pages/TrafficMapPage.tsx`

**Step 1: Write failing render test**

Create `apps/frontend/src/components/map/TrafficNowSummary.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrafficNowSummary } from "./TrafficNowSummary.js";
import type { TrafficSummaryCardModel } from "../../trafficViewModel.js";

const cards: TrafficSummaryCardModel[] = [
  {
    id: "critical",
    title: "Kritisk",
    count: 2,
    detail: "E6 stengt",
    badge: "OFFISIELL",
    severity: "critical",
  },
  {
    id: "delays",
    title: "Forsinkelser",
    count: 1,
    detail: "E6 Sluppen: +8 min",
    badge: "REISETID",
    severity: "medium",
  },
  {
    id: "roadworks",
    title: "Veiarbeid",
    count: 7,
    detail: "Omkjøringsvegen",
    badge: "OFFISIELL",
    severity: "medium",
  },
  {
    id: "publicTransport",
    title: "Kollektiv",
    count: 3,
    detail: "Linje 3",
    badge: "KOLLEKTIV",
    severity: "medium",
  },
  { id: "updated", title: "Oppdatert", count: 4, detail: "Sist hentet 18:42" },
];

describe("TrafficNowSummary", () => {
  it("renders compact top cards with badges", () => {
    const html = renderToStaticMarkup(<TrafficNowSummary cards={cards} />);

    expect(html).toContain("Nå i trafikken");
    expect(html).toContain("Kritisk");
    expect(html).toContain("OFFISIELL");
    expect(html).toContain("REISETID");
    expect(html).toContain("KOLLEKTIV");
    expect(html).toContain("Sist hentet 18:42");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficNowSummary.test.tsx
```

Expected: FAIL because component does not exist.

**Step 3: Implement component**

Create `apps/frontend/src/components/map/TrafficNowSummary.tsx`:

```tsx
import type { TrafficSummaryCardModel } from "../../trafficViewModel.js";

export function TrafficNowSummary({ cards }: { cards: TrafficSummaryCardModel[] }) {
  return (
    <section className="traffic-now-summary" aria-labelledby="traffic-now-heading">
      <header>
        <p className="label">Trafikk i Trondheim</p>
        <h1 id="traffic-now-heading">Nå i trafikken</h1>
      </header>
      <div className="traffic-now-cards">
        {cards.map((card) => (
          <article key={card.id} className={`traffic-now-card severity-${card.severity ?? "low"}`}>
            <div>
              <span className="traffic-now-count">{card.count}</span>
              <h2>{card.title}</h2>
            </div>
            {card.badge ? <span className="trust-badge">{card.badge}</span> : null}
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
```

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficNowSummary.test.tsx
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/components/map/TrafficNowSummary.tsx apps/frontend/src/components/map/TrafficNowSummary.test.tsx
git commit -m "feat: add traffic now summary cards"
```

---

### Task 10: Add provenance legend component

**Objective:** Make source/trust semantics visible without forcing users into raw source dumps.

**Files:**

- Create: `apps/frontend/src/components/map/TrafficLegend.tsx`
- Test: `apps/frontend/src/components/map/TrafficLegend.test.tsx`
- Modify later: `apps/frontend/src/pages/TrafficMapPage.tsx`

**Step 1: Write failing render test**

Create `apps/frontend/src/components/map/TrafficLegend.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrafficLegend } from "./TrafficLegend.js";

describe("TrafficLegend", () => {
  it("explains official, estimated, traffic-pulse and context badges", () => {
    const html = renderToStaticMarkup(<TrafficLegend />);

    expect(html).toContain("Tegnforklaring");
    expect(html).toContain("OFFISIELL");
    expect(html).toContain("ESTIMERT");
    expect(html).toContain("REISETID");
    expect(html).toContain("VARSELKONTEKST");
    expect(html).toContain("KOLLEKTIV");
    expect(html).toContain("Linje = berørt veg/korridor");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficLegend.test.tsx
```

Expected: FAIL because component does not exist.

**Step 3: Implement component**

Create `apps/frontend/src/components/map/TrafficLegend.tsx`:

```tsx
const entries = [
  ["OFFISIELL", "Statens vegvesen DATEX/TrafficInfo eller annen offisiell kilde."],
  ["ESTIMERT", "Plassering utledet fra nyhet/geokoding, ikke offisiell koordinat."],
  ["REISETID", "DATEX TravelTime: målt/estimert trafikkpuls, ikke årsak."],
  ["VARSELKONTEKST", "Vær/risiko som kan påvirke trafikk, ikke bekreftet hendelse."],
  ["KOLLEKTIV", "Entur/AtB-avvik eller kjøretøykontekst."],
  ["NYHETSKILDE", "Relatert artikkel eller offentlig melding."],
] as const;

export function TrafficLegend() {
  return (
    <aside className="traffic-legend" aria-label="Tegnforklaring for trafikkartet">
      <h2>Tegnforklaring</h2>
      <p>Linje = berørt veg/korridor. Sirkel med stiplet kant = estimert plassering.</p>
      <dl>
        {entries.map(([badge, detail]) => (
          <div key={badge}>
            <dt className="trust-badge">{badge}</dt>
            <dd>{detail}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
```

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficLegend.test.tsx
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/components/map/TrafficLegend.tsx apps/frontend/src/components/map/TrafficLegend.test.tsx
git commit -m "feat: add traffic provenance legend"
```

---

### Task 11: Add detail drawer component

**Objective:** Move source/evidence/detail from popups/raw cards into a focused “Why am I seeing this?” drawer.

**Files:**

- Create: `apps/frontend/src/components/map/TrafficDetailDrawer.tsx`
- Test: `apps/frontend/src/components/map/TrafficDetailDrawer.test.tsx`
- Modify later: `apps/frontend/src/pages/TrafficMapPage.tsx`

**Step 1: Write failing render test**

Create `apps/frontend/src/components/map/TrafficDetailDrawer.test.tsx`:

```tsx
import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrafficDetailDrawer } from "./TrafficDetailDrawer.js";

const event: TrafficMapEvent = {
  id: "datex:e6-sluppen",
  source: "datex",
  sourceEventId: "e6-sluppen",
  category: "closure",
  severity: "critical",
  state: "active",
  title: "E6 ved Sluppen",
  description: "Sørgående felt er stengt.",
  roadName: "E6",
  locationName: "Sluppen",
  updatedAt: "2026-06-01T16:39:00.000Z",
  validFrom: "2026-06-01T16:21:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
  confidence: 0.98,
  relatedArticles: [
    {
      id: "article-1",
      title: "Adresseavisen: Kø ved Sluppen",
      url: "https://example.test/article",
      distanceMeters: 120,
      location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
    },
  ],
};

const impact: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 Sluppen → Tiller",
  eventCount: 1,
  affectedEventIds: ["datex:e6-sluppen"],
  highestSeverity: "critical",
  travelTime: {
    id: "100141",
    name: "E6 Sluppen → Tiller",
    state: "congested",
    travelTimeSeconds: 1140,
    freeFlowSeconds: 480,
    delaySeconds: 660,
    delayRatio: 2.37,
    updatedAt: "2026-06-01T16:39:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

describe("TrafficDetailDrawer", () => {
  it("renders why-this-is-visible details with provenance and traffic pulse", () => {
    const html = renderToStaticMarkup(
      <TrafficDetailDrawer event={event} corridorImpacts={[impact]} onClose={vi.fn()} />,
    );

    expect(html).toContain("Hvorfor ser jeg dette?");
    expect(html).toContain("E6 ved Sluppen");
    expect(html).toContain("Status");
    expect(html).toContain("Aktiv");
    expect(html).toContain("Kilde");
    expect(html).toContain("Statens vegvesen DATEX Situation");
    expect(html).toContain("Plassering");
    expect(html).toContain("Offisiell koordinat/geometri");
    expect(html).toContain("Normal: 8 min");
    expect(html).toContain("Nå: 19 min");
    expect(html).toContain("Adresseavisen: Kø ved Sluppen");
    expect(html).toContain("estimert nyhetsplassering");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficDetailDrawer.test.tsx
```

Expected: FAIL because component does not exist.

**Step 3: Implement component**

Create `apps/frontend/src/components/map/TrafficDetailDrawer.tsx`. Keep all text explicit and provenance-first:

```tsx
import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { delaySummary } from "../../trafficViewModel.js";
import { badgesForTrafficEvent, sourceDisplayLabel } from "../../trafficProvenance.js";
import { safeExternalUrl } from "../../safeExternalUrl.js";

function clock(value?: string): string {
  if (!value) return "ukjent";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ukjent";
  return date.toLocaleTimeString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function stateLabel(state: TrafficMapEvent["state"]): string {
  switch (state) {
    case "active":
      return "Aktiv";
    case "planned":
      return "Planlagt";
    case "expired":
      return "Utløpt";
    case "cancelled":
      return "Kansellert";
    default:
      return state;
  }
}

function impactForEvent(event: TrafficMapEvent, impacts: TrafficCorridorImpact[]) {
  return impacts.find((impact) => impact.affectedEventIds.includes(event.id));
}

export function TrafficDetailDrawer({
  event,
  corridorImpacts,
  onClose,
}: {
  event?: TrafficMapEvent;
  corridorImpacts: TrafficCorridorImpact[];
  onClose: () => void;
}) {
  if (!event) return null;
  const impact = impactForEvent(event, corridorImpacts);
  const sourceUrl = safeExternalUrl(event.sourceUrl);
  return (
    <aside className="traffic-detail-drawer" aria-label="Detaljer om trafikkhendelse">
      <header>
        <p className="label">Hvorfor ser jeg dette?</p>
        <h2>{event.title}</h2>
        <button type="button" onClick={onClose} aria-label="Lukk trafikkdetaljer">
          Lukk
        </button>
      </header>
      <div className="traffic-drawer-badges">
        {badgesForTrafficEvent(event).map((badge) => (
          <span key={badge} className="trust-badge">
            {badge}
          </span>
        ))}
      </div>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{stateLabel(event.state)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{event.category}</dd>
        </div>
        <div>
          <dt>Kilde</dt>
          <dd>{sourceDisplayLabel(event.source)}</dd>
        </div>
        <div>
          <dt>Oppdatert</dt>
          <dd>{clock(event.updatedAt)}</dd>
        </div>
        <div>
          <dt>Plassering</dt>
          <dd>Offisiell koordinat/geometri</dd>
        </div>
        {event.confidence !== undefined ? (
          <div>
            <dt>Konfidens</dt>
            <dd>{Math.round(event.confidence * 100)} %</dd>
          </div>
        ) : null}
      </dl>
      {event.description ? <p>{event.description}</p> : null}
      {impact?.travelTime ? (
        <section>
          <h3>Trafikkpuls</h3>
          <p>
            {impact.name}: {delaySummary(impact)}
          </p>
        </section>
      ) : null}
      {event.relatedArticles?.length ? (
        <section>
          <h3>Relatert kildegrunnlag</h3>
          <ul>
            {event.relatedArticles.map((article) => {
              const href = safeExternalUrl(article.url);
              return (
                <li key={article.id}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {article.title}
                    </a>
                  ) : (
                    <span>{article.title}</span>
                  )}
                  <small>
                    {article.location ? "estimert nyhetsplassering" : "relatert artikkel"} ·{" "}
                    {article.distanceMeters} m unna
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {sourceUrl ? (
        <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
          Åpne kilde
        </a>
      ) : null}
    </aside>
  );
}
```

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficDetailDrawer.test.tsx
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/components/map/TrafficDetailDrawer.tsx apps/frontend/src/components/map/TrafficDetailDrawer.test.tsx
git commit -m "feat: add traffic detail drawer"
```

---

### Task 12: Add semantic map object tests

**Objective:** Ensure official geometry, estimated article locations, and context telemetry become different map object kinds before changing `TrafficLayer`.

**Files:**

- Create: `apps/frontend/src/trafficMapObjects.test.ts`
- Modify later: `apps/frontend/src/trafficMapObjects.ts`

**Step 1: Write failing tests**

Create `apps/frontend/src/trafficMapObjects.test.ts`:

```ts
import type { TrafficMapEvent } from "@nytt/shared";
import { describe, expect, it } from "vitest";
import { trafficMapObjectsForEvent } from "./trafficMapObjects.js";

const event: TrafficMapEvent = {
  id: "traffic-event-1",
  source: "vegvesen_traffic_info",
  sourceEventId: "1",
  category: "roadworks",
  severity: "medium",
  state: "active",
  title: "Veiarbeid på E6",
  updatedAt: "2026-06-01T16:42:00.000Z",
  geometry: {
    type: "LineString",
    coordinates: [
      [10.39, 63.39],
      [10.41, 63.4],
    ],
  },
  relatedArticles: [
    {
      id: "article-1",
      title: "Kø ved E6",
      url: "https://example.test/article",
      distanceMeters: 120,
      location: { lat: 63.395, lng: 10.4, label: "E6" },
    },
  ],
};

describe("traffic map objects", () => {
  it("keeps official road geometry separate from estimated news points", () => {
    expect(trafficMapObjectsForEvent(event, { estimatedNews: true })).toEqual([
      expect.objectContaining({ kind: "official-road-event", eventId: "traffic-event-1" }),
      expect.objectContaining({
        kind: "estimated-news-location",
        eventId: "traffic-event-1",
        articleId: "article-1",
        center: [63.395, 10.4],
      }),
    ]);
  });

  it("omits estimated news points unless the layer is enabled", () => {
    expect(trafficMapObjectsForEvent(event, { estimatedNews: false })).toEqual([
      expect.objectContaining({ kind: "official-road-event" }),
    ]);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficMapObjects.test.ts
```

Expected: FAIL because `trafficMapObjects.ts` does not exist.

**Step 3: Commit?**

Do not commit red-only unless needed. Task 13 commits test and implementation.

---

### Task 13: Implement semantic map object helper and update TrafficLayer

**Objective:** Render official events and estimated/news-derived locations with distinct visual semantics and clickable selection.

**Files:**

- Create: `apps/frontend/src/trafficMapObjects.ts`
- Modify: `apps/frontend/src/components/map/TrafficLayer.tsx`
- Test: `apps/frontend/src/trafficMapObjects.test.ts`

**Step 1: Implement object helper**

Create `apps/frontend/src/trafficMapObjects.ts`:

```ts
import type { Geometry } from "geojson";
import type { TrafficMapEvent } from "@nytt/shared";

export type TrafficMapObject =
  | { kind: "official-road-event"; eventId: string; event: TrafficMapEvent; geometry: Geometry }
  | {
      kind: "estimated-news-location";
      eventId: string;
      articleId: string;
      label: string;
      center: [number, number];
      event: TrafficMapEvent;
    };

function validLatLng(lat: unknown, lng: unknown): [number, number] | undefined {
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return [lat, lng];
}

export function trafficMapObjectsForEvent(
  event: TrafficMapEvent,
  options: { estimatedNews: boolean },
): TrafficMapObject[] {
  const objects: TrafficMapObject[] = [
    { kind: "official-road-event", eventId: event.id, event, geometry: event.geometry },
  ];
  if (options.estimatedNews) {
    for (const article of event.relatedArticles ?? []) {
      const center = validLatLng(article.location?.lat, article.location?.lng);
      if (!center) continue;
      objects.push({
        kind: "estimated-news-location",
        eventId: event.id,
        articleId: article.id,
        label: article.location?.label ?? article.title,
        center,
        event,
      });
    }
  }
  return objects;
}
```

**Step 2: Run helper test**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficMapObjects.test.ts
```

Expected: PASS.

**Step 3: Update `TrafficLayer` props and rendering**

In `apps/frontend/src/components/map/TrafficLayer.tsx`:

- Add props:

```ts
interface TrafficLayerProps {
  events: TrafficMapEvent[];
  highlightedEventIds?: string[];
  showEstimatedNews?: boolean;
  onSelectEvent?: (eventId: string) => void;
}
```

- Use `trafficMapObjectsForEvent(event, { estimatedNews: showEstimatedNews })`.
- Strengthen the existing `pointFromGeometry()` guard so official point geometry requires finite, in-range latitude/longitude:

```ts
function pointFromGeometry(geometry: Geometry): [number, number] | undefined {
  if (geometry.type !== "Point") return undefined;
  const lng = geometry.coordinates[0];
  const lat = geometry.coordinates[1];
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return [lat, lng];
}
```

- Render official events as the existing `CircleMarker`/`GeoJSON`, but attach `eventHandlers={{ click: () => onSelectEvent?.(event.id) }}`.
- Render `estimated-news-location` as a `CircleMarker` with class `traffic-estimated-news-location`, dashed styling, radius 8, and popup text `Estimert fra nyhetskilde: ${label}`.
- Keep safe URL handling in popups.

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/trafficMapObjects.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/trafficMapObjects.ts apps/frontend/src/trafficMapObjects.test.ts apps/frontend/src/components/map/TrafficLayer.tsx
git commit -m "feat: render semantic traffic map objects"
```

---

### Task 14: Upgrade corridor impact card into readable TravelTime corridor cards

**Objective:** Turn raw corridor impact rows into readable traffic-pulse cards such as `Normal: 9 min · Nå: 17 min · +8 min`.

**Files:**

- Modify: `apps/frontend/src/components/map/CorridorImpactCard.tsx`
- Test: `apps/frontend/src/components/map/CorridorImpactCard.test.tsx`

**Step 1: Write failing render test**

Create `apps/frontend/src/components/map/CorridorImpactCard.test.tsx`:

```tsx
import type { TrafficCorridorImpact, TrafficMapEvent } from "@nytt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CorridorImpactCard } from "./CorridorImpactCard.js";

const impact: TrafficCorridorImpact = {
  id: "e6-south",
  name: "E6 Sluppen → Tiller",
  eventCount: 1,
  affectedEventIds: ["event-1"],
  highestSeverity: "high",
  travelTime: {
    id: "100141",
    name: "E6 Sluppen → Tiller",
    state: "congested",
    travelTimeSeconds: 1020,
    freeFlowSeconds: 540,
    delaySeconds: 480,
    delayRatio: 1.88,
    updatedAt: "2026-06-01T16:40:00.000Z",
    sourceUrl: "https://example.test/datex/travel-time",
  },
};

const event: TrafficMapEvent = {
  id: "event-1",
  source: "vegvesen_traffic_info",
  sourceEventId: "1",
  category: "roadworks",
  severity: "high",
  state: "active",
  title: "Veiarbeid ved Sluppen",
  updatedAt: "2026-06-01T16:39:00.000Z",
  geometry: { type: "Point", coordinates: [10.4, 63.4] },
};

describe("CorridorImpactCard", () => {
  it("renders traffic-pulse language, not raw telemetry", () => {
    const html = renderToStaticMarkup(
      <CorridorImpactCard
        impacts={[impact]}
        events={[event]}
        selectedImpactId="e6-south"
        onSelectImpact={vi.fn()}
      />,
    );

    expect(html).toContain("Reisetidskorridorer");
    expect(html).toContain("Normal: 9 min");
    expect(html).toContain("Nå: 17 min");
    expect(html).toContain("+8 min");
    expect(html).toContain("REISETID");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/CorridorImpactCard.test.tsx
```

Expected: FAIL because current component says `Korridorpåvirkning`/`Forsinkelse ...` and does not render `REISETID`.

**Step 3: Implement component changes**

Modify `CorridorImpactCard.tsx`:

- Heading becomes `Reisetidskorridorer`.
- Use `delaySummary()` from `../../trafficViewModel.js` instead of local `travelTimeSummary()`.
- Render `<span className="trust-badge">REISETID</span>` for cards with `travelTime`.
- Sort impacts by `delaySeconds` descending before rendering.
- Keep affected events section under selected corridor only.

**Step 4: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/CorridorImpactCard.test.tsx apps/frontend/src/trafficViewModel.test.ts
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/frontend/src/components/map/CorridorImpactCard.tsx apps/frontend/src/components/map/CorridorImpactCard.test.tsx
git commit -m "feat: show DATEX travel-time corridor cards"
```

---

### Task 15: [PARENT-DIRECT] Add ranked event list component with drawer selection

**Objective:** Replace the raw feed-style event list with a ranked, compact list that opens the detail drawer while updating the current `TrafficMapPage` call site in the same task.

**Why PARENT-DIRECT:** This changes a component prop API consumed by `TrafficMapPage`. Wire the page call immediately so the task's typecheck can pass.

**Files:**

- Modify: `apps/frontend/src/components/map/TrafficEventList.tsx`
- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx` (temporary ranked-list call only; full layout happens in Task 16)
- Test: `apps/frontend/src/components/map/TrafficEventList.test.tsx`

**Step 1: Write failing render test**

Create `apps/frontend/src/components/map/TrafficEventList.test.tsx`:

```tsx
import type { RankedTrafficEventModel } from "../../trafficViewModel.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrafficEventList } from "./TrafficEventList.js";

const rankedEvents: RankedTrafficEventModel[] = [
  {
    id: "event-1",
    title: "E6 Omkjøring ved Sluppen",
    meta: "Stengt vei · Statens vegvesen · Oppdatert 18:42 · påvirker reisetid +12 min",
    badges: ["OFFISIELL"],
    score: 1500,
    event: {
      id: "event-1",
      source: "datex",
      sourceEventId: "event-1",
      category: "closure",
      severity: "critical",
      state: "active",
      title: "E6 Omkjøring ved Sluppen",
      updatedAt: "2026-06-01T16:42:00.000Z",
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
    },
  },
];

describe("TrafficEventList", () => {
  it("renders ranked rows with trust badges and progressive disclosure copy", () => {
    const html = renderToStaticMarkup(
      <TrafficEventList
        rankedEvents={rankedEvents}
        selectedEventId="event-1"
        onSelectEvent={vi.fn()}
        showAll={false}
        onShowAllChange={vi.fn()}
      />,
    );

    expect(html).toContain("Aktive trafikksituasjoner");
    expect(html).toContain("E6 Omkjøring ved Sluppen");
    expect(html).toContain("OFFISIELL");
    expect(html).toContain("Vis alle");
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficEventList.test.tsx
```

Expected: FAIL because current `TrafficEventList` accepts raw `events`, not ranked rows/show-all state.

**Step 3: Implement component**

Modify `TrafficEventList.tsx` props to:

```ts
interface TrafficEventListProps {
  rankedEvents: RankedTrafficEventModel[];
  selectedEventId?: string;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onSelectEvent: (eventId: string) => void;
}
```

Render:

- Heading: `Aktive trafikksituasjoner`.
- Header count from `rankedEvents.length`.
- `Vis alle` / `Skjul mindre` button calling `onShowAllChange(!showAll)`.
- Each row button with title, meta, and badges.
- Empty state: `Ingen aktive hendelser i valgt kartutsnitt. Prøv å zoome ut eller slå på “Vis alle”.`

**Step 4: Update the current page call site before typecheck**

In `TrafficMapPage.tsx`, add imports for `compactTrafficEventRow` and `badgesForTrafficEvent`, build a temporary ranked row array from the current `data.events`, and pass the new props:

```ts
const temporaryRankedEvents = useMemo(
  () =>
    (data?.events ?? []).map((event) => ({
      id: event.id,
      event,
      ...compactTrafficEventRow(event, data?.corridorImpacts ?? []),
      badges: badgesForTrafficEvent(event),
      score: 0,
    })),
  [data?.events, data?.corridorImpacts],
);
```

Then call `TrafficEventList` with `rankedEvents`, `showAll={visibleTrafficLayers.showAll}`, and `onShowAllChange`. Task 16 replaces this temporary wiring with the full view model.

**Step 5: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test -- apps/frontend/src/components/map/TrafficEventList.test.tsx
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/frontend/src/components/map/TrafficEventList.tsx apps/frontend/src/components/map/TrafficEventList.test.tsx apps/frontend/src/pages/TrafficMapPage.tsx
git commit -m "feat: rank traffic event list rows"
```

---

### Task 16: [PARENT-DIRECT] Rebuild TrafficMapPage into three zones

**Objective:** Wire the new view model/components into `/trafikk`: top summary, middle map workspace, and side/bottom ranked list/detail drawer.

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/styles.css:2336-3194`
- Test: existing frontend typecheck/build plus e2e in later task

**Why PARENT-DIRECT:** This is a cross-cutting shell refactor touching state, two hooks, layout, and CSS. Do not dispatch as a tiny independent subagent task unless the implementer receives the full current file and all new component APIs.

**Step 1: Update imports**

In `TrafficMapPage.tsx`, add imports:

```ts
import { TrafficDetailDrawer } from "../components/map/TrafficDetailDrawer.js";
import { TrafficLegend } from "../components/map/TrafficLegend.js";
import { TrafficNowSummary } from "../components/map/TrafficNowSummary.js";
import { buildTrafficViewModel, visibleByDefault } from "../trafficViewModel.js";
import { compactTrafficEventRow } from "../trafficEventRows.js";
```

Replace `RoadContextLayerVisibility` import with `TrafficLayerVisibility` from `TrafficFilterPanel.js`.

**Step 2: Replace default layer state and query states**

Replace `defaultContextLayers` with:

```ts
const defaultTrafficLayers: TrafficLayerVisibility = {
  incidents: true,
  roadworks: true,
  travelTime: true,
  publicTransportDisruptions: true,
  publicTransportVehicles: false,
  weatherRisk: false,
  estimatedNews: false,
  privateNotes: false,
  showAll: false,
};
```

Keep the old category/severity state for advanced filters and API query compatibility, but change state queries so the default page can count active/planned roadworks and `Vis alle` can broaden the result set:

```ts
const requestedTrafficStates: TrafficEventState[] = visibleTrafficLayers.showAll
  ? ["active", "planned", "expired", "cancelled"]
  : ["active", "planned"];
```

Pass `states: requestedTrafficStates` to `useTrafficMap` for every preset. Preserve the preset `from`/`to` date window for `next24h`, `next7d`, `planned`, and `custom`, but let `showAll=true` broaden the state list to include `expired`/`cancelled` inside that same window. This makes progressive disclosure operate on fetched data instead of trying to reveal rows that the API never returned.

**Step 3: Fetch public transport alerts by default, vehicles only when enabled and filter vehicles client-side**

Change `usePublicTransportMap` call to:

```ts
const publicTransportEnabled =
  visibleTrafficLayers.publicTransportDisruptions || visibleTrafficLayers.publicTransportVehicles;

const {
  data: publicTransportData,
  loading: publicTransportLoading,
  error: publicTransportError,
  reload: reloadPublicTransport,
} = usePublicTransportMap({
  modes: visibleTrafficLayers.publicTransportVehicles ? ["bus", "tram", "rail", "water"] : [],
  includeAlerts: visibleTrafficLayers.publicTransportDisruptions,
  bounds: stableBounds,
  enabled: publicTransportEnabled,
});
```

Current `fetchPublicTransportMap` omits the `modes` query parameter for an empty array, and the server treats omitted modes as “all vehicles”. Therefore this task must filter vehicles client-side before the view model/layer/summary see the payload:

```ts
const publicTransportDisplayData = useMemo(() => {
  if (!publicTransportData) return undefined;
  return {
    ...publicTransportData,
    vehicles: visibleTrafficLayers.publicTransportVehicles ? publicTransportData.vehicles : [],
    alerts: visibleTrafficLayers.publicTransportDisruptions ? publicTransportData.alerts : [],
  };
}, [
  publicTransportData,
  visibleTrafficLayers.publicTransportDisruptions,
  visibleTrafficLayers.publicTransportVehicles,
]);
```

Use `publicTransportDisplayData` for `buildTrafficViewModel`, `PublicTransportLayer`, and `PublicTransportSummary`. This prevents vehicles from counting as disruptions or appearing when only the alert layer is enabled.

**Step 4: Build view model**

After data hooks:

```ts
const trafficViewModel = useMemo(
  () =>
    buildTrafficViewModel({
      traffic: data,
      publicTransport: publicTransportDisplayData,
      showAll: visibleTrafficLayers.showAll,
    }),
  [data, publicTransportDisplayData, visibleTrafficLayers.showAll],
);

const selectedEvent = useMemo(
  () => data?.events.find((event) => event.id === selectedEventId),
  [data?.events, selectedEventId],
);

const visibleTrafficEvents = useMemo(() => {
  const events = data?.events ?? [];
  return events.filter((event) => {
    const isRoadwork = event.category === "roadworks";
    const isIncident = !isRoadwork;
    if (isRoadwork && !visibleTrafficLayers.roadworks) return false;
    if (isIncident && !visibleTrafficLayers.incidents) return false;
    if (!visibleTrafficLayers.showAll && !visibleByDefault(event)) return false;
    return true;
  });
}, [
  data?.events,
  visibleTrafficLayers.incidents,
  visibleTrafficLayers.roadworks,
  visibleTrafficLayers.showAll,
]);

const rankedEventsForList = useMemo(
  () =>
    trafficViewModel.rankedEvents
      .filter((row) => visibleTrafficEvents.some((event) => event.id === row.id))
      .map((row) => ({
        ...row,
        ...compactTrafficEventRow(row.event, data?.corridorImpacts ?? []),
      })),
  [trafficViewModel.rankedEvents, visibleTrafficEvents, data?.corridorImpacts],
);
```

When building ranked rows, use `compactTrafficEventRow(event, data?.corridorImpacts ?? [])` to override `title` and `meta`; the helper must return `{ title, meta }` so `RankedTrafficEventModel` remains type-correct.

**Step 5: Restructure JSX into zones**

Replace the current top-level JSX with this structure, preserving the existing route planner form and `TravelPlanCard`:

```tsx
<main className="traffic-page-shell">
  <TrafficNowSummary cards={trafficViewModel.summaryCards} />

  <section className="traffic-workspace" aria-label="Trafikkart og kartlag">
    <div className="traffic-workspace-sidebar">
      <TrafficFilterPanel ... />
      <TrafficLegend />
      <form className="route-planner-form" ...>...</form>
    </div>
    <MapContainer center={trondheimCenter} zoom={12} className="traffic-map">
      ...
      {data?.events ? (
        <TrafficLayer
          events={visibleTrafficEvents}
          highlightedEventIds={highlightedEventIds}
          showEstimatedNews={visibleTrafficLayers.estimatedNews}
          onSelectEvent={setSelectedEventId}
        />
      ) : null}
      {data ? (
        <RoadContextLayer
          weather={visibleTrafficLayers.weatherRisk ? data.weather : []}
          cameras={[]}
          counters={[]}
        />
      ) : null}
      <PublicTransportLayer
        payload={publicTransportDisplayData}
        visible={visibleTrafficLayers.publicTransportDisruptions || visibleTrafficLayers.publicTransportVehicles}
      />
      <TravelPlanLayer plan={travelPlan} />
    </MapContainer>
  </section>

  <section className="traffic-bottom-panel" aria-label="Trafikkdetaljer">
    <div className="traffic-bottom-list">
      <TravelPlanCard ... />
      <TrafficEventList
        rankedEvents={rankedEventsForList}
        selectedEventId={selectedEventId}
        showAll={visibleTrafficLayers.showAll}
        onShowAllChange={(showAll) => setVisibleTrafficLayers((current) => ({ ...current, showAll }))}
        onSelectEvent={setSelectedEventId}
      />
      {visibleTrafficLayers.travelTime ? <CorridorImpactCard ... /> : null}
      {visibleTrafficLayers.publicTransportDisruptions ? <PublicTransportSummary ... /> : null}
    </div>
    <TrafficDetailDrawer
      event={selectedEvent}
      corridorImpacts={data?.corridorImpacts ?? []}
      onClose={() => setSelectedEventId(undefined)}
    />
  </section>
</main>
```

Remove `TrafficBriefCard` from the default visible flow. Keep it only as a small collapsed/debug fallback if needed, not as a main page card.

**Step 6: Add CSS layout**

In `styles.css`, replace the old `.traffic-map-page` block with new classes:

```css
.traffic-page-shell {
  max-width: 1440px;
  margin: 0 auto;
  padding: 26px 32px 44px;
  display: grid;
  gap: 20px;
}

.traffic-now-summary header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 18px;
}

.traffic-now-summary h1 {
  margin: 0;
  font: 46px/1.04 var(--serif);
  letter-spacing: -0.025em;
}

.traffic-now-cards {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.traffic-now-card {
  min-height: 138px;
  padding: 16px;
  border: 1px solid var(--line);
  background: var(--paper);
}

.traffic-now-card.severity-critical,
.traffic-now-card.severity-high {
  border-left: 4px solid var(--terracotta);
}

.traffic-now-count {
  display: block;
  font: 34px/1 var(--serif);
}

.trust-badge {
  display: inline-flex;
  width: fit-content;
  margin: 6px 6px 0 0;
  padding: 3px 7px;
  border: 1px solid var(--line);
  color: var(--blue);
  background: #fff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.traffic-workspace {
  display: grid;
  grid-template-columns: minmax(260px, 330px) minmax(0, 1fr);
  min-height: 640px;
  border: 1px solid var(--line);
  background: var(--paper);
}

.traffic-workspace-sidebar {
  padding: 18px;
  overflow: auto;
  border-right: 1px solid var(--line);
  display: grid;
  gap: 14px;
  align-content: start;
}

.traffic-map {
  min-height: 640px;
  height: 100%;
  width: 100%;
  background: #eef0eb;
}

.traffic-bottom-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: 18px;
}

.traffic-bottom-list {
  display: grid;
  gap: 14px;
}

.traffic-detail-drawer {
  position: sticky;
  top: 96px;
  align-self: start;
  max-height: calc(100vh - 120px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--line);
  background: var(--paper);
}

.traffic-estimated-news-location {
  stroke-dasharray: 4 4;
  stroke: var(--terracotta);
  fill: rgba(168, 67, 40, 0.18);
}
```

Add responsive rules in the existing `@media (max-width: 1080px)` and `@media (max-width: 720px)` blocks; Task 17 completes mobile bottom-sheet behavior.

**Step 7: Verify**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build -w @nytt/frontend
```

Expected: PASS.

**Step 8: Commit**

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/styles.css
git commit -m "feat: restructure traffic page around summary map and ranked details"
```

---

### Task 17: [PARENT-DIRECT] Add mobile map-first bottom-sheet behavior

**Objective:** Make mobile show summary, map, one Layers button, then bottom-sheet ranked events/details instead of a long cluttered feed.

**Files:**

- Modify: `apps/frontend/src/pages/TrafficMapPage.tsx`
- Modify: `apps/frontend/src/components/map/TrafficFilterPanel.tsx`
- Modify: `apps/frontend/src/styles.css:2879-3194`
- Test: Playwright in Task 18

**Why PARENT-DIRECT:** Mobile behavior crosses page state, filter panel presentation, and CSS. Execute after Task 16 so the layout has settled.

**Step 1: Add layers drawer state**

In `TrafficMapPage.tsx`:

```ts
const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
```

Add a button before the workspace sidebar:

```tsx
<button
  type="button"
  className="traffic-mobile-layers-button"
  onClick={() => setMobileLayersOpen((open) => !open)}
>
  Lag
</button>
```

Set sidebar class:

```tsx
<div className={`traffic-workspace-sidebar${mobileLayersOpen ? " open" : ""}`}>
```

**Step 2: Add mobile CSS**

In `@media (max-width: 720px)`:

```css
.traffic-page-shell {
  padding: 16px;
  gap: 14px;
}

.traffic-now-cards {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(170px, 76%);
  overflow-x: auto;
  padding-bottom: 6px;
}

.traffic-workspace {
  grid-template-columns: 1fr;
  min-height: 0;
}

.traffic-mobile-layers-button {
  display: inline-flex;
  justify-content: center;
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--blue);
  font-weight: 700;
}

.traffic-workspace-sidebar {
  display: none;
  border-right: 0;
  border-bottom: 1px solid var(--line);
}

.traffic-workspace-sidebar.open {
  display: grid;
}

.traffic-map {
  min-height: 520px;
}

.traffic-bottom-panel {
  display: block;
}

.traffic-bottom-list {
  border: 1px solid var(--line);
  border-radius: 18px 18px 0 0;
  padding: 14px;
  background: var(--paper);
  margin-top: -38px;
  position: relative;
  z-index: 450;
}

.traffic-detail-drawer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  top: auto;
  max-height: 72vh;
  border-radius: 18px 18px 0 0;
  z-index: 800;
}
```

Outside mobile media, hide the mobile layers button:

```css
.traffic-mobile-layers-button {
  display: none;
}
```

**Step 3: Verify build**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck -w @nytt/frontend
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build -w @nytt/frontend
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/frontend/src/pages/TrafficMapPage.tsx apps/frontend/src/components/map/TrafficFilterPanel.tsx apps/frontend/src/styles.css
git commit -m "feat: add mobile traffic map bottom sheet"
```

---

### Task 18: Add Playwright coverage for the new traffic hierarchy

**Objective:** Prove the page presents summary, semantic layers, ranked rows and drawer using mocked API payloads.

**Files:**

- Modify: `e2e/app.spec.ts`

**Step 1: Add failing e2e test**

Add a test near the existing traffic tests:

```ts
test("traffic page shows summary cards semantic layers ranked list and detail drawer", async ({
  page,
}) => {
  await page.route("**/api/map/traffic-events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [
          {
            id: "datex:e6-sluppen",
            source: "datex",
            sourceEventId: "e6-sluppen",
            category: "closure",
            severity: "critical",
            state: "active",
            title: "E6 Omkjøring ved Sluppen",
            description: "Sørgående felt er stengt.",
            roadName: "E6",
            locationName: "Sluppen",
            updatedAt: "2026-06-01T16:42:00.000Z",
            geometry: { type: "Point", coordinates: [10.4, 63.4] },
            confidence: 0.98,
            relatedArticles: [
              {
                id: "article-1",
                title: "Adresseavisen: Kø ved Sluppen",
                url: "https://example.test/article",
                distanceMeters: 120,
                location: { lat: 63.4, lng: 10.4, label: "Sluppen" },
              },
            ],
          },
        ],
        brief: {
          headline: "1 trafikkhendelse",
          severity: "critical",
          freshness: "fresh",
          generatedAt: "2026-06-01T16:42:00.000Z",
          bullets: [],
          primaryEventIds: ["datex:e6-sluppen"],
          counts: { total: 1, byCategory: { closure: 1 }, bySeverity: { critical: 1 } },
        },
        corridorImpacts: [
          {
            id: "e6-south",
            name: "E6 Sluppen → Tiller",
            eventCount: 1,
            affectedEventIds: ["datex:e6-sluppen"],
            highestSeverity: "critical",
            travelTime: {
              id: "100141",
              name: "E6 Sluppen → Tiller",
              state: "congested",
              travelTimeSeconds: 1260,
              freeFlowSeconds: 540,
              delaySeconds: 720,
              delayRatio: 2.33,
              updatedAt: "2026-06-01T16:41:00.000Z",
              sourceUrl: "https://example.test/datex/travel-time",
            },
          },
        ],
        sources: [
          {
            source: "datex",
            label: "Vegvesen DATEX",
            state: "ok",
            detail: "Sist hentet nå",
            lastCheckedAt: "2026-06-01T16:42:00.000Z",
          },
          {
            source: "datex_travel_time",
            label: "DATEX reisetid",
            state: "ok",
            detail: "1 korridor",
            lastCheckedAt: "2026-06-01T16:41:00.000Z",
          },
        ],
        weather: [],
        cameras: [],
        counters: [],
      }),
    });
  });
  await page.route("**/api/map/public-transport**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        vehicles: [],
        alerts: [
          {
            id: "entur-service-alert:ATB:line3",
            source: "entur_service_alerts",
            codespaceId: "ATB",
            situationNumber: "line3",
            summary: "Forsinkelse på linje 3",
            updatedAt: "2026-06-01T16:41:00.000Z",
            state: "active",
          },
        ],
        sources: [
          {
            source: "entur_service_alerts",
            label: "Entur avvik",
            state: "ok",
            detail: "1 aktivt avvik",
            lastCheckedAt: "2026-06-01T16:41:00.000Z",
          },
        ],
        generatedAt: "2026-06-01T16:42:00.000Z",
      }),
    });
  });

  await page.goto("/trafikk");

  await expect(page.getByRole("heading", { name: "Nå i trafikken" })).toBeVisible();
  await expect(page.getByText("OFFISIELL").first()).toBeVisible();
  await expect(page.getByText("REISETID").first()).toBeVisible();
  await expect(page.getByText("KOLLEKTIV").first()).toBeVisible();
  await expect(page.getByLabel("Trafikkart og kartlag")).toContainText("Estimerte nyhetssteder");
  await expect(page.getByRole("heading", { name: "Aktive trafikksituasjoner" })).toBeVisible();
  await page.getByRole("button", { name: /E6 Omkjøring ved Sluppen/ }).click();
  await expect(page.getByLabel("Detaljer om trafikkhendelse")).toContainText(
    "Hvorfor ser jeg dette?",
  );
  await expect(page.getByLabel("Detaljer om trafikkhendelse")).toContainText(
    "Statens vegvesen DATEX Situation",
  );
  await expect(page.getByLabel("Detaljer om trafikkhendelse")).toContainText(
    "Adresseavisen: Kø ved Sluppen",
  );
});
```

**Step 2: Run test to verify failure/pass depending on task order**

Run after Task 17 implementation:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e -- --grep "traffic page shows summary cards"
```

Expected: PASS. If it fails because the current dev server seed/bootstrap blocks the route, follow existing e2e setup patterns in `e2e/app.spec.ts` rather than weakening the assertions.

**Step 3: Update existing traffic e2e expectations**

Patch the existing `/trafikk` tests in `e2e/app.spec.ts` so they match the new hierarchy instead of the old labels:

- Replace heading expectations for `Trafikkart` with `Nå i trafikken` where the test is checking the page shell.
- Replace the old public-transport checkbox label `Vis kollektivtrafikk` with the new layer labels `Kollektivavvik` and/or `Kjøretøyposisjoner`.
- Update the mobile ordering test to assert summary → map → bottom sheet and the single `Lag` button, not permanently expanded filters.
- Keep existing route planner assertions intact; the route planner remains part of the bottom/detail flow.

Run the touched tests by grep before the full gate:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e -- --grep "traffic map|traffic page|mobile traffic"
```

Expected: PASS.

**Step 4: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test: cover traffic page provenance hierarchy"
```

---

### Task 19: Run full local quality gate and fix regressions

**Objective:** Verify the refactor works across types, tests, lint, formatting, build and e2e.

**Files:**

- Modify only files needed for mechanical fixes.

**Step 1: Run full gate**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run typecheck
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run lint
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format:check
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run test:e2e
```

Expected: all PASS. If `format:check` fails, run:

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run format:check
```

**Step 2: Commit mechanical fixes**

```bash
git add -A
git commit -m "chore: pass traffic provenance UX gates"
```

Skip the commit if there are no changes.

---

### Task 20: Post-implementation audit and deployment verification plan

**Objective:** Catch semantic regressions that tests miss before claiming the traffic page is done or deployed.

**Files:**

- Read only, unless audit finds bugs.

**Step 1: Read changed files manually**

Read every changed file:

```text
packages/shared/src/traffic-map.ts
apps/server/src/traffic/related-articles.ts
apps/server/test/traffic-related-articles.test.ts
apps/frontend/src/trafficProvenance.ts
apps/frontend/src/trafficViewModel.ts
apps/frontend/src/trafficEventRows.ts
apps/frontend/src/trafficMapObjects.ts
apps/frontend/src/components/map/TrafficFilterPanel.tsx
apps/frontend/src/components/map/TrafficNowSummary.tsx
apps/frontend/src/components/map/TrafficLegend.tsx
apps/frontend/src/components/map/TrafficDetailDrawer.tsx
apps/frontend/src/components/map/TrafficLayer.tsx
apps/frontend/src/components/map/CorridorImpactCard.tsx
apps/frontend/src/components/map/TrafficEventList.tsx
apps/frontend/src/pages/TrafficMapPage.tsx
apps/frontend/src/styles.css
e2e/app.spec.ts
```

Check:

- TravelTime rows appear only as `REISETID` delay/corridor context.
- Weather/risk context never says it confirms an incident.
- Entur vehicles never appear in top “disruption” counts.
- Entur service alerts appear as `KOLLEKTIV`, not road incidents.
- Estimated article locations are opt-in, dashed/styled as estimated, and never overwrite official geometry.
- No source-health errors are hidden by UI copy that says data is current.
- Mobile layout does not hide the map or make filters permanently expanded.

**Step 2: Run post-implementation review**

Use `subagent-driven-development/references/post-implementation-audit.md` checklist. Pay special attention to the traffic-map audit reference: segment-aware assumptions, request hook invalidation, and reviewer-found issues even when tests pass.

**Step 3: If deploying later, do not claim success until verified**

After merge/push, verify CI and deploy for the exact SHA:

```bash
gh run list --branch main --limit 5
gh run view <run-id> --json status,conclusion,headSha
```

Expected before reporting success:

```text
status=completed
conclusion=success
headSha=<pushed sha>
```

Then verify live behavior with authenticated browser or production DB checks. Anonymous `curl` to `/api/map/traffic-events` returning 401 is not proof of zero traffic events.

**Step 4: Commit audit fixes**

If bugs were found and fixed:

```bash
git add -A
git commit -m "fix: address traffic provenance UX audit findings"
```

---

## Final acceptance criteria

- `/trafikk` top zone shows 3-5 summary cards only: critical, delays, roadworks, public transport, updated.
- Map remains central and has visible layer controls plus a provenance legend.
- Default view is high-signal: active/high-impact incidents, roadworks, travel-time corridors, and public-transport disruptions; minor/stale rows require `Vis alle`.
- Ranked list is not raw feed order and rows include source, updated time, provenance badge, and delay context when available.
- Detail drawer answers “Why am I seeing this?” and separates official coordinates from estimated news locations.
- DATEX TravelTime is visible as traffic pulse only, not as causal incident evidence.
- Weather/risk context is styled and worded as context only.
- Entur service alerts are `KOLLEKTIV`; Entur vehicles remain optional telemetry and do not count as disruptions.
- Estimated/news-derived map points are opt-in and dashed/estimated.
- Mobile uses summary → map → bottom sheet, with a single Layers button.
- Gates pass: `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:e2e`.

## Future backlog after this plan

- Saved places and watched corridors/lines.
- Personalized “Påvirker meg?” mode.
- Historical delay baseline and abnormal-vs-rush-hour comparison.
- Notification/watchlist pipeline.
- Alternative route/mode hints.
- Private owner traffic annotations on `/trafikk`, only after a separate workspace/provenance design.
