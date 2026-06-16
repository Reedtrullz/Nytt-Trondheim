import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject } from "geojson";
import L, { type LatLngTuple } from "leaflet";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  WMSTileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  provenanceLabels,
  type MapFeature,
  type PrivateMapFeatureInput,
  type Situation,
} from "@nytt/shared";
import type { NearbyStoryItem } from "../homeNearby.js";
import { usePublicTransportMap } from "../hooks/usePublicTransportMap.js";
import {
  boundsFromLatLngs,
  latLngFromGeoJsonPosition,
  latLngsFromGeometry,
} from "../mapCoordinates.js";
import {
  bearingDegrees,
  circlePolygon,
  lineDistanceMeters,
  polygonAreaSquareMeters,
  sectorPolygon,
} from "../mapTools/geometry.js";
import { mapToolPresets, type MapToolPreset } from "../mapTools/presets.js";
import { safeExternalUrl } from "../safeExternalUrl.js";
import { MapAccessibility } from "./map/MapAccessibility.js";
import { MapBoundsWatcher } from "./map/MapBoundsWatcher.js";
import { PublicTransportLayer, PublicTransportSummary } from "./map/PublicTransportLayer.js";

const tiles = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";

function FitMapToPositions({ positions }: { positions: Array<[number, number]> }) {
  const map = useMap();
  const focusKey = useMemo(
    () => positions.map((position) => position.join(",")).join("|"),
    [positions],
  );
  const bounds = useMemo(() => {
    const stablePositions = focusKey
      ? focusKey.split("|").map((position) => {
          const [lat, lng] = position.split(",").map(Number);
          return [lat ?? 0, lng ?? 0] as [number, number];
        })
      : [];
    return boundsFromLatLngs(stablePositions);
  }, [focusKey]);

  useEffect(() => {
    if (!bounds) return;
    if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
      map.setView(bounds[0], Math.max(map.getZoom(), 12), { animate: false });
      return;
    }
    map.fitBounds(bounds, { padding: [22, 22], maxZoom: 13, animate: false });
  }, [bounds, focusKey, map]);

  return null;
}

