import { describe, expect, it } from "vitest";
import {
  activationAuditRequirements,
  activationEdgeCaseMitigations,
  activationPolicyForSource,
  activationRegressionFixtures,
  activationSourceContractTemplate,
  activationUiMicrocopy,
  assertSituationActivationBasis,
  contextOnlyActivationSources,
  datexPromotionMatrix,
  expectedFixtureCount,
  sourceActivationPolicies,
  telemetryOnlySources,
} from "../src/situation-activation-policy.js";
import type { Situation } from "../src/types.js";

describe("situation activation policy", () => {
  it("ships an explicit source-contract table template", () => {
    expect(activationSourceContractTemplate.map((column) => column.key)).toEqual([
      "sourceId",
      "endpoint",
      "kind",
      "license",
      "canActivate",
      "activationRole",
      "pollingInterval",
      "retention",
      "forbiddenData",
      "fixtures",
    ]);
    expect(activationSourceContractTemplate.every((column) => column.required)).toBe(true);
  });

  it("classifies causal, context, telemetry, private and derived sources", () => {
    expect(activationPolicyForSource("nrk")).toMatchObject({
      role: "reporting",
      canCreateSourceItems: true,
      canCreateSituations: false,
      allowedRelationships: expect.arrayContaining(["supports"]),
    });
    expect(activationPolicyForSource("datex")).toMatchObject({
      role: "activating_official",
      canCreateSituations: true,
    });
    expect(activationPolicyForSource("met")).toMatchObject({
      role: "context",
      canCreateSituations: false,
      allowedRelationships: ["context"],
    });
    expect(activationPolicyForSource("datex_travel_time")).toMatchObject({
      role: "telemetry",
      canCreateSourceItems: false,
      canCreateSituations: false,
    });
    expect(activationPolicyForSource("coverage_bundles")).toMatchObject({
      role: "ignored",
      canCreateSourceItems: false,
      canCreateSituations: false,
    });
    expect(activationPolicyForSource("web_push")).toMatchObject({
      role: "ignored",
      canCreateSourceItems: false,
      canCreateSituations: false,
      allowedRelationships: ["context"],
    });
  });

  it("keeps the context and telemetry source lists aligned with source policies", () => {
    expect(contextOnlyActivationSources).toEqual(
      sourceActivationPolicies
        .filter((policy) => policy.source !== "coverage_bundles")
        .filter((policy) => policy.role === "context" || policy.role === "telemetry")
        .map((policy) => policy.source),
    );
    expect(telemetryOnlySources).toEqual(
      sourceActivationPolicies
        .filter((policy) => policy.source !== "coverage_bundles")
        .filter((policy) => policy.role === "telemetry")
        .map((policy) => policy.source),
    );
    expect(contextOnlyActivationSources).toEqual(
      expect.arrayContaining([
        "met",
        "nve",
        "datex_travel_time",
        "datex_weather",
        "datex_cctv",
        "trafikkdata",
        "vegvesen_traffic_info",
        "entur_vehicle_positions",
        "entur_service_alerts",
        "bane_nor",
        "dsb",
      ]),
    );
  });

  it("documents the DATEX promotion matrix separately from telemetry feeds", () => {
    expect(datexPromotionMatrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordKind: "Accident", action: "official_situation" }),
        expect.objectContaining({ recordKind: "MaintenanceWorks", action: "context_only" }),
        expect.objectContaining({ recordKind: "TravelTimeMeasurement", action: "ignore" }),
      ]),
    );
    expect(datexPromotionMatrix.filter((row) => row.action === "official_situation").length).toBe(
      4,
    );
  });

  it("contains at least 60 named regression fixtures with rule expectations", () => {
    expect(expectedFixtureCount()).toBeGreaterThanOrEqual(60);
    expect(new Set(activationRegressionFixtures.map((fixture) => fixture.id)).size).toBe(
      activationRegressionFixtures.length,
    );
    expect(activationRegressionFixtures.every((fixture) => fixture.name.length > 0)).toBe(true);
    expect(activationRegressionFixtures.every((fixture) => fixture.sources.length > 0)).toBe(true);
    expect(activationRegressionFixtures.map((fixture) => fixture.expected)).toEqual(
      expect.arrayContaining([
        "no_situation",
        "preliminary",
        "official_event",
        "context",
        "resolved",
        "dismissed",
        "source_health_alert",
        "no_loss_of_integrity",
        "analyze",
      ]),
    );
  });

  it("covers the high-risk examples from the activation review", () => {
    expect(activationRegressionFixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 8, sources: ["datex"], expected: "official_event" }),
        expect.objectContaining({
          id: 11,
          sources: ["datex_travel_time"],
          expected: "no_situation",
        }),
        expect.objectContaining({
          id: 13,
          sources: ["coverage_bundles"],
          expected: "no_situation",
        }),
        expect.objectContaining({ id: 20, sources: ["met"], expected: "no_situation" }),
        expect.objectContaining({ id: 21, sources: ["nve"], expected: "no_situation" }),
        expect.objectContaining({ id: 61, articleCategory: "Sport", expected: "context" }),
        expect.objectContaining({ id: 62, articleCategory: "Sport", expected: "context" }),
      ]),
    );
  });

  it("provides Bokmal microcopy, audit requirements and edge-case mitigations", () => {
    expect(activationUiMicrocopy.whyVisibleTitle).toBe("Hvorfor ser jeg dette?");
    expect(activationUiMicrocopy.createdByTwoSources).toContain("to uavhengige kilder");
    expect(activationAuditRequirements.length).toBeGreaterThanOrEqual(8);
    expect(activationEdgeCaseMitigations.length).toBeGreaterThanOrEqual(8);
    expect(activationEdgeCaseMitigations.join(" ")).toContain("MET/NVE");
  });

  it("asserts invalid activation bases before they reach persistence", () => {
    const base = {
      id: "situation",
      type: "traffic",
      title: "Trafikkulykke pa E6",
      summary: "Test",
      status: "active",
      verificationStatus: "Forelopig fra rapportering",
      importance: "normal",
      updatedAt: "2026-06-22T10:00:00.000Z",
      createdAt: "2026-06-22T10:00:00.000Z",
      locationLabel: "Tiller",
      relatedArticleIds: ["a", "b"],
      evidence: [],
      features: [],
      timeline: [],
    } satisfies Situation;

    expect(
      assertSituationActivationBasis({
        ...base,
        activationBasis: {
          rule: "two_independent_sources",
          sourceIds: ["nrk", "met"],
          articleIds: ["a"],
          activatedAt: "2026-06-22T10:00:00.000Z",
        },
      }),
    ).toEqual([
      "Kontekst/telemetry-kilder kan ikke aktivere: met",
      "To-kilde-regel mangler minst to articleIds.",
    ]);
    expect(
      assertSituationActivationBasis({
        ...base,
        activationBasis: {
          rule: "official_source",
          sourceIds: ["datex"],
          articleIds: [],
          activatedAt: "2026-06-22T10:00:00.000Z",
        },
      }),
    ).toEqual([]);
  });
});
