import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { OperationsStatus, SourceHealth, TrafficPulseCorridor } from "@nytt/shared";
import {
  collectDatexTravelTimePulse,
  parseDatexTravelTimeData,
  parseDatexTravelTimeLocations,
  trafficPulseFromDatexTravelTime,
} from "../src/datexTravelTime.js";

const locationsFixturePath = new URL(
  "./fixtures/datex-travel-time-locations.xml",
  import.meta.url,
);
const dataFixturePath = new URL("./fixtures/datex-travel-time-data.xml", import.meta.url);
const travelTimeLocationsSourceUrl =
  "https://datex.example.test/datexapi/GetPredefinedTravelTimeLocations/pullsnapshotdata";
const travelTimeDataSourceUrl = "https://datex.example.test/datexapi/GetTravelTimeData/pullsnapshotdata";
const expectedTravelTimeAuthorization = "Basic ZGF0ZXgtdXNlcjpkYXRleC1wYXNz";
const expectedTravelTimeUserAgent = "NyttTrondheim/0.1 kontakt@reidar.tech";

function responseHeaders(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

async function rejectedMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected promise to reject");
}

function travelTimeDataXml(basicData: string): string {
  return `
    <?xml version="1.0" encoding="UTF-8"?>
    <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" modelBaseVersion="3">
      <d2:payloadPublication xsi:type="d2:MeasuredDataPublication" lang="no">
        <d2:siteMeasurements>
          ${basicData}
        </d2:siteMeasurements>
      </d2:payloadPublication>
    </d2:d2LogicalModel>
  `;
}

const _trafficPulseCorridorTypeCheck = {
  id: "e6-sluppen-sandmoen",
  name: "E6 Sluppen–Sandmoen",
  state: "slow",
  travelTimeSeconds: 720,
  freeFlowSeconds: 540,
  delaySeconds: 180,
  delayRatio: 1.33,
  trend: "increasing",
  measurementFrom: "2026-05-28T09:55:00.000Z",
  measurementTo: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  sourceUrl: "https://datex.example.test/datexapi/GetTravelTimeData/pullsnapshotdata",
} satisfies TrafficPulseCorridor;

const _sourceHealthTypeCheck = {
  source: "datex_travel_time",
  label: "Vegvesen DATEX reisetid",
  state: "ok",
  lastCheckedAt: "2026-05-28T10:00:00.000Z",
  detail: "Travel time feed available",
} satisfies SourceHealth;

const _operationsStatusTypeCheck = {
  sources: [_sourceHealthTypeCheck],
  articleCount: 0,
  situationCounts: {
    preliminary: 0,
    active: 0,
    resolved: 0,
    dismissed: 0,
  },
  trafficPulse: [_trafficPulseCorridorTypeCheck],
} satisfies OperationsStatus;

void _trafficPulseCorridorTypeCheck;
void _operationsStatusTypeCheck;

type ParsedTravelTimeLocation = {
  id: string;
  name: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function locationEntries(value: unknown): ParsedTravelTimeLocation[] {
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([id, raw]) => {
      const record = isRecord(raw) ? raw : {};
      return {
        id: typeof record.id === "string" ? record.id : String(id),
        name: typeof record.name === "string" ? record.name : "",
      };
    });
  }

  if (Array.isArray(value)) {
    return value.flatMap((raw) => {
      if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return [];
      return [{ id: raw.id, name: raw.name }];
    });
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([id, raw]) => {
      if (!isRecord(raw) || typeof raw.name !== "string") return [];
      return [{ id: typeof raw.id === "string" ? raw.id : id, name: raw.name }];
    });
  }

  return [];
}

describe("DATEX travel time shared types", () => {
  it("exposes a dedicated source-health id for traffic pulse", () => {
    expect(_sourceHealthTypeCheck.source).toBe("datex_travel_time");
  });
});

