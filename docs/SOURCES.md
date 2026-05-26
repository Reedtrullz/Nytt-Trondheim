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
- MET MetAlerts and NVE/Varsom endpoints are health-probed by the initial worker. The map model supports their official warning geometry, but production parsing and situation attachment of current warning features must be completed before those live layers are shown.
- DSB public WMS/WFS supplies optional preparedness context. Its authenticated skogbrann functions for fire fronts, forecasts and resources are not consumed.
- Statens vegvesen DATEX is represented as awaiting access until credentials are installed.

## Politiloggen

`POLITILOGGEN_ENABLED=false` by default. The optional adapter is isolated because the current web application's structured endpoint is not a documented stable public collection contract and `/api/` is disallowed in the site's robots policy. Enabling it is a personal-use operational choice; failure does not disable the Situation Room.
