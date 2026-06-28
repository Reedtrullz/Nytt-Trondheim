# Data Sources And Limits

See also `docs/plans/2026-06-02-source-bank-review.md` for reviewed future source candidates,
source-contract rules and the implementation priority order. `docs/situation-activation-framework.md`
defines the deterministic activation framework, source-role matrix, DATEX promotion matrix and
60+ regression fixture manifest used to decide whether a source may create or only contextualize a
situation.

## Collected News

| Source              | Method                                         | Frequency | Data retained                     |
| ------------------- | ---------------------------------------------- | --------- | --------------------------------- |
| NRK Trøndelag       | RSS `https://www.nrk.no/trondelag/siste.rss`   | 10 min    | Headline, excerpt, URL, timestamp |
| Adresseavisen       | RSS `https://www.adressa.no/rss/nyheter`       | 10 min    | Headline, excerpt, URL, timestamp |
| Avisa Sør-Trøndelag | RSS `https://www.avisa-st.no/rss`              | 10 min    | Headline, excerpt, URL, timestamp |
| VG                  | RSS `https://www.vg.no/rss/feed/`              | 10 min    | Trondheim/Trøndelag matches only  |
| Dagbladet           | RSS `https://www.dagbladet.no/rss/nyheter.xml` | 10 min    | Trondheim/Trøndelag matches only  |
| Trondheim kommune   | Public Aktuelt HTML listing                    | Hourly    | Headline, excerpt, URL            |

Articles link to the publisher; this application does not republish complete articles. Nidaros is excluded until a suitable permitted collection route is confirmed.
Trondheim kommune publication timestamps are interpreted in `Europe/Oslo`, including daylight-saving transitions. When a still-visible collected article is fetched again, corrected public classification and geocoding metadata are refreshed without removing an established situation link.

Articles and official MET/NVE/DATEX/Politiloggen situation events, Entur service alerts, Bane NOR rail/mobility messages and Vegvesen TrafficInfo records are mirrored into the internal `source_items` ledger when their source contracts permit it. DATEX TravelTime, DATEX Weather, DATEX CCTV, Trafikkdata counters and Entur vehicle positions are explicitly excluded from the editorial source stream and remain telemetry/context tables plus `source_health` only.

Coverage bundles are not a collected source. They are worker-derived article grouping decisions stored in `coverage_bundles` for owner-only operations review at `/drift/dekning`. They may reference article ids and source labels, but they do not write raw upstream payloads, do not require a source contract, and must not be mirrored into `source_items`.

## Official And Geographic Layers

