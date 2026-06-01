import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrafficLegend } from "./TrafficLegend.js";

describe("TrafficLegend", () => {
  it("explains official, estimated, traffic-pulse and context badges", () => {
    const html = renderToStaticMarkup(<TrafficLegend />);

    expect(html).toContain("Tegnforklaring");
    expect(html).toContain("OFFISIELL");
    expect(html).toContain("ESTIMERT");
    expect(html).toContain("REISETID");
    expect(html).toContain("VARSELKONTEKST");
    expect(html).toContain("KOLLEKTIV");
    expect(html).toContain("Linje = berørt veg/korridor");
  });
});
