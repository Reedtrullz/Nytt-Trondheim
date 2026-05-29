import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { RoadWeatherObservation } from "@nytt/shared";
import {
  defaultDatexWeatherMeasurementsEndpoint,
  defaultDatexWeatherSitesEndpoint,
  parseDatexRoadWeather,
} from "../src/datexRoadWeather.js";

const sitesFixturePath = new URL("./fixtures/datex-weather-sites.xml", import.meta.url);
const measurementsFixturePath = new URL(
  "./fixtures/datex-weather-measurements.xml",
  import.meta.url,
);

const _roadWeatherObservationTypeCheck = {
  id: "datex-weather:SN70690",
  source: "datex_weather",
  stationId: "SN70690",
  stationName: "Klett",
  observedAt: "2026-05-29T11:40:00.000Z",
  updatedAt: "2026-05-29T11:45:00.000Z",
  geometry: { type: "Point", coordinates: [10.3001, 63.324] },
  airTemperatureC: 7.2,
  roadSurfaceTemperatureC: 5.1,
} satisfies RoadWeatherObservation;

void _roadWeatherObservationTypeCheck;

async function parseFixtureObservations(): Promise<RoadWeatherObservation[]> {
  const [siteXml, measurementXml] = await Promise.all([
    readFile(sitesFixturePath, "utf8"),
    readFile(measurementsFixturePath, "utf8"),
  ]);

  return parseDatexRoadWeather(siteXml, measurementXml, {
    receivedAt: "2026-05-29T11:45:00.000Z",
  });
}

describe("DATEX road weather parsing", () => {
  it("uses the planned Vegvesen road-weather snapshot endpoints by default", () => {
    expect(defaultDatexWeatherMeasurementsEndpoint).toBe(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetMeasuredWeatherData/pullsnapshotdata",
    );
    expect(defaultDatexWeatherSitesEndpoint).toBe(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetMeasurementWeatherSiteTable/pullsnapshotdata",
    );
  });

  it("normalizes Trøndelag station metadata and latest weather measurements", async () => {
    const observations = await parseFixtureObservations();

    expect(observations).toEqual([
      expect.objectContaining({
        id: "datex-weather:SN70690",
        source: "datex_weather",
        stationId: "SN70690",
        stationName: "Klett",
        geometry: { type: "Point", coordinates: [10.3001, 63.324] },
        airTemperatureC: 7.2,
        roadSurfaceTemperatureC: 5.1,
      }),
    ]);
    expect(observations[0]).toMatchObject({
      observedAt: "2026-05-29T11:40:00.000Z",
      updatedAt: "2026-05-29T11:45:00.000Z",
    });
  });

  it("skips outside-region weather stations", async () => {
    const observations = await parseFixtureObservations();

    expect(observations.map((observation) => observation.stationId)).not.toContain("SN99999");
  });

  it("skips weather stations with malformed or missing geometry", async () => {
    const observations = await parseFixtureObservations();

    expect(observations.map((observation) => observation.stationId)).not.toContain("SNBAD");
  });

  it("skips local weather stations without a matching measurement", () => {
    const siteXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:measurementSiteRecord id="SNLOCAL">
            <d2:measurementSiteName><d2:values><d2:value>Klett uten data</d2:value></d2:values></d2:measurementSiteName>
            <d2:measurementSiteLocation>
              <d2:pointCoordinates><d2:latitude>63.324</d2:latitude><d2:longitude>10.3001</d2:longitude></d2:pointCoordinates>
            </d2:measurementSiteLocation>
          </d2:measurementSiteRecord>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;
    const measurementXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:siteMeasurements>
            <d2:measurementSiteReference id="SNOTHER" />
            <d2:measurementTimeDefault>2026-05-29T11:40:00Z</d2:measurementTimeDefault>
            <d2:measuredValue><d2:basicData><d2:airTemperature><d2:temperature>7.2</d2:temperature></d2:airTemperature></d2:basicData></d2:measuredValue>
          </d2:siteMeasurements>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;

    expect(
      parseDatexRoadWeather(siteXml, measurementXml, {
        receivedAt: "2026-05-29T11:45:00.000Z",
      }),
    ).toEqual([]);
  });
});