describe("DATEX travel time collection", () => {
  it("fetches both snapshots with Basic Auth and no conditional headers", async () => {
    const [locationsXml, dataXml] = await Promise.all([
      readFile(locationsFixturePath, "utf8"),
      readFile(dataFixturePath, "utf8"),
    ]);
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === travelTimeLocationsSourceUrl) return new Response(locationsXml);
      if (url === travelTimeDataSourceUrl) return new Response(dataXml);
      return new Response("Unexpected URL", { status: 500 });
    });

    const result = await collectDatexTravelTimePulse({
      locationsEndpoint: travelTimeLocationsSourceUrl,
      dataEndpoint: travelTimeDataSourceUrl,
      username: "datex-user",
      password: "datex-pass",
      fetcher,
      now: () => new Date("2026-05-28T16:21:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      travelTimeLocationsSourceUrl,
      travelTimeDataSourceUrl,
    ]);

    for (const [, init] of fetcher.mock.calls) {
      const headers = responseHeaders(init);
      expect(headers.get("Authorization")).toBe(expectedTravelTimeAuthorization);
      expect(headers.get("User-Agent")).toBe(expectedTravelTimeUserAgent);
      expect(headers.get("If-Modified-Since")).toBeNull();
    }

    expect(result.corridors).toHaveLength(3);
    expect(result.corridors.map((corridor) => corridor.id)).toEqual(
      expect.arrayContaining(["100135", "100139", "local-future-1"]),
    );
    expect(result.corridors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "100135",
          name: "E6 Moholt - E6 Ranheim",
          state: "congested",
          travelTimeSeconds: 360,
          freeFlowSeconds: 240,
          delaySeconds: 120,
          delayRatio: 1.5,
          trend: "increasing",
          measurementFrom: "2026-05-28T16:15:00.010Z",
          measurementTo: "2026-05-28T16:20:00.010Z",
          updatedAt: "2026-05-28T16:21:00.000Z",
          sourceUrl: travelTimeDataSourceUrl,
        }),
        expect.objectContaining({
          id: "100139",
          name: "Rv706 Sluppen - E6 Sluppenrampene",
          state: "slow",
          travelTimeSeconds: 150,
          freeFlowSeconds: 120,
          sourceUrl: travelTimeDataSourceUrl,
        }),
        expect.objectContaining({
          id: "local-future-1",
          name: "Trondheim sentrum - Lade",
          state: "free_flow",
          travelTimeSeconds: 180,
          freeFlowSeconds: 180,
          sourceUrl: travelTimeDataSourceUrl,
        }),
      ]),
    );
  });

  it("throws useful sanitized errors for failed TravelTime endpoints", async () => {
    const locationsXml = await readFile(locationsFixturePath, "utf8");
    const locationFailureFetcher = vi.fn(async () => new Response("Unavailable", { status: 503 }));

    const locationMessage = await rejectedMessage(
      collectDatexTravelTimePulse({
        locationsEndpoint: travelTimeLocationsSourceUrl,
        dataEndpoint: travelTimeDataSourceUrl,
        username: "datex-user",
        password: "datex-pass",
        fetcher: locationFailureFetcher,
      }),
    );

    expect(locationMessage).toBe("DATEX TravelTime locations returned HTTP 503");
    expect(locationMessage).not.toContain("datex-user");
    expect(locationMessage).not.toContain("datex-pass");
    expect(locationMessage).not.toContain(expectedTravelTimeAuthorization);

    const dataFailureFetcher = vi.fn(
      async (input: Parameters<typeof fetch>[0]) =>
        String(input) === travelTimeLocationsSourceUrl
          ? new Response(locationsXml)
          : new Response("Bad gateway", { status: 502 }),
    );

    const dataMessage = await rejectedMessage(
      collectDatexTravelTimePulse({
        locationsEndpoint: travelTimeLocationsSourceUrl,
        dataEndpoint: travelTimeDataSourceUrl,
        username: "datex-user",
        password: "datex-pass",
        fetcher: dataFailureFetcher,
      }),
    );

    expect(dataMessage).toBe("DATEX TravelTime data returned HTTP 502");
    expect(dataMessage).not.toContain("datex-user");
    expect(dataMessage).not.toContain("datex-pass");
    expect(dataMessage).not.toContain(expectedTravelTimeAuthorization);
  });
});

