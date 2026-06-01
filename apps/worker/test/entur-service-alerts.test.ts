import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  enturServiceAlertSourceItemInput,
  fetchEnturServiceAlerts,
  parseEnturServiceAlerts,
} from "../src/enturServiceAlerts.js";

const fixturePath = new URL("./fixtures/entur-service-alerts-atb.json", import.meta.url);

describe("Entur service alerts", () => {
  it("normalizes service alerts with stable identity and affected stop geometry", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturServiceAlerts(payload, {
      codespaceId: "ATB",
      receivedAt: "2026-05-31T21:15:00.000Z",
    });

    expect(result.alerts[0]).toMatchObject({
      id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
      source: "entur_service_alerts",
      situationNumber: "ATB:SituationNumber:24982-stopPoint",
      state: "active",
      summary: "Rota - bussholdeplassen er midlertidig flyttet",
      geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
      affectedStopNames: ["Rota"],
    });
    expect(
      result.rawAlertsBySituationNumber.get("ATB:SituationNumber:24982-stopPoint"),
    ).toBeTruthy();
  });

  it("preserves multiple affected stop coordinates as MultiPoint", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturServiceAlerts(payload, {
      codespaceId: "ATB",
      receivedAt: "2026-05-31T21:15:00.000Z",
    });
    const multiStopAlert = result.alerts.find(
      (alert) => alert.situationNumber === "ATB:SituationNumber:multi-stop-test",
    );

    expect(multiStopAlert?.geometry).toEqual({
      type: "MultiPoint",
      coordinates: [
        [10.3951, 63.4305],
        [10.4046, 63.3708],
      ],
    });
  });

  it("prefers null-language service alert text before non-Norwegian fallback", () => {
    const payload = JSON.stringify({
      data: {
        situations: [
          {
            id: "ATB:SituationNumber:null-language",
            summary: [
              { value: "English fallback", language: "en" },
              { value: "Norsk uten språkfelt", language: null },
            ],
            creationTime: "2026-05-31T20:00:00.000Z",
          },
        ],
      },
    });

    const result = parseEnturServiceAlerts(payload, {
      codespaceId: "ATB",
      receivedAt: "2026-05-31T21:15:00.000Z",
    });

    expect(result.alerts[0]?.summary).toBe("Norsk uten språkfelt");
  });

  it("mirrors service alerts to source_items with raw upstream payload", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const result = parseEnturServiceAlerts(payload, {
      codespaceId: "ATB",
      receivedAt: "2026-05-31T21:15:00.000Z",
    });
    const alert = result.alerts[0]!;
    const item = enturServiceAlertSourceItemInput(alert, {
      fetchedAt: "2026-05-31T21:15:00.000Z",
      rawAlert: result.rawAlertsBySituationNumber.get(alert.situationNumber)!,
    });

    expect(item).toMatchObject({
      provider: "entur",
      kind: "official_event",
      externalId: `${alert.codespaceId}:${alert.situationNumber}`,
      title: alert.summary,
      reliabilityTier: "official",
      geoHint: alert.geometry,
    });
    expect(item.rawPayload).toEqual(result.rawAlertsBySituationNumber.get(alert.situationNumber));
  });

  it("queries Entur service-alert stop places and lines from PtSituationElement fields", async () => {
    let requestBody = "";
    const fetcher = (async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          data: {
            situations: [
              {
                id: "situation-live-shape",
                situationNumber: "ATB:SituationNumber:live-shape",
                creationTime: "2026-05-31T20:00:00Z",
                summary: [{ language: "no", value: "Live shape" }],
                stopPlaces: [
                  {
                    id: "NSR:StopPlace:1",
                    name: "Sentrum",
                    latitude: 63.4305,
                    longitude: 10.3951,
                  },
                ],
                lines: [{ id: "ATB:Line:2_3", publicCode: "3", name: "Linje 3" }],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await fetchEnturServiceAlerts({
      endpoint: "https://example.test/graphql",
      clientName: "nytt-test",
      codespaceId: "ATB",
      receivedAt: "2026-05-31T21:15:00.000Z",
      fetcher,
    });

    const body = JSON.parse(requestBody) as { query: string };
    expect(body.query).toContain("stopPlaces {");
    expect(body.query).toContain("lines {");
    expect(body.query).not.toMatch(/\baffects\s*\{/);
    expect(result.alerts[0]).toMatchObject({
      situationNumber: "ATB:SituationNumber:live-shape",
      affectedStopNames: ["Sentrum"],
      affectedLineNames: ["Linje 3"],
      geometry: { type: "Point", coordinates: [10.3951, 63.4305] },
    });
  });
});
