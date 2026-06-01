import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficialEvent, RoadWeatherObservation, SourceHealth } from "@nytt/shared";
import { createApp } from "../src/app.js";

async function testApp() {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-weather-"));
  const runtime = await createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: true,
  });
  return { ...runtime, uploadDir };
}

const sourceHealth: SourceHealth[] = [
  {
    source: "met",
    label: "MET farevarsel",
    state: "ok",
    detail: "1 aktivt farevarsel",
    lastCheckedAt: "2026-06-01T08:00:00.000Z",
  },
  {
    source: "nve",
    label: "NVE/Varsom",
    state: "ok",
    detail: "Flom- og jordskredvarsel hentet",
    lastCheckedAt: "2026-06-01T08:01:00.000Z",
  },
  {
    source: "datex_weather",
    label: "Vegvesen værstasjoner",
    state: "ok",
    detail: "2 værstasjoner",
    lastCheckedAt: "2026-06-01T08:02:00.000Z",
  },
];

function officialEvent(overrides: Partial<OfficialEvent>): OfficialEvent {
  return {
    id: "met-rain",
    source: "met",
    eventType: "weather",
    title: "Kraftig regn",
    detail: "Lokalt mye regn. Overvann kan forekomme.",
    sourceUrl: "https://api.met.no/weatherapi/metalerts/2.0/current.rss",
    areaLabel: "Trøndelag",
    state: "active",
    severity: "yellow",
    publishedAt: "2026-06-01T06:00:00.000Z",
    validFrom: "2026-06-01T07:00:00.000Z",
    validTo: "2026-06-02T09:00:00.000Z",
    raw: {},
    ...overrides,
  };
}

const roadWeather: RoadWeatherObservation[] = [
  {
    id: "datex-weather:e6-tonstad",
    source: "datex_weather",
    stationId: "e6-tonstad",
    stationName: "E6 Tonstad",
    observedAt: "2026-06-01T08:03:00.000Z",
    updatedAt: "2026-06-01T08:04:00.000Z",
    geometry: { type: "Point", coordinates: [10.39, 63.36] },
    airTemperatureC: 7,
    roadSurfaceTemperatureC: 1.5,
    precipitationMm: 1.8,
    windSpeedMps: 6,
    rawSummary: "Våt vegbane og fare for glatt føre i høyden",
  },
];

const metLocationforecastPayload = {
  properties: {
    meta: { updated_at: "2026-06-01T08:00:00.000Z" },
    timeseries: [
      {
        time: "2026-06-01T08:00:00.000Z",
        data: {
          instant: { details: { air_temperature: 7.4, wind_speed: 8.2, wind_from_direction: 220 } },
          next_1_hours: {
            summary: { symbol_code: "rain" },
            details: { precipitation_amount: 2.4 },
          },
        },
      },
      {
        time: "2026-06-01T09:00:00.000Z",
        data: {
          instant: { details: { air_temperature: 8, wind_speed: 7 } },
          next_1_hours: {
            summary: { symbol_code: "rain" },
            details: { precipitation_amount: 1.1 },
          },
        },
      },
    ],
  },
};