describe("DATEX travel time parsing", () => {
  it("parses location IDs and names from namespace-prefixed XML", async () => {
    const xml = await readFile(locationsFixturePath, "utf8");

    const locations = parseDatexTravelTimeLocations(xml);
    const parsedLocations = locationEntries(locations);

    expect(parsedLocations).toHaveLength(5);
    expect(parsedLocations).toEqual(
      expect.arrayContaining([
        { id: "100135", name: "E6 Moholt - E6 Ranheim" },
        { id: "100139", name: "Rv706 Sluppen - E6 Sluppenrampene" },
        { id: "local-future-1", name: "Trondheim sentrum - Lade" },
        { id: "999999", name: "Ring 3 Oslo - Sinsen" },
        { id: "888888", name: "E6 Lillehammer - Hamar" },
      ]),
    );
  });

  it("parses live-like location references with their own ID and name", () => {
    const xml = `
      <d2:predefinedLocationReference xmlns:d2="http://datex2.eu/schema/3/common" id="100135">
        <d2:predefinedLocationName>
          <d2:values>
            <d2:value lang="no">E6 Moholt - E6 Ranheim</d2:value>
          </d2:values>
        </d2:predefinedLocationName>
      </d2:predefinedLocationReference>
    `;

    const locations = parseDatexTravelTimeLocations(xml);

    expect(locations.get("100135")).toEqual({ id: "100135", name: "E6 Moholt - E6 Ranheim" });
  });

  it("parses TravelTimeData measurements and ignores non-TravelTimeData quantities", async () => {
    const xml = await readFile(dataFixturePath, "utf8");

    const measurements = parseDatexTravelTimeData(xml);
    const locationIds = measurements.map((measurement) => measurement.locationId);

    expect(measurements).toHaveLength(6);
    expect(measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locationId: "100135",
          travelTimeSeconds: 360,
          freeFlowSeconds: 240,
          trend: "increasing",
          measurementFrom: "2026-05-28T16:15:00.010Z",
          measurementTo: "2026-05-28T16:20:00.010Z",
        }),
        expect.objectContaining({
          locationId: "100139",
          travelTimeSeconds: 150,
          freeFlowSeconds: 120,
          trend: "stable",
        }),
        expect.objectContaining({
          locationId: "local-future-1",
          travelTimeSeconds: 180,
          freeFlowSeconds: 180,
        }),
        expect.objectContaining({
          locationId: "999999",
          travelTimeSeconds: 600,
          freeFlowSeconds: 300,
        }),
        expect.objectContaining({
          locationId: "888888",
          travelTimeSeconds: 1200,
          freeFlowSeconds: 300,
        }),
        expect.objectContaining({
          locationId: "missing-location-1",
          travelTimeSeconds: 210,
          freeFlowSeconds: 180,
        }),
      ]),
    );
    expect(locationIds).not.toContain("non-travel-time-location");
  });

  it("drops TravelTimeData measurements with missing or empty travel-time duration", () => {
    const xml = travelTimeDataXml(`
      <d2:physicalQuantity>
        <d2:basicData xsi:type="d2:TravelTimeData">
          <d2:pertinentLocation xsi:type="d2:LocationByReference">
            <d2:predefinedLocationReference id="missing-travel-time-duration" />
          </d2:pertinentLocation>
          <d2:travelTime />
          <d2:freeFlowTravelTime>
            <d2:duration>120</d2:duration>
          </d2:freeFlowTravelTime>
        </d2:basicData>
      </d2:physicalQuantity>
      <d2:physicalQuantity>
        <d2:basicData xsi:type="d2:TravelTimeData">
          <d2:pertinentLocation xsi:type="d2:LocationByReference">
            <d2:predefinedLocationReference id="empty-travel-time-duration" />
          </d2:pertinentLocation>
          <d2:travelTime>
            <d2:duration>   </d2:duration>
          </d2:travelTime>
          <d2:freeFlowTravelTime>
            <d2:duration>120</d2:duration>
          </d2:freeFlowTravelTime>
        </d2:basicData>
      </d2:physicalQuantity>
      <d2:physicalQuantity>
        <d2:basicData xsi:type="d2:TravelTimeData">
          <d2:pertinentLocation xsi:type="d2:LocationByReference">
            <d2:predefinedLocationReference id="valid-travel-time-duration" />
          </d2:pertinentLocation>
          <d2:travelTime>
            <d2:duration>180</d2:duration>
          </d2:travelTime>
          <d2:freeFlowTravelTime>
            <d2:duration>120</d2:duration>
          </d2:freeFlowTravelTime>
        </d2:basicData>
      </d2:physicalQuantity>
    `);

    const measurements = parseDatexTravelTimeData(xml);

    expect(measurements).toEqual([
      expect.objectContaining({
        locationId: "valid-travel-time-duration",
        travelTimeSeconds: 180,
        freeFlowSeconds: 120,
      }),
    ]);
    expect(measurements.map((measurement) => measurement.locationId)).not.toEqual(
      expect.arrayContaining(["missing-travel-time-duration", "empty-travel-time-duration"]),
    );
  });

  it("keeps measurements with missing free-flow duration without delay fields", () => {
    const xml = travelTimeDataXml(`
      <d2:physicalQuantity>
        <d2:basicData xsi:type="d2:TravelTimeData">
          <d2:pertinentLocation xsi:type="d2:LocationByReference">
            <d2:predefinedLocationReference id="100135" />
          </d2:pertinentLocation>
          <d2:travelTime>
            <d2:duration>300</d2:duration>
          </d2:travelTime>
          <d2:freeFlowTravelTime />
        </d2:basicData>
      </d2:physicalQuantity>
      <d2:physicalQuantity>
        <d2:basicData xsi:type="d2:TravelTimeData">
          <d2:pertinentLocation xsi:type="d2:LocationByReference">
            <d2:predefinedLocationReference id="100139" />
          </d2:pertinentLocation>
          <d2:travelTime>
            <d2:duration>240</d2:duration>
          </d2:travelTime>
          <d2:freeFlowTravelTime>
            <d2:duration>   </d2:duration>
          </d2:freeFlowTravelTime>
        </d2:basicData>
      </d2:physicalQuantity>
    `);

    const measurements = parseDatexTravelTimeData(xml);

    expect(measurements).toEqual([
      { locationId: "100135", travelTimeSeconds: 300 },
      { locationId: "100139", travelTimeSeconds: 240 },
    ]);

    const corridors = trafficPulseFromDatexTravelTime(
      [
        { id: "100135", name: "E6 Moholt - E6 Ranheim" },
        { id: "100139", name: "Rv706 Sluppen - E6 Sluppenrampene" },
      ],
      measurements,
      {
        sourceUrl: travelTimeDataSourceUrl,
        receivedAt: "2026-05-28T16:21:00.000Z",
      },
    );

    expect(corridors).toEqual([
      expect.not.objectContaining({ freeFlowSeconds: expect.any(Number) }),
      expect.not.objectContaining({ freeFlowSeconds: expect.any(Number) }),
    ]);
    expect(corridors).toEqual([
      expect.objectContaining({ id: "100135", state: "free_flow", travelTimeSeconds: 300 }),
      expect.objectContaining({ id: "100139", state: "free_flow", travelTimeSeconds: 240 }),
    ]);
    for (const corridor of corridors) {
      expect(corridor).not.toHaveProperty("freeFlowSeconds");
      expect(corridor).not.toHaveProperty("delaySeconds");
      expect(corridor).not.toHaveProperty("delayRatio");
    }
  });

  it("joins measurements into only local Trondheim travel-time corridors", async () => {
    const [locationsXml, dataXml] = await Promise.all([
      readFile(locationsFixturePath, "utf8"),
      readFile(dataFixturePath, "utf8"),
    ]);

    const locations = parseDatexTravelTimeLocations(locationsXml);
    const measurements = parseDatexTravelTimeData(dataXml);
    const corridors = trafficPulseFromDatexTravelTime(locations, measurements, {
      sourceUrl: travelTimeDataSourceUrl,
      receivedAt: "2026-05-28T16:21:00.000Z",
    });

    const corridorIds = corridors.map((corridor) => corridor.id);

    expect(corridorIds).toHaveLength(3);
    expect(corridorIds).toEqual(expect.arrayContaining(["100135", "100139", "local-future-1"]));
    expect(corridorIds).not.toContain("999999");
    expect(corridorIds).not.toContain("888888");
    expect(corridorIds).not.toContain("missing-location-1");
    expect(corridorIds).not.toContain("non-travel-time-location");

    expect(corridors.find((corridor) => corridor.id === "100135")).toMatchObject({
      id: "100135",
      name: "E6 Moholt - E6 Ranheim",
      state: "congested",
      travelTimeSeconds: 360,
      freeFlowSeconds: 240,
      delaySeconds: 120,
      delayRatio: 1.5,
      trend: "increasing",
      measurementFrom: "2026-05-28T16:15:00.010Z",
      measurementTo: "2026-05-28T16:20:00.010Z",
      updatedAt: "2026-05-28T16:21:00.000Z",
      sourceUrl: travelTimeDataSourceUrl,
    });
    expect(corridors.find((corridor) => corridor.id === "100139")).toMatchObject({
      id: "100139",
      name: "Rv706 Sluppen - E6 Sluppenrampene",
      state: "slow",
      travelTimeSeconds: 150,
      freeFlowSeconds: 120,
      delaySeconds: 30,
      delayRatio: 1.25,
      trend: "stable",
    });
    expect(corridors.find((corridor) => corridor.id === "local-future-1")).toMatchObject({
      id: "local-future-1",
      name: "Trondheim sentrum - Lade",
      state: "free_flow",
      travelTimeSeconds: 180,
      freeFlowSeconds: 180,
      delaySeconds: 0,
      delayRatio: 1,
    });
  });
});
