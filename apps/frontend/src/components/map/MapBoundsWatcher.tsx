import { useEffect } from "react";
import { useMapEvents } from "react-leaflet";
import { normalizeMapBounds, type MapBounds } from "../../mapBounds.js";

interface MapBoundsWatcherProps {
  onBoundsChange: (bounds: MapBounds) => void;
}

export function MapBoundsWatcher({ onBoundsChange }: MapBoundsWatcherProps) {
  const map = useMapEvents({
    moveend() {
      const bounds = map.getBounds();
      onBoundsChange(
        normalizeMapBounds({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        }),
      );
    },
    zoomend() {
      const bounds = map.getBounds();
      onBoundsChange(
        normalizeMapBounds({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        }),
      );
    },
  });

  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange(
      normalizeMapBounds({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      }),
    );
  }, [map, onBoundsChange]);

  return null;
}
