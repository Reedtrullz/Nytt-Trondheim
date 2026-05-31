import { describe, it } from "vitest";
import type {
  PublicTransportMapPayload,
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  SourceHealth,
  SourceItemInput,
} from "@nytt/shared";

const _vehicle: PublicTransportVehicle = {
  id: "entur-vehicle:ATB:8790",
  source: "entur_vehicle_positions",
  codespaceId: "ATB",
  vehicleId: "8790",
  mode: "bus",
  lineRef: "ATB:Line:2_45",
  publicCode: "45",
  lineName: "Sjetnmarka- Tiller- Tillerringen- Sandmoen",
  destinationName: "Hagen",
  lastUpdated: "2026-05-31T21:02:50.207Z",
  expiresAt: "2026-05-31T21:17:00.000Z",
  geometry: { type: "Point", coordinates: [10.4045538, 63.3708205] },
  delaySeconds: 59,
  bearing: 206,
  speedMps: 0,
  occupancyStatus: "noData",
  vehicleStatus: "IN_PROGRESS",
  stale: false,
};

const _alert: PublicTransportServiceAlert = {
  id: "entur-service-alert:ATB:ATB:SituationNumber:24982-stopPoint",
  source: "entur_service_alerts",
  codespaceId: "ATB",
  situationNumber: "ATB:SituationNumber:24982-stopPoint",
  severity: "noImpact",
  reportType: "incident",
  summary: "Rota - bussholdeplassen er midlertidig flyttet",
  description: "Rota - bussholdeplassen er midlertidig flyttet",
  validFrom: "2026-05-29T06:24:00.000Z",
  validTo: "2026-06-02T21:59:00.000Z",
  updatedAt: "2026-05-29T06:24:44.256Z",
  geometry: { type: "Point", coordinates: [10.760832, 63.431348] },
  state: "active",
  affectedStopNames: ["Rota"],
};

const _health: SourceHealth = {
  source: "entur_vehicle_positions",
  label: "Entur kjøretøyposisjoner",
  state: "ok",
  detail: "120 kjøretøy oppdatert",
};

const _sourceItem: SourceItemInput = {
  id: "source:entur-alert",
  provider: "entur",
  kind: "official_event",
  externalId: "ATB:SituationNumber:24982-stopPoint",
  title: _alert.summary,
  fetchedAt: "2026-05-31T21:15:00.000Z",
  rawPayload: { situationNumber: _alert.situationNumber },
  normalizedPayload: _alert,
  captureHash: "hash",
  reliabilityTier: "official",
  geoHint: _alert.geometry,
};

const _payload: PublicTransportMapPayload = {
  vehicles: [_vehicle],
  alerts: [_alert],
  sources: [_health],
  generatedAt: "2026-05-31T21:15:00.000Z",
};

describe("Entur shared public transport types", () => {
  it("compile with source health, source item and map payload contracts", () => {
    void _payload;
    void _sourceItem;
  });
});
