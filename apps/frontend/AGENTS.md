# Frontend — React/Vite UI

## OVERVIEW

React 19 + Vite + Leaflet + React Router browser client. All user-facing text is Bokmål.

## STRUCTURE

```
src/
├── main.tsx              # React root mount with BrowserRouter
├── App.tsx               # Router shell, bootstrap fetch, auth redirect
├── api.ts                # Central fetch wrapper with CSRF + 401 redirect
├── api/                  # Endpoint-specific thin clients (trafficMap, travelPlan, etc.)
├── pages/                # One component per route (7 pages)
├── components/
│   ├── map/              # 18 Leaflet-centric presentational components
│   ├── situations/       # Situation explanation panel
│   └── MapViews.tsx      # Reusable map views + private drawing tools
├── hooks/                # Polling loaders with abort guards (useTrafficMap, usePublicTransportMap)
├── mapTools/             # Pure geometry math + private map tool presets
├── styles.css            # Single stylesheet
└── traffic*.ts / freshness.ts / situationTime.ts / safeExternalUrl.ts / homeFilters.ts
                          # Pure view-model helpers and formatters
```

## WHERE TO LOOK

| Task               | Location                                                                   | Notes                                                  |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| Add a page         | `src/pages/` + wire in `App.tsx` Routes                                    | Follow existing `<Route>` pattern                      |
| Add map layer      | `src/components/map/`                                                      | Presentational only; no fetching                       |
| Add API call       | `src/api.ts` or `src/api/`                                                 | Use `request<T>()` wrapper; CSRF auto-attached         |
| Add polling hook   | `src/hooks/`                                                               | Follow `useTrafficMap` pattern with abort + request ID |
| Traffic view logic | `src/trafficViewModel.ts` / `trafficEventRows.ts` / `trafficProvenance.ts` | Pure transforms                                        |
| Map drawing tools  | `src/mapTools/presets.ts`                                                  | Consumed by `MapViews.tsx`                             |
| Time formatting    | `src/situationTime.ts`                                                     | `Europe/Oslo` / `nb-NO`                                |

## CONVENTIONS

- `components/map/` is display-only: no fetch calls, no side effects; receives data via props
- Pages own all state, fetching, and optimistic updates
- `api.ts` handles auth (401 → redirect to `/auth/github`) and CSRF transparently
- Tests use `renderToStaticMarkup` for component assertions, not DOM testing library
- Tests sit beside implementation files (`*.test.ts` / `*.test.tsx`)
- Pure view-model helpers (`traffic*.ts`) are tested with value assertions, not DOM
- `safeExternalUrl.ts` sanitizes all outbound links (allowlisted hosts only)
- No `import.meta.env` usage; all config comes from server API or Vite proxy

## ANTI-PATTERNS

- Never fetch from `components/map/` — pages or hooks own data loading
- Never use DOM testing library; use `renderToStaticMarkup` + string assertions
- `TrafficBriefCard.tsx` appears unused in current page composition; verify before removing