- Kartverket WMTS `topo` provides the map underlay and must be attributed `© Kartverket`.
- Kartverket Stedsnavn geocodes source-mentioned Trondheim place names into clearly marked reporting-estimate points; the application does not generate incident perimeters from a name.
- MET MetAlerts is collected from filtered RSS and immutable CAP updates for Trøndelag land areas, with GeoRSS warning geometry retained from published alerts. CAP identifiers are stored once and updates/cancellations retire superseded records. Geometry is attached only to a relevant located situation and is shown as `Farevarsel`; it does not confirm an active incident.
- NVE/Varsom flood and landslide municipality warnings for Trondheim are collected as official textual warning context. The worker does not invent map geometry where NVE supplies municipality scope without polygons.
- Trondheim kommune stories matching the incident type and place can corroborate a situation as `Offentlig bekreftet`; general MET/NVE danger warnings cannot.
- DSB public WMS/WFS supplies optional preparedness context. Its authenticated skogbrann functions for fire fronts, forecasts and resources are not consumed.
- Statens vegvesen DATEX II v3.1 `GetSituation/pullsnapshotdata?srti=True` is collected with Basic Auth when `DATEX_USERNAME` and `DATEX_PASSWORD` are configured. In production those runtime variables are populated only from GitHub repository secrets `NYTT_DATEX_USERNAME` and `NYTT_DATEX_PASSWORD`; the frontend never receives DATEX credentials. The SRTI-filtered default avoids repeatedly parsing the full national situation snapshot while preserving high-signal accidents, closures, obstructions and congestion records for the main traffic layer. The worker normalizes configured Situation endpoints to keep `srti=True`, sends `If-Modified-Since` when a previous `Last-Modified` value exists, stores relevant Trondheim/Trøndelag traffic situations as official events, and promotes high-impact accidents, closures, congestion and road-blocking obstructions into official traffic situations. Low-impact/planned roadworks and low-impact environmental obstructions such as animal-in-road notices are retained as official traffic context, but do not create main-feed situation rooms. Persisted raw DATEX metadata is intentionally compact: stable IDs, record kind, impact, road labels, comments, validity and timing metadata are kept, but full parsed XML nodes are not duplicated into every event row.
- Statens vegvesen TrafficInfo `traffic-information/messages` is collected without exposing credentials and with `X-System-ID: vvtraf`. It powers the live traffic map overlay for roadworks, closures, restrictions and warnings around Trondheim/Trøndelag. TrafficInfo is the only source currently permitted to persist rows in `traffic_map_events`; those rows are mirrored to `source_items` as official evidence, but ordinary roadworks do not create `official_events` or promote `situations`. DATEX-derived and news-derived traffic map objects are composed at API read time from `official_events` and articles; they are not persisted in `traffic_map_events`.
- The authenticated travel-planner API `/api/map/travel-plan?from=...&to=...` resolves free-text places with Nominatim/OpenStreetMap inside the Trondheim service bounds (`63.25..63.62`, `10.05..10.85`), accepts direct coordinates in either `lat,lng` or `lng,lat` order when they fall inside that service area, requests an OSRM driving route, and falls back to a straight corridor if routing is unavailable. It filters stored TrafficInfo/DATEX map events within 1.5 km of the route and Entur vehicles/alerts within 1.2 km; it does not ingest new upstream traffic data itself and does not create `source_items`, `official_events` or `situations`.
- DATEX TravelTime uses the same DATEX Basic Auth credentials (`DATEX_USERNAME`, `DATEX_PASSWORD`; GitHub secrets `NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`) to collect predefined Trondheim corridor locations and measured/estimated travel time snapshots. Optional runtime endpoint overrides are `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT` and `DATEX_TRAVEL_TIME_DATA_ENDPOINT`; blank values use `https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetPredefinedTravelTimeLocations/pullsnapshotdata` and `https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata`. DATEX TravelTime powers corridor delay context only; it remains in `datex_travel_times` and is not mirrored to `source_items` or promoted to incidents.
- DATEX Weather (`GetMeasuredWeatherData` + `GetMeasurementWeatherSiteTable`) and CCTV (`GetCCTVSiteTable` + `GetCCTVStatus`) are road-context overlays with source-health/freshness labels. They are operations-only telemetry/context.
- Trafikkdata.no GraphQL (`https://trafikkdata-api.atlas.vegvesen.no/`) supplies bounded low-frequency traffic-counter context for Trøndelag/Trondheim. It is not a situation source.
- Entur Vehicle Positions GraphQL (`https://api.entur.io/realtime/v2/vehicles/graphql`) supplies ATB vehicle positions in the Trondheim-region bounds. It is operations-only telemetry, stored in `public_transport_vehicles`, visible as a map layer, and never mirrored to `source_items`, `official_events` or `situations`.
- Entur Journey Planner v3 `situations(codespaces:["ATB"])` supplies official public-transport service alerts. These alerts are stored in `public_transport_service_alerts` and mirrored to `source_items` provider `entur`, kind `official_event`; they are not automatic situation activators in this release.
- Bane NOR RSS `https://www.banenor.no/reise-og-trafikk/trafikkmeldinger/?rss=true` is collected as official rail/mobility context after its source contract. It is mirrored to `source_items` provider `bane_nor`, kind `official_event`, and updates `source_health` source `bane_nor`, but does not create `official_events`, `traffic_map_events`, or `situations` in this phase. Production verification on 2026-06-02 observed `source_health.state='ok'`, 11 `bane_nor` source items, preserved raw RSS payloads for all 11, and zero Bane NOR rows in `official_events`, `traffic_map_events` or `situations`.

## Politiloggen

Politiloggen is collected from the documented public API `https://api.politiloggen.politiet.no/messagethreads` with `Municipalities=Trondheim`. The worker fetches up to 1000 Trondheim message threads per run, mirrors them as official `politiloggen` source items/articles, and promotes active threads to `Offentlig bekreftet` situations. When Politiloggen later marks a known thread inactive, the matching Nytt situation is resolved with an official timeline entry. Set `POLITILOGGEN_ENABLED=false` only to disable this adapter operationally.

## Situation Matching

The worker creates preliminary situations only for explicit incident categories and a shared specific place identifier. A general Trondheim mention is valid for feed relevance, but not for linking independent stories into one incident. Open situations accept timely matching reporting and matching official closure updates; resolved or dismissed cases cannot absorb a later new event at the same place. DeepSeek may enrich an already qualifying group with cited text; it does not bypass deterministic activation requirements.
