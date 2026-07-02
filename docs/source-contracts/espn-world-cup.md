# ESPN World Cup Dashboard Contract

### Provider

- Name: ESPN public soccer APIs
- Source ID: `espn_world_cup_dashboard` dashboard-only contract; not a `SourceId`
- Authority level: `trusted_media`
- Endpoint(s):
  - `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260628-20260719&limit=120`
  - `https://site.web.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?region=us&lang=en&contentorigin=espn&type=0&level=3&sort=rank:asc`
- Auth: none
- Method and expected content type: `GET` JSON
- User-Agent: `NyttTrondheim/1.0 (+https://nytt.reidar.tech)`
- Rate/backoff: server-side read-through cache; 75 seconds while a match is live, otherwise 5 minutes; fallback cache 45 seconds after fetch failures
- Conditional fetch support: not used
- Legal/robots/licensing notes: dashboard links back to ESPN/FIFA/FOX and only normalizes compact score/table metadata for authenticated Nytt users

### Identity and lifecycle

- Durable upstream identity: ESPN event `id` for matches; standings group names for tables
- Version/revision/change marker: endpoint response at request time; no revision field is retained
- Duplicate snapshot behavior: latest normalized response replaces the previous in-memory API cache
- Disappearance behavior: an absent match/table is not interpreted as cancellation or incident evidence; fallback remains available
- Open-ended/stale policy: API response includes `generatedAt`; browser retries according to `nextRefreshSeconds`

### Retention

- Retained fields: normalized match id, stage, teams, score/status, kickoff, venue, short consequence note, group table rows and source labels
- Explicitly not retained: raw ESPN payloads, player-level details, play-by-play, odds, links beyond public source links
- Raw payload retention: none
- Normalized payload shape: `WorldCupDashboardPayload` from `@nytt/shared`

### Product boundaries

- May create `source_items`: no
- May create `official_events`: no
- May create `traffic_map_events`: no
- May create `situations`: no
- Promotion rules: none; this source is sport dashboard context only
- Explicit no-promotion rules: ESPN sports rows must never corroborate incidents, traffic, weather, crime or newsroom source provenance
- Geometry semantics: none

### Source health and verification

- Health source ID: none in v1; failures are surfaced on `/sport` as fallback mode
- OK detail: `/api/sport/world-cup` returns `sourceMode: "live"` and a recent `generatedAt`
- Degraded detail: `/api/sport/world-cup` returns `sourceMode: "fallback"` with a failure detail
- Production SQL checks: none; no database writes are expected
- Live endpoint verification command:

```bash
curl -fsSL 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260628-20260719&limit=120' | jq '.events | length'
```
