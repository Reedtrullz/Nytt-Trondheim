import { describe, expect, it } from "vitest";
import { collectMetWarnings, collectNveWarnings, officialId } from "../src/official.js";

describe("official warning collection", () => {
  it("retains RSS geometry and CAP cancellation provenance once per MET identifier", async () => {
    const rss = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:georss="http://www.georss.org/georss"><channel><item>
        <title>Skogbrannfare i Trøndelag</title>
        <description>Fare i området.</description>
        <link>https://api.met.no/weatherapi/metalerts/2.0/current?cap=cap-1</link>
        <guid>cap-1</guid>
        <pubDate>Tue, 26 May 2026 10:00:00 +0000</pubDate>
        <georss:polygon>63 10 63 11 64 11 63 10</georss:polygon>
      </item></channel></rss>`;
    const cap = `<?xml version="1.0"?>
      <alert>
        <identifier>cap-1</identifier><sent>2026-05-26T10:00:00Z</sent><msgType>Cancel</msgType>
        <references>met.no,cap-original,2026-05-25T10:00:00Z</references>
        <info><event>forestFire</event><headline>Skogbrannfare</headline>
          <description>Fare i området.</description><severity>Moderate</severity>
          <onset>2026-05-26T10:00:00Z</onset><expires>2026-05-27T10:00:00Z</expires>
          <area><areaDesc>Trøndelag</areaDesc></area>
        </info>
      </alert>`;
    const events = await collectMetWarnings(async (url) =>
      String(url).includes("current.rss")
        ? new Response(rss, { status: 200 })
        : new Response(cap, { status: 200 }),
    );
    expect(events[0]?.eventType).toBe("fire");
    expect(events[0]?.state).toBe("cancelled");
    expect(events[0]?.geometry?.type).toBe("Polygon");
    expect(events[0]?.replacesIds).toEqual([officialId("met", "cap-original")]);

    const alreadyStored = await collectMetWarnings(
      async (url) =>
        String(url).includes("current.rss")
          ? new Response(rss, { status: 200 })
          : new Response(cap, { status: 200 }),
      new Set([officialId("met", "cap-1")]),
    );
    expect(alreadyStored[0]?.id).toBe(officialId("met", "cap-1"));
    expect(alreadyStored[0]?.state).toBe("cancelled");
  });

  it("stores only raised NVE municipality warning levels as textual official context", async () => {
    const events = await collectNveWarnings(async () =>
      Response.json([
        {
          Id: "nve-1",
          MasterId: "nve",
          ActivityLevel: "2",
          MainText: "Gult nivå",
          WarningText: "Fare for flom.",
          CapStatus: "actual",
          PublishTime: "2026-05-26T10:00:00Z",
          ValidFrom: "2026-05-26T10:00:00Z",
          ValidTo: "2026-05-27T10:00:00Z",
        },
        { ActivityLevel: "1" },
      ]),
    );
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.geometry === undefined)).toBe(true);
    expect(events[0]?.areaLabel).toBe("Trondheim");
    expect(events.map((event) => event.eventType)).toEqual(["flood", "landslide"]);
  });
});
