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

## Official And Geographic Layers

- Kartverket WMTS `topo` provides the map underlay and must be attributed `© Kartverket`.
- Kartverket Stedsnavn geocodes source-mentioned Trondheim place names into clearly marked reporting-estimate points; the application does not generate incident perimeters from a name.
- MET MetAlerts is collected from filtered RSS and immutable CAP updates for Trøndelag land areas, with GeoRSS warning geometry retained from published alerts. CAP identifiers are stored once and updates/cancellations retire superseded records. Geometry is attached only to a relevant located situation and is shown as `Farevarsel`; it does not confirm an active incident.
- NVE/Varsom flood and landslide municipality warnings for Trondheim are collected as official textual warning context. The worker does not invent map geometry where NVE supplies municipality scope without polygons.
- Trondheim kommune stories matching the incident type and place can corroborate a situation as `Offentlig bekreftet`; general MET/NVE danger warnings cannot.
- DSB public WMS/WFS supplies optional preparedness context. Its authenticated skogbrann functions for fire fronts, forecasts and resources are not consumed.
- Statens vegvesen DATEX is represented as awaiting access until credentials are installed.

## Politiloggen

`POLITILOGGEN_ENABLED=false` by default. The optional adapter is isolated because the current web application's structured endpoint is not a documented stable public collection contract and `/api/` is disallowed in the site's robots policy. Enabling it is a personal-use operational choice; failure does not disable the Situation Room.

DATEX and Politiloggen are intentionally deferred from the safe core production release and remain disabled or awaiting access.

## Situation Matching

The worker creates preliminary situations only for explicit incident categories and a shared specific place identifier. A general Trondheim mention is valid for feed relevance, but not for linking independent stories into one incident. DeepSeek may enrich an already qualifying group with cited text; it does not bypass deterministic activation requirements.
