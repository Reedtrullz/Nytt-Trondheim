import { describe, expect, it } from "vitest";
import {
  sourceIdLabel,
  sourceItemKindLabel,
  sourceItemRelationshipLabel,
  sourceReliabilityTierLabel,
} from "../src/source-labels.js";

describe("source display labels", () => {
  it("renders user-facing labels for source item metadata", () => {
    expect(sourceIdLabel("nrk")).toBe("NRK");
    expect(sourceIdLabel("vegvesen_traffic_info")).toBe("Statens vegvesen trafikk");
    expect(sourceItemKindLabel("official_event")).toBe("Offisiell hendelse");
    expect(sourceReliabilityTierLabel("trusted_media")).toBe("Redaksjonell kilde");
    expect(sourceItemRelationshipLabel("context")).toBe("Kontekst");
  });

  it("falls back to raw values for future source metadata values", () => {
    expect(sourceIdLabel("future_source")).toBe("future_source");
    expect(sourceItemKindLabel("future_kind")).toBe("future_kind");
    expect(sourceReliabilityTierLabel("future_tier")).toBe("future_tier");
    expect(sourceItemRelationshipLabel("future_relationship")).toBe("future_relationship");
  });
});