export function NewsMap({
  items,
  selectedId,
  onSelect,
}: {
  items: NearbyStoryItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const selected = items.find((item) => item.id === selectedId);
  const activeId = selected?.id ?? items[0]?.id;
  const center: LatLngTuple = selected?.position ?? items[0]?.position ?? [63.421, 10.395];
  return (
    <MapContainer
      id="map"
      center={center}
      zoom={12}
      className="nearby-map"
      zoomControl={false}
      scrollWheelZoom={false}
    >
      <TileLayer url={tiles} attribution="© Kartverket" />
      <MapAccessibility label="Kart over nærliggende nyhetssaker" />
      <FitMapToPositions positions={items.map(({ position }) => position)} />
      {items.map((item) => (
        <Marker
          key={item.id}
          position={item.position}
          title={`${item.markerLabel}. ${item.title} (${item.locationLabel})`}
          eventHandlers={{ click: () => onSelect?.(item.id) }}
          icon={L.divIcon({
            className: `story-marker story-marker-${item.kind}${
              activeId === item.id ? " story-marker-selected" : ""
            }`,
            html: `<span>${item.markerLabel}</span>`,
            iconSize: [30, 30],
          })}
        />
      ))}
    </MapContainer>
  );
}

type DrawingMode = MapToolPreset["geometryMode"] | null;
type PrivateFeatureProperties = Pick<
  MapFeature["properties"],
  | "label"
  | "note"
  | "analysisType"
  | "confidence"
  | "scenario"
  | "measurement"
  | "styleKey"
  | "sourceItemIds"
>;

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

const minToolRadiusMeters = 25;
const maxToolRadiusMeters = 50_000;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampRadiusMeters(value: number): number {
  return clampNumber(value, minToolRadiusMeters, maxToolRadiusMeters, 500);
}

function clampBearingDegrees(value: number): number {
  return clampNumber(value, 0, 360, 0);
}

function CaptureClicks({
  mode,
  onClick,
}: {
  mode: DrawingMode;
  onClick: (coordinates: [number, number]) => void | Promise<void>;
}) {
  useMapEvents({
    click(event) {
      if (mode) onClick([event.latlng.lng, event.latlng.lat]);
    },
  });
  return null;
}

function featureStyle(feature?: MapFeature) {
  const provenance = feature?.properties.provenance;
  const styleKey = feature?.properties.styleKey;
  if (styleKey === "fire-front" || styleKey === "fire-hotspot") {
    return { color: "#dc2626", weight: 3, fillColor: "#ef4444", fillOpacity: 0.18 };
  }
  if (styleKey === "smoke-cone") {
    return { color: "#6b7280", weight: 2, fillColor: "#9ca3af", fillOpacity: 0.22 };
  }
  if (styleKey === "risk-radius") {
    return {
      color: "#f97316",
      weight: 2,
      dashArray: "7 5",
      fillColor: "#fb923c",
      fillOpacity: 0.12,
    };
  }
  if (styleKey === "evacuation-line") {
    return {
      color: "#111827",
      weight: 4,
      dashArray: "9 6",
      fillColor: "#111827",
      fillOpacity: 0.1,
    };
  }
  if (styleKey === "search-sector" || styleKey === "search-grid") {
    return {
      color: "#0891b2",
      weight: 2,
      dashArray: "6 5",
      fillColor: "#22d3ee",
      fillOpacity: 0.13,
    };
  }
  if (styleKey === "last-seen" || styleKey === "witness") {
    return { color: "#7c3aed", weight: 3, fillColor: "#8b5cf6", fillOpacity: 0.24 };
  }
  if (styleKey === "command" || styleKey === "resource") {
    return { color: "#15803d", weight: 3, fillColor: "#22c55e", fillOpacity: 0.22 };
  }
  if (feature?.properties.layer === "traffic") {
    return { color: "#1f6feb", weight: 3, fillColor: "#1f6feb", fillOpacity: 0.18 };
  }
  if (feature?.properties.layer === "warning") {
    return { color: "#d79132", weight: 1, fillColor: "#e9bd62", fillOpacity: 0.13 };
  }
  if (provenance === "reporting_estimate") {
    return {
      color: "#bf5734",
      weight: 2,
      dashArray: "6 5",
      fillColor: "#c95b3a",
      fillOpacity: 0.16,
    };
  }
  if (provenance === "private_annotation") {
    return {
      color: "#474ea1",
      weight: 3,
      dashArray: "4 5",
      fillColor: "#5969c7",
      fillOpacity: 0.1,
    };
  }
  return { color: "#176446", weight: 2, fillColor: "#176446", fillOpacity: 0.2 };
}

const mapPopupTimeFormatter = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

function formatMapPopupTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return mapPopupTimeFormatter.format(date);
}

function SituationFeaturePopup({ feature }: { feature: MapFeature }) {
  const sourceUrl = safeExternalUrl(feature.properties.sourceUrl);
  const updatedAt = formatMapPopupTime(feature.properties.updatedAt);
  const confidence =
    feature.properties.sourceConfidence?.label ??
    (feature.properties.confidence ? "Privat vurdering" : undefined);
  const sourceLine = [feature.properties.sourceLabel, confidence, updatedAt]
    .filter(Boolean)
    .join(" · ");

  return (
    <Popup>
      <article className="situation-map-popup situation-room-map-popup">
        <strong>{feature.properties.label}</strong>
        <span>{provenanceLabels[feature.properties.provenance]}</span>
        {feature.properties.note ? <p>{feature.properties.note}</p> : null}
        {feature.properties.sourceConfidence?.rationale ? (
          <p>{feature.properties.sourceConfidence.rationale}</p>
        ) : null}
        {sourceLine ? <small>{sourceLine}</small> : null}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Åpne kilde
          </a>
        ) : null}
      </article>
    </Popup>
  );
}

