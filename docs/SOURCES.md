# Data Sources And Limits

## Collected News

| Source            | Method                                         | Frequency | Data retained                     |
| ----------------- | ---------------------------------------------- | --------- | --------------------------------- |
| NRK Trøndelag     | RSS `https://www.nrk.no/trondelag/siste.rss`   | 10 min    | Headline, excerpt, URL, timestamp |
| Adresseavisen     | RSS `https://www.adressa.no/rss/nyheter`       | 10 min    | Headline, excerpt, URL, timestamp |
| VG                | RSS `https://www.vg.no/rss/feed/`              | 10 min    | Trondheim/Trøndelag matches only  |
| Dagbladet         | RSS `https://www.dagbladet.no/rss/nyheter.xml` | 10 min    | Trondheim/Trøndelag matches only  |
| Trondheim kommune | Public Aktuelt HTML listing                    | Hourly    | Headline, excerpt, URL            |

Articles link to the publisher; this application does not republish complete articles. Nidaros is excluded until a suitable permitted collection route is confirmed.
Trondheim kommune publication timestamps are interpreted in `Europe/Oslo`, including daylight-saving transitions. When a still-visible collected article is fetched again, corrected public classification and geocoding metadata are refreshed without removing an established situation link.

## Official And Geographic Layers

- Kartverket WMTS `topo` provides the map underlay and must be attributed `© Kartverket`.
- Kartverket Stedsnavn geocodes source-mentioned Trondheim place names into clearly marked reporting-estimate points; the application does not generate incident perimeters from a name.
- MET MetAlerts is collected from filtered RSS and immutable CAP updates for Trøndelag land areas, with GeoRSS warning geometry retained from published alerts. CAP identifiers are stored once and updates/cancellations retire superseded records. Geometry is attached only to a relevant located situation and is shown as `Farevarsel`; it does not confirm an active incident.
- NVE/Varsom flood and landslide municipality warnings for Trondheim are collected as official textual warning context. The worker does not invent map geometry where NVE supplies municipality scope without polygons.
- Trondheim kommune stories matching the incident type and place can corroborate a situation as `Offentlig bekreftet`; general MET/NVE danger warnings cannot.
- DSB public WMS/WFS supplies optional preparedness context. Its authenticated skogbrann functions for fire fronts, forecasts and resources are not consumed.
- Statens vegvesen DATEX II v3.1 `GetSituation/pullsnapshotdata?srti=True` is collected with Basic Auth when `DATEX_USERNAME` and `DATEX_PASSWORD` are configured. The SRTI-filtered default avoids repeatedly parsing the full national situation snapshot while preserving high-signal accidents, closures, obstructions and congestion records for the main traffic layer. The worker sends `If-Modified-Since` when a previous `Last-Modified` value exists, stores relevant Trondheim/Trøndelag traffic situations as official events, and promotes high-impact accidents/closures/obstructions into official traffic situations. Low-impact/planned roadworks are retained as official events for future traffic-layer UI, but do not currently spam the main situation feed. Persisted raw DATEX metadata is intentionally compact: stable IDs, record kind, impact, road labels, comments, validity and timing metadata are kept, but full parsed XML nodes are not duplicated into every event row.
- DATEX TravelTime uses the same DATEX Basic Auth credentials (`DATEX_USERNAME`, `DATEX_PASSWORD`; GitHub secrets `NYTT_DATEX_USERNAME`, `NYTT_DATEX_PASSWORD`) to collect predefined Trondheim corridor locations and measured/estimated travel time snapshots. Optional runtime endpoint overrides are `DATEX_TRAVEL_TIME_LOCATIONS_ENDPOINT` and `DATEX_TRAVEL_TIME_DATA_ENDPOINT`; blank values use `https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetPredefinedTravelTimeLocations/pullsnapshotdata` and `https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetTravelTimeData/pullsnapshotdata`.

DATEX TravelTime is implemented only as a source-health/traffic-pulse signal for measured or estimated travel time and delay. It does not infer incident cause or severity, does not promote or create `OfficialEvent` rows, and does not create or update `Situation` rows. Measured road weather, forecast points and CCTV site tables remain intentionally separate follow-up integrations; weather should be road-context enrichment, and CCTV only with explicit freshness/staleness labeling.

## Politiloggen

`POLITILOGGEN_ENABLED=false` by default. The optional adapter is isolated because the current web application's structured endpoint is not a documented stable public collection contract and `/api/` is disallowed in the site's robots policy. Enabling it is a personal-use operational choice; failure does not disable the Situation Room.

## Situation Matching

The worker creates preliminary situations only for explicit incident categories and a shared specific place identifier. A general Trondheim mention is valid for feed relevance, but not for linking independent stories into one incident. Open situations accept timely matching reporting and matching official closure updates; resolved or dismissed cases cannot absorb a later new event at the same place. DeepSeek may enrich an already qualifying group with cited text; it does not bypass deterministic activation requirements.
