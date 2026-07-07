import { describe, expect, it } from "vitest";
import {
  comparePublicHomeSituations,
  publicLeadLongRunningSituationAgeMs,
  shouldFeaturePublicHomeSituation,
  type PublicHomeSituationSortInput,
} from "../src/public-home-situations.js";

const generatedAt = new Date("2026-07-04T12:00:00.000Z");

function publicHomeSituation(
  overrides: Partial<PublicHomeSituationSortInput> = {},
): PublicHomeSituationSortInput {
  return {
    id: "situation-local",
    createdAt: "2026-07-04T10:00:00.000Z",
    updatedAt: "2026-07-04T10:00:00.000Z",
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

  it("ranks public-safety situations above fresher routine road closures", () => {
    const freshRoadClosure = publicHomeSituation({
      id: "road",
      type: "traffic",
      title: "Trær/Busker, ett stengt kjørefelt",
      summary: "Trær/Busker, ett stengt kjørefelt.",
      locationLabel: "Romundstadbygdvegen",
      updatedAt: "2026-07-07T18:10:51.000Z",
      verificationStatus: "Offentlig bekreftet",
    });
    const armedPolice = publicHomeSituation({
      id: "armed-police",
      type: "rescue",
      title: "Bevæpnet politi rykket ut i Trondheim",
      summary: "Politiet rykket ut til en trusselsituasjon på Byåsen i Trondheim.",
      locationLabel: "Byåsen",
      updatedAt: "2026-07-07T17:48:00.000Z",
      importance: "high",
      verificationStatus: "Offentlig bekreftet",
    });

    expect([freshRoadClosure, armedPolice].sort(comparePublicHomeSituations)).toEqual([
      armedPolice,
      freshRoadClosure,
    ]);
  });
});
