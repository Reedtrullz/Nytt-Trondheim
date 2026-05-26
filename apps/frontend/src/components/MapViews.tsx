import { useMemo, useState } from "react";
import type { GeoJsonObject } from "geojson";
import L, { type LatLngTuple } from "leaflet";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  TileLayer,
  WMSTileLayer,
  useMapEvents,
} from "react-leaflet";
import type { Article, MapFeature, Situation } from "@nytt/shared";

const tiles = "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";
export function NewsMap({ articles }: { articles: Article[] }) {
  const locations = articles.filter((article) => article.location);
  return (
    <MapContainer
      center={[63.421, 10.395]}
      zoom={12}
      className="nearby-map"
      zoomControl={false}
      scrollWheelZoom={false}
    >
      <TileLayer url={tiles} attribution="© Kartverket" />
      {locations.map((article, index) => (
        <Marker
          key={article.id}
          position={[article.location!.lat, article.location!.lng]}
          icon={L.divIcon({
            className: "story-marker",
            html: `<span>${index + 1}</span>`,
            iconSize: [25, 25],
          })}
        />
      ))}
    </MapContainer>
  );
}

type DrawingMode = "point" | "line" | "area" | null;

function CaptureClicks({
  mode,
  onClick,
}: {
  mode: DrawingMode;
  onClick: (coordinates: [number, number]) => void;
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

export function SituationMap({
  situation,
  onCreateFeature,
  onUpdateFeature,
  onDeleteFeature,
}: {
  situation: Situation;
  onCreateFeature: (geometry: MapFeature["geometry"], label: string) => Promise<void>;
  onUpdateFeature: (id: string, label: string) => Promise<void>;
  onDeleteFeature: (id: string) => Promise<void>;
}) {
  const [layers, setLayers] = useState({ warning: true, dsbStations: false, dsbCentral: false });
  const [mode, setMode] = useState<DrawingMode>(null);
  const [draft, setDraft] = useState<Array<[number, number]>>([]);
  const [label, setLabel] = useState("Planområde - privat notat");
  const visibleFeatures = useMemo(
    () =>
      situation.features.filter(
        (feature) => feature.properties.layer !== "warning" || layers.warning,
      ),
    [layers.warning, situation.features],
  );
  const privateFeatures = situation.features.filter(
    (feature) => feature.properties.provenance === "private_annotation",
  );

  function capture(coordinate: [number, number]) {
    if (mode === "point") {
      void onCreateFeature({ type: "Point", coordinates: coordinate }, label);
      setMode(null);
      return;
    }
    setDraft((current) => [...current, coordinate]);
  }

  async function finishDrawing() {
    if (mode === "line" && draft.length >= 2) {
      await onCreateFeature({ type: "LineString", coordinates: draft }, label);
    }
    if (mode === "area" && draft.length >= 3) {
      await onCreateFeature({ type: "Polygon", coordinates: [[...draft, draft[0]!]] }, label);
    }
    setDraft([]);
    setMode(null);
  }

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
          <small>Viser ressurser i området - ikke aktiv innsats</small>
        </div>
      </div>
      <MapContainer center={[63.401, 10.31]} zoom={13} className="incident-map">
        <TileLayer url={tiles} attribution="© Kartverket" />
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
        {visibleFeatures.map((feature) =>
          feature.geometry.type === "Point" ? (
            <CircleMarker
              key={feature.id}
              center={
                [feature.geometry.coordinates[1], feature.geometry.coordinates[0]] as LatLngTuple
              }
              radius={7}
              pathOptions={featureStyle(feature)}
            />
          ) : (
            <GeoJSON
              key={feature.id}
              data={feature as GeoJsonObject}
              style={() => featureStyle(feature)}
            />
          ),
        )}
        {draftGeoJson ? (
          <GeoJSON
            data={draftGeoJson as GeoJsonObject}
            style={() =>
              featureStyle({ properties: { provenance: "private_annotation" } } as MapFeature)
            }
          />
        ) : null}
        <CaptureClicks mode={mode} onClick={capture} />
      </MapContainer>
      <div className="map-legend">
        <span className="legend official">Offentlig oppgitt</span>
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
        </div>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-label="Etikett for markering"
        />
        {(["point", "line", "area"] as const).map((tool) => (
          <button
            key={tool}
            className={mode === tool ? "selected" : ""}
            onClick={() => {
              setMode(tool);
              setDraft([]);
            }}
          >
            {tool === "point" ? "Punkt" : tool === "line" ? "Linje" : "Område"}
          </button>
        ))}
        <button onClick={() => setMode(null)}>Notat</button>
        {draft.length > 0 ? (
          <button className="finish" onClick={() => void finishDrawing()}>
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
