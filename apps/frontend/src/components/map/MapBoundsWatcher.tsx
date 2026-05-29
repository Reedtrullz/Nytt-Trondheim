import { useEffect } from "react";
import { useMapEvents } from "react-leaflet";

interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface MapBoundsWatcherProps {
  onBoundsChange: (bounds: MapBounds) => void;
}

export function MapBoundsWatcher({ onBoundsChange }: MapBoundsWatcherProps) {
  const map = useMapEvents({
    moveend() {
      const bounds = map.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    },
    zoomend() {
      const bounds = map.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    },
  });

  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    });
  }, [map, onBoundsChange]);

  return null;
}
