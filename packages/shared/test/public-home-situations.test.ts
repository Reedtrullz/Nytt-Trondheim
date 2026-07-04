import { describe, expect, it } from "vitest";
import {
  publicLeadLongRunningSituationAgeMs,
  shouldFeaturePublicHomeSituation,
  type PublicHomeSituationFilterInput,
} from "../src/public-home-situations.js";

const generatedAt = new Date("2026-07-04T12:00:00.000Z");

function publicHomeSituation(
  overrides: Partial<PublicHomeSituationFilterInput> = {},
): PublicHomeSituationFilterInput {
  return {
    createdAt: "2026-07-04T10:00:00.000Z",
    locationLabel: "Trondheim",
    status: "active",
    summary: "Kort status.",
    title: "Lokal hendelse",
    type: "fire",
    publicVisibility: "public",
    ...overrides,
  };
}

describe("public home situation filtering", () => {
  it("treats the seven-day traffic/nature cutoff as exclusive", () => {
    const exactlySevenDaysOld = new Date(
      generatedAt.getTime() - publicLeadLongRunningSituationAgeMs,
    ).toISOString();
    const justOlderThanSevenDays = new Date(
      generatedAt.getTime() - publicLeadLongRunningSituationAgeMs - 1,
    ).toISOString();

    expect(
      shouldFeaturePublicHomeSituation(
        publicHomeSituation({
          createdAt: exactlySevenDaysOld,
          summary: "Vegen er stengt og omkjøring er skiltet.",
          type: "traffic",
        }),
        generatedAt,
      ),
    ).toBe(true);
    expect(
      shouldFeaturePublicHomeSituation(
        publicHomeSituation({
          createdAt: justOlderThanSevenDays,
          summary: "Vegen er stengt og omkjøring er skiltet.",
          type: "traffic",
        }),
        generatedAt,
      ),
    ).toBe(false);
  });

  it("keeps invalid timestamps visible instead of silently hiding them", () => {
    expect(
      shouldFeaturePublicHomeSituation(
        publicHomeSituation({
          createdAt: "ikke-en-dato",
          summary: "Vegen er stengt og omkjoring er skiltet.",
          type: "traffic",
        }),
        generatedAt,
      ),
    ).toBe(true);
  });

  it("uses Norwegian-aware traffic/nature boundaries and ASCII fallbacks", () => {
    const oldCreatedAt = new Date(
      generatedAt.getTime() - publicLeadLongRunningSituationAgeMs - 1,
    ).toISOString();

    expect(
      shouldFeaturePublicHomeSituation(
        publicHomeSituation({
          createdAt: oldCreatedAt,
          summary: "Vegen er stengt og omkjoring er skiltet.",
          type: "fire",
        }),
        generatedAt,
      ),
    ).toBe(false);
    expect(
      shouldFeaturePublicHomeSituation(
        publicHomeSituation({
          createdAt: oldCreatedAt,
          summary: "Frustrasjonen er forståelig, men dette er en byutviklingssak.",
          title: "Skreddersydd gateplan i sentrum",
          type: "fire",
        }),
        generatedAt,
      ),
    ).toBe(true);
  });

  it("requires public visibility and active/preliminary status", () => {
    expect(
      shouldFeaturePublicHomeSituation(
        publicHomeSituation({ publicVisibility: "command_center" }),
        generatedAt,
      ),
    ).toBe(false);
    expect(
      shouldFeaturePublicHomeSituation(publicHomeSituation({ status: "resolved" }), generatedAt),
    ).toBe(false);
  });
});
