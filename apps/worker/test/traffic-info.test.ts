import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  defaultTrafficInfoEndpoint,
  parseTrafficInfoMessages,
  trafficInfoRequestHeaders,
} from "../src/vegvesenTrafficInfo.js";

const fixturePath = new URL("./fixtures/vegvesen-traffic-info-messages.json", import.meta.url);

describe("Vegvesen TrafficInfo", () => {
  it("uses the TrafficInfo API contract Vegvesen's map uses", () => {
    expect(defaultTrafficInfoEndpoint).toBe(
      "https://traffic-info.atlas.vegvesen.no/traffic-information/messages?sort=priorityScore&lang=no",
    );
    expect(trafficInfoRequestHeaders()).toMatchObject({
      accept: "application/vnd.svv.v2+json; charset=utf-8",
      "X-System-ID": "vvtraf",
    });
  });

  it("normalizes relevant Trondheim messages into traffic map events", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const parsedPayload = JSON.parse(payload) as { trafficMessages: Array<Record<string, unknown>> };
    const result = parseTrafficInfoMessages(payload, {
      endpoint: defaultTrafficInfoEndpoint,
      receivedAt: "2026-05-29T11:15:00.000Z",
    });

    expect(result.events).toHaveLength(2);
    const activeEvent = result.events.find(
      (event) => event.sourceEventId === "NPRA_HBT_21-04-2026.66010",
    );
    expect(activeEvent).toMatchObject({
      id: "vegvesen-traffic-info:NPRA_HBT_21-04-2026.66010",
      source: "vegvesen_traffic_info",
      sourceEventId: "NPRA_HBT_21-04-2026.66010",
      category: "roadworks",
      severity: "medium",
      state: "active",
      title: "Fv. 6650 Vestre Kystad - avkjøringsveg Kystad helse- og velferdssenter, Trondheim, Trøndelag",
      description: "Lysregulering.",
      roadName: "F6650",
      validFrom: "2026-04-21T05:00:00.000Z",
      validTo: "2026-06-26T14:00:00.000Z",
      updatedAt: "2026-05-07T04:59:25.000Z",
      geometry: { type: "Point", coordinates: [10.345405, 63.38945] },
      rawType: "roadworks",
    });
    const plannedEvent = result.events.find(
      (event) => event.sourceEventId === "NPRA_HBT_19-05-2026.80670",
    );
    expect(plannedEvent).toMatchObject({
      state: "planned",
      category: "roadworks",
      severity: "medium",
      roadName: "K4295",
      validFrom: "2026-06-01T05:00:00.000Z",
      validTo: "2026-06-05T13:00:00.000Z",
    });
    expect(result.sourcePayloadHash).toBe(createHash("sha256").update(payload).digest("hex"));
    const originalRawMessage = parsedPayload.trafficMessages.find(
      (message) => message.id === "NPRA_HBT_21-04-2026.66010",
    );
    expect(originalRawMessage).toBeDefined();
    expect(result.rawMessagesById.get("NPRA_HBT_21-04-2026.66010")).toEqual(originalRawMessage);
  });

  it("skips messages with missing IDs or malformed geometry and keeps outside-region messages out of Nytt's traffic map table", async () => {
    const payload = await readFile(fixturePath, "utf8");
    const parsedPayload = JSON.parse(payload) as { trafficMessages: Array<Record<string, unknown>> };
    const [baseMessage] = parsedPayload.trafficMessages;
    const missingIdTitle = "Missing ID Trondheim test message";
    const malformedGeometryId = "NPRA_HBT_MALFORMED_GEOMETRY";

    parsedPayload.trafficMessages.push(
      {
        ...baseMessage,
        id: "",
        locationDescriptionDetails: { simpleLocationDescription: missingIdTitle },
        icon: { position: { type: "Point", coordinates: [10.345405, 63.38945] } },
      },
      {
        ...baseMessage,
        id: malformedGeometryId,
        locationDescriptionDetails: {
          simpleLocationDescription: "Malformed geometry Trondheim test message",
        },
        icon: { position: { type: "Point", coordinates: [10.345405] } },
      },
    );

    const mutatedPayload = JSON.stringify(parsedPayload);
    const result = parseTrafficInfoMessages(mutatedPayload, {
      endpoint: defaultTrafficInfoEndpoint,
      receivedAt: "2026-05-29T11:15:00.000Z",
    });

    const sourceEventIds = result.events.map((event) => event.sourceEventId);
    expect(result.events).toHaveLength(2);
    expect(sourceEventIds).toEqual(
      expect.arrayContaining(["NPRA_HBT_21-04-2026.66010", "NPRA_HBT_19-05-2026.80670"]),
    );
    expect(sourceEventIds).not.toContain("NPRA_HBT_OSLO");
    expect(sourceEventIds).not.toContain("");
    expect(sourceEventIds).not.toContain(malformedGeometryId);
    expect(result.events.map((event) => event.title)).not.toContain(missingIdTitle);
  });
});
