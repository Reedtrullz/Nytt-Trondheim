import type { RankedTrafficEventModel } from "../../trafficViewModel.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrafficEventList } from "./TrafficEventList.js";

const rankedEvents: RankedTrafficEventModel[] = [
  {
    id: "event-1",
    title: "E6 Omkjøring ved Sluppen",
    meta: "Stengt vei · Statens vegvesen · Oppdatert 18:42 · påvirker reisetid +12 min",
    badges: ["OFFISIELL"],
    score: 1500,
    event: {
      id: "event-1",
      source: "datex",
      sourceEventId: "event-1",
      category: "closure",
      severity: "critical",
      state: "active",
      title: "E6 Omkjøring ved Sluppen",
      updatedAt: "2026-06-01T16:42:00.000Z",
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
    },
  },
];

describe("TrafficEventList", () => {
  it("renders ranked rows with trust badges and progressive disclosure copy", () => {
    const html = renderToStaticMarkup(
      <TrafficEventList
        rankedEvents={rankedEvents}
        selectedEventId="event-1"
        onSelectEvent={vi.fn()}
        showAll={false}
        onShowAllChange={vi.fn()}
      />,
    );

    expect(html).toContain("Aktive trafikksituasjoner");
    expect(html).toContain("E6 Omkjøring ved Sluppen");
    expect(html).toContain("OFFISIELL");
    expect(html).toContain("Vis alle");
  });
});
