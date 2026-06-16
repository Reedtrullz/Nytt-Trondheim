import { describe, expect, it, vi } from "vitest";
import {
  buildTrafficRegistrationPointsQuery,
  defaultTrafikkdataGraphqlEndpoint,
  fetchTrafikkdataCounterSnapshots,
  parseTrafikkdataPoints,
} from "../src/trafikkdata.js";

const fixture = {
  data: {
    trafficRegistrationPoints: [
      {
        id: "06970V72811",
        name: "Kroppanbrua",
        municipality: { name: "Trondheim" },
        countyNumber: 50,
        isOperational: true,
        location: { coordinates: { longitude: 10.384529, latitude: 63.391793 } },
        latestHourlyVolume: {
          from: "2026-05-29T09:00:00.000Z",
          to: "2026-05-29T10:00:00.000Z",
          volume: 1234,
          coveragePercent: 98,
        },
      },
      {
        id: "outside-trondelag",
        name: "Oppdal sør",
        municipalityName: "Oppdal",
        countyNumber: 50,
        isOperational: true,
        geometry: { type: "Point", coordinates: [9.69, 62.59] },
        latestHourlyVolume: { volume: 321, coveragePercent: 87 },
      },
    ],
  },
};

describe("Trafikkdata counter parser and client", () => {
  it("builds a bounded county 50 operational point query", () => {
    const query = buildTrafficRegistrationPointsQuery();

    expect(query).toContain("trafficRegistrationPoints");
    expect(query.replace(/\s+/g, "")).toContain("countyNumbers:[50]");
    expect(query.replace(/\s+/g, "")).toContain("isOperational:true");
  });

  it("parses registration points and keeps Trondheim-region counters", () => {
    const points = parseTrafikkdataPoints(fixture, {
      receivedAt: "2026-05-29T10:00:00.000Z",
    });

    expect(points.filter((point) => point.municipalityName === "Trondheim")).toHaveLength(1);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      id: "trafikkdata:06970V72811",
      source: "trafikkdata",
      pointId: "06970V72811",
      name: "Kroppanbrua",
      updatedAt: "2026-05-29T10:00:00.000Z",
      geometry: { type: "Point", coordinates: [10.384529, 63.391793] },
      volumeLastHour: 1234,
      coveragePercent: 98,
      municipalityName: "Trondheim",
    });
  });

  it("supports connection-style GraphQL responses and metadata-only counters", () => {
    const points = parseTrafikkdataPoints(
      {
        data: {
          trafficRegistrationPoints: {
            edges: [
              {
                node: {
                  trafficRegistrationPointId: "TRD-METADATA",
                  name: "Elgeseter bru",
                  municipalityName: "Trondheim",
                  geometry: { type: "Point", coordinates: [10.395, 63.416] },
                },
              },
            ],
          },
        },
      },
      { receivedAt: "2026-05-29T10:05:00.000Z" },
    );

    expect(points).toEqual([
      expect.objectContaining({
        id: "trafikkdata:TRD-METADATA",
        pointId: "TRD-METADATA",
        name: "Elgeseter bru",
        updatedAt: "2026-05-29T10:05:00.000Z",
      }),
    ]);
    expect(points[0]?.volumeLastHour).toBeUndefined();
  });

  it("posts metadata and latest hourly volume GraphQL queries", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              p0: {
                volume: {
                  byHour: {
                    edges: [
                      {
                        node: {
                          from: "2026-05-29T08:00:00+02:00",
                          to: "2026-05-29T09:00:00+02:00",
                          total: {
                            volumeNumbers: { volume: 1000 },
                            coverage: { percentage: 80 },
                          },
                        },
                      },
                      {
                        node: {
                          from: "2026-05-29T09:00:00+02:00",
                          to: "2026-05-29T10:00:00+02:00",
                          total: {
                            volumeNumbers: { volume: 1234 },
                            coverage: { percentage: 98 },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const counters = await fetchTrafikkdataCounterSnapshots({
      endpoint: "https://trafikkdata.example.test/graphql",
      fetcher,
      now: () => new Date("2026-05-29T10:00:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetcher.mock.calls[0]!;
    const [secondUrl, secondInit] = fetcher.mock.calls[1]!;
    const firstHeaders = new Headers(firstInit?.headers);
    expect(firstUrl).toBe("https://trafikkdata.example.test/graphql");
    expect(firstInit).toMatchObject({
      method: "POST",
      body: expect.stringContaining("trafficRegistrationPoints"),
    });
    expect(firstInit?.signal).toBeTruthy();
    expect(firstHeaders.get("Content-Type")).toBe("application/json");
    expect(secondUrl).toBe("https://trafikkdata.example.test/graphql");
    expect(secondInit?.body).toEqual(expect.stringContaining("trafficData"));
    expect(secondInit?.signal).toBeTruthy();
    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({
      pointId: "06970V72811",
      updatedAt: "2026-05-29T10:00:00+02:00",
      volumeLastHour: 1234,
      coveragePercent: 98,
    });
  });

  it("uses the public Trafikkdata endpoint by default and surfaces GraphQL errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: "bad query" }] }), { status: 200 }),
      );

    await expect(fetchTrafikkdataCounterSnapshots({ fetcher })).rejects.toThrow("bad query");
    expect(fetcher.mock.calls[0]?.[0]).toBe(defaultTrafikkdataGraphqlEndpoint);
  });
});
