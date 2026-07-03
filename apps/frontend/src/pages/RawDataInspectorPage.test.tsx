import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type {
  RawInspectorAiRunDetail,
  RawInspectorSourceItemDetail,
  RawInspectorTelemetryDetail,
} from "@nytt/shared";
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
  diagnostics: {
    profile: "compact_recovery",
    attempts: [
      {
        profile: "standard",
        status: "failed",
        maxTokens: 4096,
        articleCount: 12,
        situationCount: 4,
        error: "JSON response was truncated",
      },
      {
        profile: "compact_recovery",
        status: "ok",
        maxTokens: 2048,
        articleCount: 8,
        situationCount: 4,
      },
    ],
  },
  result: {
    diagnostics: {
      profile: "compact_recovery",
      attempts: [
        { profile: "standard", status: "failed" },
        { profile: "compact_recovery", status: "ok" },
      ],
    },
  },
  resultBytes: 32,
  redacted: false,
  truncated: false,
  error: "JSON response was truncated",
};

const telemetryDetail: RawInspectorTelemetryDetail = {
  record: {
    id: "100141",
    source: "datex_travel_time",
    title: "E6 Okstadbakken - E6 Sluppenrampene",
    updatedAt: "2026-07-02T09:40:20.000Z",
    observedAt: "2026-07-02T09:40:00.000Z",
    sourceUrl: "https://example.test/datex-travel-time",
    summary: "Sakte trafikk · 6 min forsinkelse",
  },
  payload: {
    id: "100141",
    delaySeconds: 360,
    token: "[redacted]",
  },
  payloadBytes: 512,
  redacted: true,
  truncated: false,
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
          telemetryDetail={telemetryDetail}
          telemetryPage={{
            items: [
              {
                id: "100141",
                source: "datex_travel_time",
                title: "E6 Okstadbakken - E6 Sluppenrampene",
                updatedAt: "2026-07-02T09:40:20.000Z",
                observedAt: "2026-07-02T09:40:00.000Z",
                summary: "Sakte trafikk · 6 min forsinkelse",
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Rådata-inspektør");
    expect(html).toContain("Modulært kommandosenter");
    expect(html).toContain("Rådata-arbeidsflate");
    expect(html).toContain("Dashboard-oppsett");
    expect(html).toContain("Rådatafiltre layout");
    expect(html).toContain("Endre størrelse på Payload-detaljer");
    expect(html).toContain("Testkilde");
    expect(html).toContain("Normalisert payload");
    expect(html).toContain("Rå payload");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain("Telemetri");
    expect(html).toContain("DATEX reisetid");
    expect(html).toContain("E6 Okstadbakken - E6 Sluppenrampene");
    expect(html).toContain("DATEX reisetid");
    expect(html).toContain("Sakte trafikk · 6 min forsinkelse");
    expect(html).toContain("Telemetripayload");
    expect(html).toContain("Kompakt gjenoppretting");
    expect(html).toContain("Full analyse feilet");
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
    expect(html).toContain("Ingen telemetri matcher filtrene.");
    expect(html).toContain("Velg telemetri fra romlig analyse eller oppgi kilde og ID.");
    expect(html).toContain("Velg et kildeelement for råpayload.");
    expect(html).toContain("Velg en AI-kjøring for resultatpayload.");
  });

  it("renders searchable source-item metadata without exposing payloads in the list", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RawDataInspectorDashboard
          aiRuns={{ items: [] }}
          filters={{ sourceQ: "Testkilde" }}
          sourceItems={{
            items: [
              {
                id: "source:test",
                provider: "nrk",
                kind: "article",
                title: "Testkilde",
                summary: "Normalisert sammendrag",
                fetchedAt: "2026-07-02T09:00:00.000Z",
                captureHash: "hash",
                reliabilityTier: "trusted_media",
                linkedSituationIds: [],
              },
            ],
          }}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Kildeelementer");
    expect(html).toContain("Testkilde");
    expect(html).toContain("Normalisert sammendrag");
    expect(html).not.toContain("[redacted]");
  });
});
