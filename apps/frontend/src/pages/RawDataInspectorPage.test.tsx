import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { RawInspectorAiRunDetail, RawInspectorSourceItemDetail } from "@nytt/shared";
import { RawDataInspectorDashboard } from "./RawDataInspectorPage.js";

const sourceItem: RawInspectorSourceItemDetail = {
  item: {
    id: "source:test",
    provider: "nrk",
    kind: "article",
    title: "Testkilde",
    fetchedAt: "2026-07-02T09:00:00.000Z",
    captureHash: "hash",
    reliabilityTier: "trusted_media",
    linkedSituationIds: [],
  },
  rawPayload: { title: "Testkilde", token: "[redacted]" },
  normalizedPayload: { title: "Testkilde" },
  payloadBytes: { raw: 128, normalized: 64 },
  redacted: true,
  truncated: false,
};

const aiRun: RawInspectorAiRunDetail = {
  id: "ai:one",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  status: "degraded",
  startedAt: "2026-07-02T09:01:00.000Z",
  completedAt: "2026-07-02T09:02:00.000Z",
  articleCount: 2,
  articleIds: ["article:one", "article:two"],
  result: { ok: false },
  resultBytes: 32,
  redacted: false,
  truncated: false,
  error: "JSON response was truncated",
};

describe("RawDataInspectorDashboard", () => {
  it("renders source payload and AI run detail without mutation controls", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RawDataInspectorDashboard
          aiRuns={{ items: [aiRun] }}
          filters={{ run: "ai:one" }}
          selectedAiRun={aiRun}
          sourceItem={sourceItem}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Rådata-inspektør");
    expect(html).toContain("Testkilde");
    expect(html).toContain("Normalisert payload");
    expect(html).toContain("Rå payload");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("JSON response was truncated");
    expect(html).not.toContain("Slå sammen");
    expect(html).not.toContain("Kjør på nytt");
  });

  it("renders honest empty states", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RawDataInspectorDashboard aiRuns={{ items: [] }} filters={{}} />
      </MemoryRouter>,
    );

    expect(html).toContain("Ingen AI-kjøringer matcher filtrene.");
    expect(html).toContain("Velg et kildeelement for råpayload.");
    expect(html).toContain("Velg en AI-kjøring for resultatpayload.");
  });
});
