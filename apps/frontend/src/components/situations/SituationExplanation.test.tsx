import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SituationExplanationPanel } from "./SituationExplanation.js";

describe("SituationExplanationPanel", () => {
  it("renders decision reasons, source roles, location confidence and dismissal context", () => {
    const html = renderToStaticMarkup(
      <SituationExplanationPanel
        explanation={{
          createdBecause: ["2 uavhengige kilder rapporterte samme hendelse."],
          sourceRoles: [
            { provider: "nrk", role: "evidence" },
            { provider: "met", role: "context" },
            { provider: "datex_travel_time", role: "telemetry" },
          ],
          locationConfidence: "mixed",
          dismissalReason: "false_positive",
        }}
      />,
    );

    expect(html).toContain("Hvorfor vises dette?");
    expect(html).toContain("Opprettet fordi");
    expect(html).toContain("2 uavhengige kilder");
    expect(html).toContain("nrk");
    expect(html).toContain("Hendelsesgrunnlag");
    expect(html).toContain("met");
    expect(html).toContain("Kontekst, ikke årsak");
    expect(html).toContain("datex_travel_time");
    expect(html).toContain("Telemetri, ikke årsak");
    expect(html).toContain("Blandet offisiell og estimert plassering");
    expect(html).toContain("Kontekst-only");
    expect(html).toContain("feilkobling");
  });

  it("renders no markup without an explanation", () => {
    expect(renderToStaticMarkup(<SituationExplanationPanel />)).toBe("");
  });
});
