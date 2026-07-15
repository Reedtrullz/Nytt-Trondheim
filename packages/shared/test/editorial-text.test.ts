import { describe, expect, it } from "vitest";
import { editorialTextRejectionReason } from "../src/editorial-text.js";

describe("editorial text policy", () => {
  const options = {
    title: "Ti meter stort ras – kan bli stengt i flere uker",
    minLength: 40,
  };

  it("rejects short text and headline duplicates before editorial use", () => {
    expect(editorialTextRejectionReason("Kort melding.", options)).toBe("too_short");
    expect(
      editorialTextRejectionReason("Ti meter stort ras - kan bli stengt i flere uker", options),
    ).toBe("headline_duplicate");
  });

  it("rejects subscription, login, cookie, navigation and legal boilerplate", () => {
    for (const text of [
      "Artikkelen er for abonnenter. Logg inn for å lese videre.",
      "Allerede abonnent? Logg inn her for å fortsette å lese.",
      "Vi bruker informasjonskapsler for å gi deg en bedre opplevelse.",
      "Gå til forsiden for flere lokale nyheter og siste oppdateringer.",
      "Redaktøransvar og Vær Varsom-plakaten gjelder for innholdet.",
    ]) {
      expect(editorialTextRejectionReason(text, options)).toBe("boilerplate");
    }
  });

  it("keeps supported reporting and does not reject an incidental subscriber reference", () => {
    expect(
      editorialTextRejectionReason(
        "Onsdag kveld gikk det et ras med steiner og løsmasser på Gangåsveien i Orkland.",
        options,
      ),
    ).toBeUndefined();
    expect(
      editorialTextRejectionReason(
        "Telenor opplyser at berørte abonnenter i Orkland gradvis får nettet tilbake.",
        options,
      ),
    ).toBeUndefined();
  });
});
