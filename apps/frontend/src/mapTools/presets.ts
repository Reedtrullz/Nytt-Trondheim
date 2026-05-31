import type { MapFeature } from "@nytt/shared";

export interface MapToolPreset {
  id: NonNullable<MapFeature["properties"]["analysisType"]>;
  label: string;
  scenario: NonNullable<MapFeature["properties"]["scenario"]>;
  geometryMode: "point" | "line" | "area" | "circle" | "sector";
  defaultConfidence: NonNullable<MapFeature["properties"]["confidence"]>;
  defaultLabel: string;
  styleKey: string;
}

export const mapToolPresets: MapToolPreset[] = [
  {
    id: "fire_perimeter",
    label: "Brannfront",
    scenario: "fire",
    geometryMode: "line",
    defaultConfidence: "reported_unverified",
    defaultLabel: "Brannfront – privat anslag",
    styleKey: "fire-front",
  },
  {
    id: "hotspot",
    label: "Hotspot",
    scenario: "fire",
    geometryMode: "point",
    defaultConfidence: "reported_unverified",
    defaultLabel: "Mulig hotspot",
    styleKey: "fire-hotspot",
  },
  {
    id: "smoke_wind_cone",
    label: "Røyk/vind",
    scenario: "fire",
    geometryMode: "sector",
    defaultConfidence: "speculative",
    defaultLabel: "Mulig røyk-/vindretning",
    styleKey: "smoke-cone",
  },
  {
    id: "risk_radius",
    label: "Risikoring",
    scenario: "fire",
    geometryMode: "circle",
    defaultConfidence: "speculative",
    defaultLabel: "Mulig risikosone",
    styleKey: "risk-radius",
  },
  {
    id: "water_access",
    label: "Vann/tilkomst",
    scenario: "fire",
    geometryMode: "point",
    defaultConfidence: "observed_by_owner",
    defaultLabel: "Vann/tilkomst",
    styleKey: "resource",
  },
  {
    id: "evacuation_line",
    label: "Evakuering/stengt",
    scenario: "fire",
    geometryMode: "line",
    defaultConfidence: "reported_unverified",
    defaultLabel: "Evakuering/stengt linje",
    styleKey: "evacuation-line",
  },
  {
    id: "last_known_position",
    label: "Sist sett",
    scenario: "sar",
    geometryMode: "point",
    defaultConfidence: "reported_unverified",
    defaultLabel: "Sist sett",
    styleKey: "last-seen",
  },
  {
    id: "witness_observation",
    label: "Vitneobs.",
    scenario: "sar",
    geometryMode: "point",
    defaultConfidence: "reported_unverified",
    defaultLabel: "Vitneobservasjon",
    styleKey: "witness",
  },
  {
    id: "probable_route",
    label: "Mulig rute",
    scenario: "sar",
    geometryMode: "line",
    defaultConfidence: "speculative",
    defaultLabel: "Mulig rute",
    styleKey: "sar-route",
  },
  {
    id: "search_sector",
    label: "Søksområde",
    scenario: "sar",
    geometryMode: "sector",
    defaultConfidence: "speculative",
    defaultLabel: "Søksområde",
    styleKey: "search-sector",
  },
  {
    id: "search_grid",
    label: "Søkerute/grid",
    scenario: "sar",
    geometryMode: "area",
    defaultConfidence: "speculative",
    defaultLabel: "Søkerute/grid",
    styleKey: "search-grid",
  },
  {
    id: "command_point",
    label: "KO",
    scenario: "sar",
    geometryMode: "point",
    defaultConfidence: "observed_by_owner",
    defaultLabel: "KO",
    styleKey: "command",
  },
  {
    id: "resource_point",
    label: "Ressurs",
    scenario: "sar",
    geometryMode: "point",
    defaultConfidence: "observed_by_owner",
    defaultLabel: "Ressurs",
    styleKey: "resource",
  },
];