describe("weather preparedness API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("combines MET forecast, official warnings, NVE warnings and Vegvesen road weather into a source-labeled preparedness desk", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ Expires: "Mon, 01 Jun 2026 08:30:00 GMT" }),
      json: async () => metLocationforecastPayload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    const listOfficialEvents = vi.spyOn(store, "listOfficialEvents").mockResolvedValue([
      officialEvent({ source: "met", title: "MET farevarsel: Kraftig regn", severity: "yellow" }),
      officialEvent({
        id: "nve-flood",
        source: "nve",
        eventType: "flood",
        title: "NVE flomvarsel",
        severity: "orange",
        areaLabel: "Trondheim",
        detail: "Økt vannføring og lokale oversvømmelser.",
      }),
    ]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue(roadWeather);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const response = await request(app).get("/api/weather/preparedness").expect(200);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=63.4305&lon=10.3951",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("NyttTrondheim"),
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(response.body.current.summary).toContain("MET Locationforecast");
    expect(listOfficialEvents.mock.calls[0]?.[0]).not.toHaveProperty("limit");
    expect(response.body.risks.map((risk: { label: string }) => risk.label)).toEqual([
      "Nedbør",
      "Vind",
      "Flom/skred",
      "Føre",
      "Strøm/tele",
      "Helse",
    ]);
    expect(
      response.body.risks.find((risk: { label: string }) => risk.label === "Nedbør"),
    ).toMatchObject({
      source: "MET Locationforecast + MET farevarsel",
      level: "warning",
    });
    expect(
      response.body.risks.find((risk: { label: string }) => risk.label === "Flom/skred"),
    ).toMatchObject({
      source: "NVE/Varsom",
      level: "severe",
    });
    expect(response.body.actions.map((action: { title: string }) => action.title)).toContain(
      "Rens sluk og hold avrenning åpen",
    );
    expect(response.body.actions.map((action: { title: string }) => action.title)).toContain(
      "Sjekk sårbare naboer og egenberedskap",
    );
    expect(response.body.authority.emergencyAlertStatus).toContain(
      "Nytt er ikke koblet til Nødvarsel",
    );
    expect(response.body.authority.civilDefenceDetail).toContain("Sivilforsvaret støtter");
    expect(response.body.impactGroups.map((group: { group: string }) => group.group)).toEqual([
      "Innbyggere",
      "Transport",
      "Helse",
      "Skole/arrangement",
      "Beredskap",
    ]);
    expect(response.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceLabel: "MET farevarsel" }),
        expect.objectContaining({ sourceLabel: "NVE flomvarsel" }),
      ]),
    );
    expect(response.body.mapLayers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "MET warning polygons",
          source: "MET",
          status: "planned",
        }),
        expect.objectContaining({
          title: "Vegvesen road-weather stations",
          source: "Statens vegvesen DATEX",
        }),
      ]),
    );
  });

  it("uses real NVE numeric levels and MET warning levels without inventing emergency status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ Expires: "Mon, 01 Jun 2020 08:30:00 GMT" }),
        json: async () => metLocationforecastPayload,
      }),
    );

    const { app, store } = await testApp();
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([
      officialEvent({
        id: "met-red-rain",
        source: "met",
        title: "MET farevarsel: Kraftig regn",
        severity: "red",
      }),
      officialEvent({
        id: "nve-level-three",
        source: "nve",
        eventType: "flood",
        title: "NVE flomvarsel",
        severity: "Nivå 3",
        areaLabel: "Trondheim",
      }),
    ]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const response = await request(app).get("/api/weather/preparedness").expect(200);

    expect(
      response.body.risks.find((risk: { label: string }) => risk.label === "Flom/skred"),
    ).toMatchObject({
      status: "NVE flomvarsel: Oransje",
      level: "severe",
    });
    expect(response.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "nve-level-three", level: "Oransje" }),
        expect.objectContaining({ id: "met-red-rain", level: "Rødt" }),
      ]),
    );
    expect(
      response.body.actions.find((action: { id: string }) => action.id === "rain-drains"),
    ).toMatchObject({ detail: expect.stringContaining("Rødt regnvarsel") });
    expect(response.body.authority.emergencyAlertStatus).not.toContain("registrert");
  });

  it("uses the most severe active warning instead of the newest lower-level warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ Expires: "Mon, 01 Jun 2020 08:30:00 GMT" }),
        json: async () => metLocationforecastPayload,
      }),
    );

    const { app, store } = await testApp();
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([
      officialEvent({
        id: "met-new-orange-rain",
        source: "met",
        title: "MET farevarsel: Regn",
        severity: "orange",
        publishedAt: "2026-06-01T09:00:00.000Z",
      }),
      officialEvent({
        id: "met-old-red-rain",
        source: "met",
        title: "MET farevarsel: Kraftig regn",
        severity: "red",
        publishedAt: "2026-06-01T06:00:00.000Z",
      }),
      officialEvent({
        id: "nve-new-level-three",
        source: "nve",
        eventType: "flood",
        title: "NVE flomvarsel",
        severity: "Nivå 3",
        publishedAt: "2026-06-01T09:10:00.000Z",
      }),
      officialEvent({
        id: "nve-old-level-four",
        source: "nve",
        eventType: "flood",
        title: "NVE flomvarsel",
        severity: "Nivå 4",
        publishedAt: "2026-06-01T05:00:00.000Z",
      }),
    ]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const response = await request(app).get("/api/weather/preparedness").expect(200);

    expect(
      response.body.risks.find((risk: { label: string }) => risk.label === "Nedbør"),
    ).toMatchObject({ status: expect.stringContaining("Rødt"), level: "severe" });
    expect(
      response.body.risks.find((risk: { label: string }) => risk.label === "Flom/skred"),
    ).toMatchObject({ status: "NVE flomvarsel: Rødt", level: "severe" });
    expect(
      response.body.actions.find((action: { id: string }) => action.id === "rain-drains"),
    ).toMatchObject({ detail: expect.stringContaining("Rødt regnvarsel") });
  });

  it("maps real MET CAP severity values before recency when choosing rain risk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ Expires: "Mon, 01 Jun 2020 08:30:00 GMT" }),
        json: async () => metLocationforecastPayload,
      }),
    );

    const { app, store } = await testApp();
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([
      officialEvent({
        id: "met-new-moderate-rain",
        source: "met",
        title: "MET farevarsel: Regn",
        severity: "Moderate",
        publishedAt: "2026-06-01T09:00:00.000Z",
      }),
      officialEvent({
        id: "met-old-severe-rain",
        source: "met",
        title: "MET farevarsel: Kraftig regn",
        severity: "Severe",
        publishedAt: "2026-06-01T06:00:00.000Z",
      }),
    ]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const response = await request(app).get("/api/weather/preparedness").expect(200);

    expect(
      response.body.risks.find((risk: { label: string }) => risk.label === "Nedbør"),
    ).toMatchObject({ status: expect.stringContaining("Oransje"), level: "severe" });
    expect(response.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "met-old-severe-rain", level: "Oransje" }),
      ]),
    );
    expect(
      response.body.actions.find((action: { id: string }) => action.id === "rain-drains"),
    ).toMatchObject({ detail: expect.stringContaining("Oransje regnvarsel") });
  });

  it("falls back quickly when MET Locationforecast fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Timed out", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    const { app, store } = await testApp();
    vi.spyOn(store, "listOfficialEvents").mockResolvedValue([]);
    vi.spyOn(store, "listRoadWeatherObservations").mockResolvedValue([]);
    vi.spyOn(store, "listSourceHealth").mockResolvedValue(sourceHealth);

    const response = await request(app).get("/api/weather/preparedness").expect(200);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=63.4305&lon=10.3951",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(response.body.current.summary).toBe("MET Locationforecast: midlertidig utilgjengelig");
  });
});
