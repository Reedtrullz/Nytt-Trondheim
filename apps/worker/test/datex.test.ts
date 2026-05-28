import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { OfficialEvent, Situation } from "@nytt/shared";
import { parseDatexSituationPublication } from "../src/datex.js";

const fixturePath = new URL("./fixtures/datex-situation-snapshot.xml", import.meta.url);

// Compile-time guard from Task 1.
const _datexEventTypeCheck = {
  id: "datex-test",
  source: "datex",
  eventType: "traffic",
  title: "E6 stengt",
  detail: "Stengt ved Tiller",
  sourceUrl:
    "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata",
  areaLabel: "Tiller",
  state: "active",
  publishedAt: "2026-05-28T10:00:00.000Z",
  validFrom: "2026-05-28T10:00:00.000Z",
  validTo: "2026-05-28T12:00:00.000Z",
  raw: {},
} satisfies OfficialEvent;

const _officialActivationTypeCheck = {
  activationBasis: {
    rule: "official_source",
    sourceIds: ["datex"],
    articleIds: [],
    activatedAt: "2026-05-28T10:00:00.000Z",
  },
} satisfies Pick<Situation, "activationBasis">;

void _datexEventTypeCheck;
void _officialActivationTypeCheck;

describe("DATEX situation parsing", () => {
  it("converts a relevant active accident into an official traffic event", async () => {
    const xml = await readFile(fixturePath, "utf8");

    const result = parseDatexSituationPublication(xml, {
      endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
      receivedAt: "2026-05-28T10:05:00.000Z",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "datex",
      eventType: "traffic",
      title: "Trafikkulykke på E6 ved Tiller",
      state: "active",
      areaLabel: "E6 Tiller",
      severity: "high",
      publishedAt: "2026-05-28T10:00:00.000Z",
      validFrom: "2026-05-28T09:55:00.000Z",
      validTo: "2026-05-28T12:00:00.000Z",
    });
    expect(result.events[0]?.geometry).toEqual({ type: "Point", coordinates: [10.376, 63.361] });
    expect(result.events[0]?.raw).toMatchObject({
      datex: { situationId: "NO-SVV-1", recordId: "NO-SVV-1-R1", roadNumber: "E6" },
    });
  });
});
