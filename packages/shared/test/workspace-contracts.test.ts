import { describe, expect, it } from "vitest";
import {
  privateAnnotationCreateRequestSchema,
  privateAnnotationUpdateRequestSchema,
  notificationTriggerPageSchema,
  notificationTriggerQuerySchema,
  operationsTimelineQuerySchema,
  operationsTimelineResponseSchema,
  sourceAuditFilterQuerySchema,
  sourceAuditWorkspaceResponseSchema,
  sourceNonSecretDiagnosticSchema,
  sourceFilterQuerySchema,
  timelineQuerySchema,
  workspaceMapQuerySchema,
} from "../src/schemas.js";
import {
  provenanceLabels,
  sourceConfidenceLabels,
  situationMapLayerLabels,
  timelineEntryKindLabels,
} from "../src/types.js";
import type {
  PrivateAnnotationCreateResponse,
  NotificationTriggerPage,
  OperationsTimelineResponse,
  SituationMapWorkspace,
  SourceAuditWorkspaceResponse,
} from "../src/types.js";

describe("workspace contract schemas", () => {
  it("parses source filter query state from URL-friendly values", () => {
    const parsed = sourceFilterQuerySchema.parse({
      providers: ["nrk,politiloggen", "met"],
      provenances: "official,reporting_estimate",
      reliabilityTiers: "official,trusted_media",
      confidenceLevels: "confirmed,uncertain",
      includeTelemetry: "true",
      includePrivateAnnotations: false,
      limit: "10",
    });

    expect(parsed).toMatchObject({
      providers: ["nrk", "politiloggen", "met"],
      provenances: ["official", "reporting_estimate"],
      reliabilityTiers: ["official", "trusted_media"],
      confidenceLevels: ["confirmed", "uncertain"],
      includeTelemetry: true,
      includePrivateAnnotations: false,
      limit: 10,
    });
  });

  it("validates map-first workspace bounds and filters", () => {
    expect(() => workspaceMapQuerySchema.parse({ north: "63.5" })).toThrow(
      /north, south, east og west/,
    );

    expect(
      workspaceMapQuerySchema.parse({
        layers: "situations,evidence,private_annotations",
        statuses: "active,preliminary",
        sources: "datex,politiloggen",
        provenances: "official,private_annotation",
        north: "63.5",
        south: "63.3",
        east: "10.6",
        west: "10.2",
      }),
    ).toMatchObject({
      layers: ["situations", "evidence", "private_annotations"],
      statuses: ["active", "preliminary"],
      sources: ["datex", "politiloggen"],
      provenances: ["official", "private_annotation"],
      north: 63.5,
      south: 63.3,
    });
  });

  it("validates timeline filters and date ordering", () => {
    expect(
      timelineQuerySchema.parse({
        kinds: "source_update,private_annotation",
        includePrivateAnnotations: "true",
        from: "2026-06-15T08:00:00.000Z",
        to: "2026-06-15T09:00:00.000Z",
      }),
    ).toMatchObject({
      kinds: ["source_update", "private_annotation"],
      includePrivateAnnotations: true,
      limit: 50,
    });

    expect(() =>
      timelineQuerySchema.parse({
        from: "2026-06-15T10:00:00.000Z",
        to: "2026-06-15T09:00:00.000Z",
      }),
    ).toThrow(/from/);
  });

  it("validates operations timeline filters and safe event envelopes", () => {
    expect(
      operationsTimelineQuerySchema.parse({
        kinds: "source_update,collector_run,private_annotation",
        sources: "nrk,datex_travel_time,private_annotations",
        roles: "incident,telemetry,private",
        severities: "warning,muted",
        includePrivateAnnotations: "false",
        sort: "asc",
        from: "2026-06-15T08:00:00.000Z",
        to: "2026-06-15T09:00:00.000Z",
      }),
    ).toMatchObject({
      kinds: ["source_update", "collector_run", "private_annotation"],
      sources: ["nrk", "datex_travel_time", "private_annotations"],
      roles: ["incident", "telemetry", "private"],
      severities: ["warning", "muted"],
      includePrivateAnnotations: false,
      limit: 80,
      sort: "asc",
    });

    const response = {
      generatedAt: "2026-06-15T09:00:00.000Z",
      filters: {
        sources: ["nrk"],
        includePrivateAnnotations: true,
        limit: 80,
        sort: "desc",
      },
      events: [
        {
          id: "timeline:t1",
          timestamp: "2026-06-15T08:30:00.000Z",
          kind: "source_update",
          severity: "info",
          title: "Ny kildeoppdatering",
          detail: "Kilden oppdaterte situasjonen.",
          source: "nrk",
          sourceLabel: "NRK Trøndelag",
          situationId: "skogbrann-bymarka",
          situationTitle: "Skogbrann ved Bymarka",
          situationStatus: "active",
          role: "incident",
          provenance: "reporting_estimate",
          private: false,
          links: [
            {
              kind: "situation",
              label: "Skogbrann ved Bymarka",
              href: "/situasjoner/skogbrann-bymarka",
              situationId: "skogbrann-bymarka",
            },
          ],
          metadata: { relationship: "timeline" },
        },
      ],
      summary: {
        total: 1,
        activeSituations: 1,
        staleWarnings: 0,
        collectorRuns: 0,
        reviewerActions: 0,
        privateEvents: 0,
      },
    } satisfies OperationsTimelineResponse;

    expect(operationsTimelineResponseSchema.parse(response)).toMatchObject({
      events: [{ id: "timeline:t1", private: false }],
    });
  });

  it("validates notification trigger filters and candidate-only response envelopes", () => {
    expect(
      notificationTriggerQuerySchema.parse({
        kinds: "public_safety,traffic_disruption",
        severities: "critical,warning",
        q: "røyk",
        limit: "12",
      }),
    ).toMatchObject({
      kinds: ["public_safety", "traffic_disruption"],
      severities: ["critical", "warning"],
      q: "røyk",
      limit: 12,
    });

    const response = {
      generatedAt: "2026-07-02T09:45:00.000Z",
      filters: {
        limit: 30,
        severities: ["critical"],
      },
      items: [
        {
          id: "notification:situation:one",
          kind: "traffic_disruption",
          severity: "critical",
          deliveryState: "candidate_only",
          title: "Steinsprang, vegen er stengt",
          body: "Gangåsvegen: Vegen er stengt.",
          detail: "Kandidat for systemvarsel. Ingen push er sendt.",
          score: 0.91,
          confidence: {
            level: "confirmed",
            score: 0.91,
            sourceCount: 2,
            updatedAt: "2026-07-02T09:45:00.000Z",
          },
          generatedAt: "2026-07-02T09:45:00.000Z",
          eventUpdatedAt: "2026-07-02T09:40:00.000Z",
          situationId: "one",
          articleIds: ["article-one"],
          sourceIds: ["datex", "adressa"],
          sourceLabels: ["Vegvesen DATEX", "Adresseavisen"],
          matchedKeywords: ["stengt"],
          reasons: ["Har offentlig kildegrunnlag."],
          links: [
            {
              kind: "situation",
              label: "Åpne situasjon",
              href: "/situasjoner/one",
              situationId: "one",
            },
          ],
        },
      ],
      summary: {
        total: 1,
        critical: 1,
        warning: 0,
        watch: 0,
        officialBacked: 1,
        highConfidence: 1,
      },
    } satisfies NotificationTriggerPage;

    expect(notificationTriggerPageSchema.parse(response)).toMatchObject({
      items: [{ deliveryState: "candidate_only", title: "Steinsprang, vegen er stengt" }],
    });
  });

  it("keeps private annotation bodies typed without accepting client provenance", () => {
    const created = privateAnnotationCreateRequestSchema.parse({
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
      properties: {
        label: "Sist sett",
        provenance: "official",
        analysisType: "last_known_position",
        confidence: "reported_unverified",
        scenario: "sar",
        sourceItemIds: ["source-item-1"],
      },
    });

    expect(created.properties).toMatchObject({
      label: "Sist sett",
      analysisType: "last_known_position",
      confidence: "reported_unverified",
      scenario: "sar",
      sourceItemIds: ["source-item-1"],
    });
    expect(created.properties).not.toHaveProperty("provenance");

    const updated = privateAnnotationUpdateRequestSchema.parse({
      label: "Oppdatert markering",
      provenance: "official",
      confidence: "observed_by_owner",
    });

    expect(updated).toEqual({
      label: "Oppdatert markering",
      confidence: "observed_by_owner",
    });
    expect(() => privateAnnotationUpdateRequestSchema.parse({ provenance: "official" })).toThrow(
      /minst ett felt/,
    );
  });

  it("exposes Bokmal labels and map-first workspace models", () => {
    const annotation = {
      id: "feature-private-1",
      type: "Feature",
      geometry: { type: "Point", coordinates: [10.4, 63.4] },
      properties: {
        label: "Sist sett",
        provenance: "private_annotation",
        updatedAt: "2026-06-15T09:00:00.000Z",
        confidence: "observed_by_owner",
      },
    } satisfies PrivateAnnotationCreateResponse;

    const workspace = {
      situations: [
        {
          id: "savnet-person-bymarka",
          type: "missing_person",
          title: "Savnet person i Bymarka",
          summary: "Privat arbeidsflate med kildefilter og markeringer.",
          status: "active",
          importance: "high",
          updatedAt: "2026-06-15T09:00:00.000Z",
          locationLabel: "Bymarka",
          primaryFeature: annotation,
          features: [annotation],
          timelinePreview: [
            {
              id: "timeline-private-1",
              situationId: "savnet-person-bymarka",
              timestamp: "2026-06-15T09:00:00.000Z",
              kind: "private_annotation",
              title: timelineEntryKindLabels.private_annotation,
              detail: "Eier la inn privat kartmarkering.",
              sourceLabel: provenanceLabels.private_annotation,
              sourceUrl: "",
              official: false,
              provenance: "private_annotation",
              privateAnnotationId: annotation.id,
            },
          ],
          provenanceSummary: [
            {
              provenance: "private_annotation",
              label: provenanceLabels.private_annotation,
              sourceIds: [],
              confidence: {
                level: "speculative",
                label: sourceConfidenceLabels.speculative,
              },
            },
          ],
          sourceConfidence: {
            level: "speculative",
            label: sourceConfidenceLabels.speculative,
          },
          hasPrivateAnnotations: true,
        },
      ],
      mapState: {
        layers: ["situations", "private_annotations"],
        sourceFilters: {
          provenances: ["private_annotation"],
          includePrivateAnnotations: true,
        },
      },
      timeline: [],
      privateAnnotations: [annotation],
    } satisfies SituationMapWorkspace;

    expect(provenanceLabels.official).toBe("Offisiell");
    expect(situationMapLayerLabels.private_annotations).toBe("Private markeringer");
    expect(workspace.privateAnnotations[0]?.properties.provenance).toBe("private_annotation");
  });

  it("validates source audit filters and non-secret diagnostics", () => {
    const parsed = sourceAuditFilterQuerySchema.parse({
      sources: "datex,entur,private_annotations",
      groups: "datex,entur,private_annotation",
      roles: "incident_source,telemetry_source,private_annotation",
      healthStates: "ok,degraded",
      freshnessStates: "fresh,stale",
      contractStatuses: "pass,warn",
      staleOnly: "true",
      includeDiagnostics: "true",
      limit: "25",
    });

    expect(parsed).toMatchObject({
      sources: ["datex", "entur", "private_annotations"],
      groups: ["datex", "entur", "private_annotation"],
      roles: ["incident_source", "telemetry_source", "private_annotation"],
      healthStates: ["ok", "degraded"],
      freshnessStates: ["fresh", "stale"],
      contractStatuses: ["pass", "warn"],
      staleOnly: true,
      includeDiagnostics: true,
      limit: 25,
    });

    expect(() =>
      sourceNonSecretDiagnosticSchema.parse({
        key: "datex_password_status",
        label: "Passord",
        kind: "auth_state",
        severity: "info",
        safeForDisplay: true,
        observedAt: "2026-06-15T08:00:00.000Z",
      }),
    ).toThrow(/hemmeligheter/i);
  });

  it("validates a source audit workspace with run history and traceability", () => {
    const workspace = {
      generatedAt: "2026-06-15T08:00:00.000Z",
      filters: {
        sources: ["datex"],
        includeDiagnostics: true,
        limit: 40,
      },
      sources: [
        {
          source: "datex",
          label: "Vegvesen DATEX",
          group: "datex",
          role: "incident_source",
          provenance: "official",
          healthState: "ok",
          freshness: {
            state: "fresh",
            checkedAt: "2026-06-15T08:00:00.000Z",
            lastObservedAt: "2026-06-15T07:59:00.000Z",
          },
          reliability: [
            {
              id: "datex:health-reliability",
              source: "datex",
              label: "Driftssignal",
              level: "good",
              updatedAt: "2026-06-15T08:00:00.000Z",
            },
          ],
          latestRun: {
            id: "datex:run",
            source: "datex",
            collector: "datex",
            status: "succeeded",
            startedAt: "2026-06-15T07:59:00.000Z",
            completedAt: "2026-06-15T08:00:00.000Z",
            durationMs: 1000,
            recordsSeen: 1,
            recordsAccepted: 1,
            recordsRejected: 0,
          },
          openAlertCount: 0,
          criticalAlertCount: 0,
          contractStatus: "pass",
          lastIncidentTraceAt: "2026-06-15T07:50:00.000Z",
        },
      ],
      collectorRuns: [
        {
          id: "datex:run",
          source: "datex",
          collector: "datex",
          status: "succeeded",
          startedAt: "2026-06-15T07:59:00.000Z",
          completedAt: "2026-06-15T08:00:00.000Z",
          durationMs: 1000,
          recordsSeen: 1,
          recordsAccepted: 1,
          recordsRejected: 0,
        },
      ],
      alerts: [],
      contractChecks: [
        {
          id: "datex:secret-hygiene",
          source: "datex",
          kind: "secret_hygiene",
          status: "pass",
          label: "Hemmeligheter",
          checkedAt: "2026-06-15T08:00:00.000Z",
        },
      ],
      traceability: [
        {
          situationId: "datex-e6",
          title: "Trafikkhendelse på E6",
          status: "active",
          updatedAt: "2026-06-15T07:50:00.000Z",
          traceabilityState: "complete",
          sourceCount: 1,
          evidenceCount: 1,
          sourceItemCount: 1,
          privateAnnotationCount: 0,
          primarySources: ["datex"],
          provenanceCounts: { official: 1 },
          links: [
            {
              source: "datex",
              provenance: "official",
              relationship: "activation",
              publishedAt: "2026-06-15T07:50:00.000Z",
            },
          ],
        },
      ],
      diagnostics: [
        {
          key: "datex:health_state",
          label: "Kildestatus",
          kind: "scheduler",
          severity: "info",
          safeForDisplay: true,
          value: "ok",
          unit: "status",
          observedAt: "2026-06-15T08:00:00.000Z",
        },
      ],
    } satisfies SourceAuditWorkspaceResponse;

    expect(sourceAuditWorkspaceResponseSchema.parse(workspace)).toMatchObject({
      sources: [{ source: "datex", contractStatus: "pass" }],
      collectorRuns: [{ status: "succeeded" }],
      traceability: [{ links: [{ relationship: "activation" }] }],
    });
  });
});
