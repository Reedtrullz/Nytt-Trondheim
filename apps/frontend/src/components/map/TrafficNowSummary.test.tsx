import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrafficNowSummary } from "./TrafficNowSummary.js";
import type { TrafficSummaryCardModel } from "../../trafficViewModel.js";

const cards: TrafficSummaryCardModel[] = [
  {
    id: "critical",
    title: "Kritisk",
    count: 2,
    detail: "E6 stengt",
    badge: "OFFISIELL",
    severity: "critical",
  },
  {
    id: "delays",
    title: "Forsinkelser",
    count: 1,
    detail: "E6 Sluppen: +8 min",
    badge: "REISETID",
    severity: "medium",
  },
  {
    id: "roadworks",
    title: "Veiarbeid",
    count: 7,
    detail: "Omkjøringsvegen",
    badge: "OFFISIELL",
    severity: "medium",
  },
  {
    id: "publicTransport",
    title: "Kollektiv",
    count: 3,
    detail: "Linje 3",
    badge: "KOLLEKTIV",
    severity: "medium",
  },
  { id: "updated", title: "Oppdatert", count: 4, detail: "Sist hentet 18:42" },
];

describe("TrafficNowSummary", () => {
  it("renders compact top cards with badges", () => {
    const html = renderToStaticMarkup(<TrafficNowSummary cards={cards} />);

    expect(html).toContain("Nå i trafikken");
    expect(html).toContain("Kritisk");
    expect(html).toContain("OFFISIELL");
    expect(html).toContain("REISETID");
    expect(html).toContain("Sist hentet 18:42");
  });
});
