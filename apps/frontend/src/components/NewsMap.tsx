import { useEffect, useMemo } from "react";
import L, { type LatLngTuple } from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { NearbyStoryItem } from "../homeNearby.js";
import { boundsFromLatLngs } from "../mapCoordinates.js";
import { MapAccessibility } from "./map/MapAccessibility.js";

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
