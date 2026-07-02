import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MorningBrief } from "@nytt/shared";
import { MorningBriefPanel } from "./HomePage.js";

const brief: MorningBrief = {
  generatedAt: "2026-07-02T07:30:00.000Z",
  title: "Morgenbrief",
  mode: "ai_assisted",
  sourceLine: "AI-assistert · 5/6 kilder OK",
  paragraphs: [
    "Morgenbildet dekker 12 ferske saker.",
    "Trafikktrøbbel sør i byen: Flere meldinger peker mot saktegående trafikk.",
    "1 situasjonsrom følges nå.",
  ],
  highlights: [
    { label: "Saker", value: "12", detail: "Transport leder bildet" },
    { label: "Situasjoner", value: "1", detail: "Aktive eller til vurdering" },
    { label: "Kilder", value: "5/6", detail: "Rapporterer OK" },
  ],
  articleIds: ["article-one"],
  situationIds: ["situation-one"],
  aiRun: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    status: "ok",
    completedAt: "2026-07-02T07:25:00.000Z",
  },
};

describe("MorningBriefPanel", () => {
  it("renders the pinned public briefing with mode and highlights", () => {
    const html = renderToStaticMarkup(<MorningBriefPanel brief={brief} />);

    expect(html).toContain("AI-assistert");
    expect(html).toContain("Morgenbrief");
    expect(html).toContain("Trafikktrøbbel sør i byen");
    expect(html).toContain("AI-assistert · 5/6 kilder OK");
    expect(html).toContain("Morgenbrief-nøkkeltall");
    expect(html).toContain("Transport leder bildet");
  });

  it("renders nothing when bootstrap has no brief yet", () => {
    expect(renderToStaticMarkup(<MorningBriefPanel />)).toBe("");
  });
});
