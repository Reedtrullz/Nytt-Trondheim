import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { OfficialEvent, Situation } from "@nytt/shared";
import {
  asDatexArray,
  datexText,
  findDatexObjectsWithKey,
  parseDatexSituationPublication,
} from "../src/datex.js";

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
  it("normalizes DATEX singleton arrays and text wrappers", () => {
    expect(asDatexArray(undefined)).toEqual([]);
    expect(asDatexArray("one")).toEqual(["one"]);
    expect(asDatexArray(["one", "two"])).toEqual(["one", "two"]);
    expect(datexText({ "#text": "Tiller" })).toBe("Tiller");
    expect(datexText(63.361)).toBe("63.361");
  });

  it("finds nested DATEX objects by key after namespace removal", () => {
    const tree = { root: { payloadPublication: { situation: [{ id: "one" }] } } };
    expect(findDatexObjectsWithKey(tree, "situation")).toEqual([{ situation: [{ id: "one" }] }]);
  });

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

  it("keeps the same official event id across DATEX record version updates", async () => {
    const xml = await readFile(fixturePath, "utf8");
    const updated = xml.replaceAll('version="3"', 'version="4"');

    const first = parseDatexSituationPublication(xml, {
      endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
      receivedAt: "2026-05-28T10:05:00.000Z",
    });
    const second = parseDatexSituationPublication(updated, {
      endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
      receivedAt: "2026-05-28T10:10:00.000Z",
    });

    expect(second.events[0]?.id).toBe(first.events[0]?.id);
    expect(second.events[0]?.raw).toMatchObject({ datex: { version: "4" } });
  });

  it("uses receivedAt as fallback expiry for open-ended active records", () => {
    const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-OPEN" version="1"><situationRecord xsi:type="Accident" id="R1" version="1"><situationRecordCreationTime>2026-05-26T09:55:00Z</situationRecordCreationTime><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><validity><validityStatus>active</validityStatus><validityTimeSpecification><overallStartTime>2026-05-26T09:55:00Z</overallStartTime></validityTimeSpecification></validity><groupOfLocations><locationForDisplay><latitude>63.361</latitude><longitude>10.376</longitude></locationForDisplay></groupOfLocations><generalPublicComment><comment><values><value>Ulykke på E6 ved Tiller.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;
    const result = parseDatexSituationPublication(xml, {
      endpoint: "https://datex.example.test/datexapi/GetSituation/pullsnapshotdata",
      receivedAt: "2026-05-28T10:05:00.000Z",
    });

    expect(new Date(result.events[0]!.validTo).getTime()).toBeGreaterThan(
      new Date("2026-05-28T10:05:00.000Z").getTime(),
    );
  });

  it("drops DATEX events outside Trøndelag when no local text is present", () => {
    const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-OSLO" version="1"><situationRecord id="R1" version="1"><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><validity><validityStatus>active</validityStatus></validity><groupOfLocations><locationForDisplay><latitude>59.91</latitude><longitude>10.75</longitude></locationForDisplay></groupOfLocations><generalPublicComment><comment><values><value>Ulykke på Ring 3.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;

    const result = parseDatexSituationPublication(xml, {
      endpoint: "https://datex.example.test",
      receivedAt: "2026-05-28T10:05:00.000Z",
    });

    expect(result.events).toEqual([]);
  });

  it("keeps DATEX events with local Trondheim text even when coordinates are missing", () => {
    const xml = `<?xml version="1.0"?><d2LogicalModel><payloadPublication><publicationTime>2026-05-28T10:00:00Z</publicationTime><situation id="NO-SVV-TRD" version="1"><situationRecord id="R1" version="1"><situationRecordVersionTime>2026-05-28T10:00:00Z</situationRecordVersionTime><validity><validityStatus>active</validityStatus></validity><generalPublicComment><comment><values><value>Vegarbeid i Trondheim sentrum.</value></values></comment></generalPublicComment></situationRecord></situation></payloadPublication></d2LogicalModel>`;

    const result = parseDatexSituationPublication(xml, {
      endpoint: "https://datex.example.test",
      receivedAt: "2026-05-28T10:05:00.000Z",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.areaLabel).toBe("Vegtrafikk");
  });
});
