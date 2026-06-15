import type { Feature, Geometry } from "geojson";
import { CircleMarker, GeoJSON, Popup } from "react-leaflet";
import type { MapFeature, MapFirstSituation, Provenance } from "@nytt/shared";
import { safeExternalUrl } from "../../safeExternalUrl.js";

interface SituationWorkspaceLayerProps {
  situations: MapFirstSituation[];
  selectedSituationId?: string;
  onSelectSituation: (situationId: string) => void;
}

const provenanceColors: Record<Provenance, { stroke: string; fill: string; dash?: string }> = {
  official: { stroke: "#176446", fill: "#22c55e" },
  reporting_estimate: { stroke: "#a84328", fill: "#f97316", dash: "6 5" },
  preparedness_context: { stroke: "#d79132", fill: "#facc15", dash: "4 6" },
  private_annotation: { stroke: "#19549a", fill: "#60a5fa", dash: "4 5" },
};

const importanceRadius: Record<MapFirstSituation["importance"], number> = {
  high: 12,
  normal: 9,
};

function pointFromGeometry(geometry: Geometry): [number, number] | undefined {
  if (geometry.type !== "Point") return undefined;
  const lng = geometry.coordinates[0];
  const lat = geometry.coordinates[1];
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return [lat, lng];
}

function pathOptionsForFeature(
  feature: MapFeature,
  situation: MapFirstSituation,
  selected: boolean,
) {
  const colors = provenanceColors[feature.properties.provenance];
  return {
    color: colors.stroke,
    fillColor: colors.fill,
    fillOpacity: selected ? 0.38 : 0.2,
    opacity: selected ? 1 : 0.88,
    weight: selected ? 4 : situation.importance === "high" ? 3 : 2,
    dashArray: colors.dash,
    className: `situation-map-feature situation-map-feature-${feature.properties.provenance}${selected ? " selected" : ""}`,
  };
}

function SituationPopup({
  situation,
  feature,
}: {
  situation: MapFirstSituation;
  feature: MapFeature;
}) {
  const sourceUrl = safeExternalUrl(feature.properties.sourceUrl);
  return (
    <Popup>
      <article className="situation-map-popup">
        <strong>{situation.title}</strong>
        <span>{situation.locationLabel}</span>
        <p>{feature.properties.label}</p>
        <small>
          {feature.properties.sourceLabel ?? situation.sourceConfidence.label ?? "Kildegrunnlag"} ·{" "}
          {situation.sourceConfidence.label}
        </small>
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Åpne kilde
          </a>
        ) : null}
      </article>
    </Popup>
  );
}

export function SituationWorkspaceLayer({
  situations,
  selectedSituationId,
  onSelectSituation,
}: SituationWorkspaceLayerProps) {
  return (
    <>
      {situations.flatMap((situation) => {
        const selected = situation.id === selectedSituationId;
        const features = situation.features.length
          ? situation.features
          : situation.primaryFeature
            ? [situation.primaryFeature]
            : [];
        return features.map((feature) => {
          const point = pointFromGeometry(feature.geometry);
          const pathOptions = pathOptionsForFeature(feature, situation, selected);
          const key = `${situation.id}:${feature.id}`;
          if (point) {
            return (
              <CircleMarker
                key={key}
                center={point}
                radius={importanceRadius[situation.importance] + (selected ? 4 : 0)}
                pathOptions={pathOptions}
                eventHandlers={{ click: () => onSelectSituation(situation.id) }}
              >
                <SituationPopup situation={situation} feature={feature} />
              </CircleMarker>
            );
          }

          const geoJsonFeature: Feature<Geometry> = {
            type: "Feature",
            geometry: feature.geometry,
            properties: { id: feature.id, situationId: situation.id },
          };

          return (
            <GeoJSON
              key={key}
              data={geoJsonFeature}
              style={() => pathOptions}
              eventHandlers={{ click: () => onSelectSituation(situation.id) }}
            >
              <SituationPopup situation={situation} feature={feature} />
            </GeoJSON>
          );
        });
      })}
    </>
  );
}