export function SituationMap({
  situation,
  onCreateFeature,
  onUpdateFeature,
  onDeleteFeature,
}: {
  situation: Situation;
  onCreateFeature: (
    geometry: PrivateMapFeatureInput["geometry"],
    properties: PrivateFeatureProperties,
  ) => Promise<boolean>;
  onUpdateFeature: (id: string, label: string) => Promise<void>;
  onDeleteFeature: (id: string) => Promise<void>;
}) {
  const [layers, setLayers] = useState({
    warning: true,
    dsbStations: false,
    dsbCentral: false,
    publicTransport: false,
  });
  const [bounds, setBounds] = useState<MapBounds>();
  const [mode, setMode] = useState<DrawingMode>(null);
  const [selectedPreset, setSelectedPreset] = useState<MapToolPreset>(mapToolPresets[0]!);
  const [draft, setDraft] = useState<Array<[number, number]>>([]);
  const [label, setLabel] = useState(mapToolPresets[0]!.defaultLabel);
  const [radiusMeters, setRadiusMeters] = useState(500);
  const [startBearing, setStartBearing] = useState(45);
  const [endBearing, setEndBearing] = useState(135);
  const [creatingFeature, setCreatingFeature] = useState(false);
  const creatingFeatureRef = useRef(false);
  const stableBounds = useMemo(
    () => bounds,
    [bounds?.east, bounds?.north, bounds?.south, bounds?.west],
  );
  const {
    data: publicTransportData,
    loading: publicTransportLoading,
    error: publicTransportError,
    reload: reloadPublicTransport,
  } = usePublicTransportMap({
    modes: ["bus", "tram", "rail", "water"],
    includeAlerts: true,
    bounds: stableBounds,
    enabled: layers.publicTransport,
  });
  const visibleFeatures = useMemo(
    () =>
      situation.features.filter(
        (feature) => feature.properties.layer !== "warning" || layers.warning,
      ),
    [layers.warning, situation.features],
  );
  const featurePositions = useMemo(
    () => visibleFeatures.flatMap((feature) => latLngsFromGeometry(feature.geometry)),
    [visibleFeatures],
  );
  const privateFeatures = situation.features.filter(
    (feature) => feature.properties.provenance === "private_annotation",
  );
  const mapCenter: LatLngTuple = featurePositions[0] ?? [63.421, 10.395];

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds(nextBounds);
  }, []);

  function featureProperties(
    preset: MapToolPreset,
    measurement?: NonNullable<MapFeature["properties"]["measurement"]>,
  ): PrivateFeatureProperties {
    return {
      label,
      analysisType: preset.id,
      confidence: preset.defaultConfidence,
      scenario: preset.scenario,
      styleKey: preset.styleKey,
      ...(measurement ? { measurement } : {}),
    };
  }

  async function createMapFeature(
    geometry: PrivateMapFeatureInput["geometry"],
    properties: PrivateFeatureProperties,
  ): Promise<boolean> {
    if (creatingFeatureRef.current) return false;
    creatingFeatureRef.current = true;
    setCreatingFeature(true);
    try {
      return await onCreateFeature(geometry, properties);
    } finally {
      creatingFeatureRef.current = false;
      setCreatingFeature(false);
    }
  }

  function choosePreset(preset: MapToolPreset) {
    if (creatingFeatureRef.current) return;
    setSelectedPreset(preset);
    setMode(preset.geometryMode);
    setDraft([]);
    setLabel(preset.defaultLabel);
  }

  async function capture(coordinate: [number, number]) {
    if (creatingFeatureRef.current) return;
    const preset = selectedPreset;
    const safeRadiusMeters = clampRadiusMeters(radiusMeters);
    const safeStartBearing = clampBearingDegrees(startBearing);
    const safeEndBearing = clampBearingDegrees(endBearing);
    if (mode === "point") {
      if (
        await createMapFeature(
          { type: "Point", coordinates: coordinate },
          featureProperties(preset),
        )
      ) {
        setMode(null);
      }
      return;
    }
    if (mode === "circle") {
      if (
        await createMapFeature(
          circlePolygon(coordinate, safeRadiusMeters),
          featureProperties(preset, { radiusMeters: safeRadiusMeters }),
        )
      ) {
        setMode(null);
      }
      return;
    }
    if (mode === "sector") {
      if (
        await createMapFeature(
          sectorPolygon(coordinate, safeRadiusMeters, safeStartBearing, safeEndBearing),
          featureProperties(preset, {
            radiusMeters: safeRadiusMeters,
            bearingDegrees: safeStartBearing,
          }),
        )
      ) {
        setMode(null);
      }
      return;
    }
    setDraft((current) => [...current, coordinate]);
  }

  async function finishDrawing() {
    if (creatingFeatureRef.current) return;
    const preset = selectedPreset;
    let created = false;
    if (mode === "line" && draft.length >= 2) {
      const measurement = {
        distanceMeters: Math.round(lineDistanceMeters(draft)),
        bearingDegrees: Math.round(bearingDegrees(draft[0]!, draft.at(-1)!)),
      };
      created = await createMapFeature(
        { type: "LineString", coordinates: draft },
        featureProperties(preset, measurement),
      );
    }
    if (mode === "area" && draft.length >= 3) {
      const ring = [...draft, draft[0]!];
      created = await createMapFeature(
        { type: "Polygon", coordinates: [ring] },
        featureProperties(preset, {
          areaSquareMeters: Math.round(polygonAreaSquareMeters(ring)),
        }),
      );
    }
    if (created) {
      setDraft([]);
      setMode(null);
    }
  }

  const canFinishDraft =
    (mode === "line" && draft.length >= 2) || (mode === "area" && draft.length >= 3);

  const draftGeoJson: MapFeature["geometry"] | undefined =
    draft.length > 1
      ? mode === "area" && draft.length > 2
        ? { type: "Polygon", coordinates: [[...draft, draft[0]!]] }
        : { type: "LineString", coordinates: draft }
      : undefined;

  return (
    <div className="incident-map-frame">
      <div className="map-toolbar">
        <h2>Kart og berørte områder</h2>
        <div className="layer-controls" aria-label="Kartlag">
          <strong>Kartlag</strong>
          <label>
            <input type="checkbox" checked readOnly /> Hendelser
          </label>
          <label>
            <input
              type="checkbox"
              checked={layers.warning}
              onChange={(event) => setLayers({ ...layers, warning: event.target.checked })}
            />{" "}
            Farevarsel
          </label>
          <span className="layers-label">DSB beredskap</span>
          <label>
            <input
              type="checkbox"
              checked={layers.dsbStations}
              onChange={(event) => setLayers({ ...layers, dsbStations: event.target.checked })}
            />{" "}
            Brannstasjoner
          </label>
          <label>
            <input
              type="checkbox"
              checked={layers.dsbCentral}
              onChange={(event) => setLayers({ ...layers, dsbCentral: event.target.checked })}
            />{" "}
            110-sentral
          </label>
          <label>
            <input
              type="checkbox"
              checked={layers.publicTransport}
              onChange={(event) => setLayers({ ...layers, publicTransport: event.target.checked })}
            />{" "}
            Kollektivtrafikk-kontekst
          </label>
          <small>Viser ressurser i området – ikke aktiv innsats</small>
          {layers.publicTransport ? (
            <small>Kontekstlag – ikke bevis for aktiv hendelse</small>
          ) : null}
        </div>
      </div>
      <MapContainer center={mapCenter} zoom={13} className="incident-map">
        <TileLayer url={tiles} attribution="© Kartverket" />
        <MapAccessibility label={`Situasjonskart for ${situation.title}`} />
        <FitMapToPositions positions={featurePositions} />
        <MapBoundsWatcher onBoundsChange={handleBoundsChange} />
        {layers.dsbStations ? (
          <WMSTileLayer
            url="https://ogc.dsb.no/wms.ashx"
            params={{ layers: "layer_183", format: "image/png", transparent: true }}
            attribution="DSB"
          />
        ) : null}
        {layers.dsbCentral ? (
          <WMSTileLayer
            url="https://ogc.dsb.no/wms.ashx"
            params={{ layers: "layer_186", format: "image/png", transparent: true }}
            attribution="DSB"
          />
        ) : null}
        {visibleFeatures.flatMap((feature) => {
          const popup = mode ? null : <SituationFeaturePopup feature={feature} />;
          if (feature.geometry.type === "Point") {
            const center = latLngFromGeoJsonPosition(feature.geometry.coordinates);
            if (!center) return [];
            return [
              <CircleMarker
                key={feature.id}
                center={center}
                radius={7}
                pathOptions={featureStyle(feature)}
              >
                {popup}
              </CircleMarker>,
            ];
          }
          return [
            <GeoJSON
              key={feature.id}
              data={feature as GeoJsonObject}
              style={() => featureStyle(feature)}
            >
              {popup}
            </GeoJSON>,
          ];
        })}
        {draftGeoJson ? (
          <GeoJSON
            data={draftGeoJson as GeoJsonObject}
            style={() =>
              featureStyle({ properties: { provenance: "private_annotation" } } as MapFeature)
            }
          />
        ) : null}
        <PublicTransportLayer
          payload={publicTransportData}
          visible={layers.publicTransport}
          context
        />
        <CaptureClicks mode={creatingFeature ? null : mode} onClick={capture} />
      </MapContainer>
      {layers.publicTransport ? (
        <PublicTransportSummary
          payload={publicTransportData}
          loading={publicTransportLoading}
          error={publicTransportError}
          onReload={reloadPublicTransport}
          context
        />
      ) : null}
      <div className="map-legend">
        <span className="legend official">Offentlig oppgitt / DATEX trafikk</span>
        <span className="legend estimated">Anslag fra rapportering</span>
        <span className="legend warning">Farevarsel</span>
        <span className="legend private">Privat markering</span>
      </div>
      {!visibleFeatures.some((feature) => feature.properties.layer === "warning") ? (
        <p className="map-empty">
          Ingen relevante offentlige farevarsler er koblet til situasjonen.
        </p>
      ) : null}
      <section className="drawing-tools" aria-label="Mine markeringer">
        <div>
          <h3>
            Mine markeringer <span>Privat</span>
          </h3>
          <p>Kun synlig for deg</p>
          <p className="private-analysis-warning">Private analyser – ikke offentlig verifisert</p>
        </div>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-label="Etikett for markering"
          disabled={creatingFeature}
        />
        <label className="tool-number-input">
          Radius
          <input
            type="number"
            min={minToolRadiusMeters}
            max={maxToolRadiusMeters}
            step={25}
            value={radiusMeters}
            onChange={(event) => setRadiusMeters(clampRadiusMeters(Number(event.target.value)))}
            disabled={creatingFeature}
          />
        </label>
        {selectedPreset.geometryMode === "sector" ? (
          <>
            <label className="tool-number-input">
              Fra
              <input
                type="number"
                min={0}
                max={360}
                value={startBearing}
                onChange={(event) =>
                  setStartBearing(clampBearingDegrees(Number(event.target.value)))
                }
                disabled={creatingFeature}
              />
            </label>
            <label className="tool-number-input">
              Til
              <input
                type="number"
                min={0}
                max={360}
                value={endBearing}
                onChange={(event) => setEndBearing(clampBearingDegrees(Number(event.target.value)))}
                disabled={creatingFeature}
              />
            </label>
          </>
        ) : null}
        {mapToolPresets.map((preset) => (
          <button
            key={preset.id}
            className={
              selectedPreset.id === preset.id && mode === preset.geometryMode ? "selected" : ""
            }
            aria-pressed={selectedPreset.id === preset.id && mode === preset.geometryMode}
            onClick={() => choosePreset(preset)}
            disabled={creatingFeature}
          >
            {preset.label}
          </button>
        ))}
        <button
          aria-pressed={selectedPreset.id === "freehand_note" && mode === "point"}
          disabled={creatingFeature}
          onClick={() =>
            choosePreset({
              id: "freehand_note",
              label: "Notat",
              scenario: "general",
              geometryMode: "point",
              defaultConfidence: "speculative",
              defaultLabel: "Planområde – privat notat",
              styleKey: "private-note",
            })
          }
        >
          Notat
        </button>
        {draft.length > 0 ? (
          <button
            className="finish"
            onClick={() => void finishDrawing()}
            disabled={!canFinishDraft || creatingFeature}
            title={canFinishDraft ? undefined : "Legg til flere punkter før du fullfører"}
            aria-busy={creatingFeature}
          >
            Fullfør
          </button>
        ) : null}
      </section>
      {privateFeatures.length > 0 ? (
        <ul className="private-features">
          {privateFeatures.map((feature) => (
            <PrivateFeatureRow
              key={feature.id}
              feature={feature}
              onSave={onUpdateFeature}
              onDelete={onDeleteFeature}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PrivateFeatureRow({
  feature,
  onSave,
  onDelete,
}: {
  feature: MapFeature;
  onSave: (id: string, label: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(feature.properties.label);
  return (
    <li>
      <input
        aria-label="Navn på privat markering"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <button onClick={() => void onSave(feature.id, label)}>Lagre</button>
      <button className="remove" onClick={() => void onDelete(feature.id)}>
        Slett
      </button>
    </li>
  );
}
