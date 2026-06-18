import { describe, expect, it } from "vitest";
import { hasFireEmergencySignal, isFootballClubBrannContext } from "../src/incident-text.js";

describe("incident text disambiguation", () => {
  it("separates football club Brann from fire incidents", () => {
    expect(
      isFootballClubBrannContext({
        title: "Rosenborg møter Brann på Lerkendal",
        excerpt: "Kampen spilles søndag kveld.",
        category: "Sport",
      }),
    ).toBe(true);
    expect(
      isFootballClubBrannContext({
        title: "Freyr Alexandersson blir ny hovedtrener i Rosenborg",
        excerpt: "Han var nylig ferdig i Brann.",
        category: "Sport",
      }),
    ).toBe(true);
  });

  it("keeps concrete smoke and building fire wording as emergency signals", () => {
    expect(hasFireEmergencySignal("Røykutvikling i bolig på Tiller")).toBe(true);
    expect(hasFireEmergencySignal("Brann på Rosenborg skole i Trondheim")).toBe(true);
    expect(
      isFootballClubBrannContext({
        title: "Brann på Rosenborg skole i Trondheim",
        excerpt: "Nødetatene er på stedet.",
        category: "Hendelser",
      }),
    ).toBe(false);
  });
});
