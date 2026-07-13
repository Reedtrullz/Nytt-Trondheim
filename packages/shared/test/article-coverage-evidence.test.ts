import { describe, expect, it } from "vitest";
import type { Article } from "../src/index.js";
import { articleCoverageEvidence } from "../src/index.js";

function article(id: string, overrides: Partial<Article>): Article {
  return {
    id,
    source: "nrk",
    sourceLabel: "NRK Trøndelag",
    title: id,
    excerpt: "",
    url: `https://example.test/${id}`,
    publishedAt: "2026-07-12T20:00:00.000Z",
    scope: "trondelag",
    category: "Hendelser",
    places: ["Trøndelag"],
    ...overrides,
  };
}

describe("v2 pair evidence", () => {
  it("does not treat generic order words as positive place or entity evidence", () => {
    const evidence = articleCoverageEvidence(
      article("speed", {
        title: "Ungdommer kjørte i nær 200",
        excerpt: "Politiet har kontroll på ungdommene.",
        places: ["Orkland"],
      }),
      article("threat", {
        title: "Mann pågrepet etter trusselsituasjon",
        excerpt: "Politiet har kontroll etter at ungdom tok kontakt.",
        places: ["Selbu"],
      }),
      "v2",
    );
    expect(evidence.positiveIncidentEvidence).toEqual([]);
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "specific_place" })]),
    );
  });

  it("distinguishes construction fire from cooking smoke", () => {
    const evidence = articleCoverageEvidence(
      article("construction", {
        title: "Brann i brakke på byggeplass",
        excerpt: "En anleggsbrakke brant i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("cooking", {
        title: "Stekte middag med plasten på",
        excerpt: "Matlaging førte til røyk i en bolig.",
        places: ["Møllenberg", "Trondheim"],
      }),
      "v2",
    );
    expect(evidence.incidentSubtypes).toEqual(["construction_fire", "cooking_smoke"]);
    expect(evidence.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "incident_subtype" })]),
    );
  });

  it("accepts shared specific place plus compatible construction-fire subtype", () => {
    const evidence = articleCoverageEvidence(
      article("left", {
        title: "Brann i brakke på byggeplass",
        excerpt: "Anleggsbrakka brant i Nærøysund.",
        places: ["Nærøysund"],
      }),
      article("right", {
        title: "Nødetatene til brakkebrann",
        excerpt: "Brannvesenet fikk kontroll på byggeplassen i Nærøysund.",
        places: ["Nærøysund"],
      }),
      "v2",
    );
    expect(evidence.positiveIncidentEvidence).toEqual(
      expect.arrayContaining(["shared_specific_place", "compatible_incident_subtype"]),
    );
    expect(evidence.conflicts).toEqual([]);
  });
});
