import type { Geometry, LineString, Point, Polygon, Position } from "geojson";

export type LeafletLatLng = [number, number];
export type LeafletBounds = [LeafletLatLng, LeafletLatLng];

export function latLngFromLonLat(lon: unknown, lat: unknown): LeafletLatLng | undefined {
  if (typeof lon !== "number" || typeof lat !== "number") return undefined;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return [lat, lon];
}

export function latLngFromGeoJsonPosition(position: Position): LeafletLatLng | undefined {
  return latLngFromLonLat(position[0], position[1]);
}

export function latLngFromPoint(point: Point | undefined): LeafletLatLng | undefined {
  return point ? latLngFromGeoJsonPosition(point.coordinates) : undefined;
}

export function latLngsFromLineString(line: LineString): LeafletLatLng[] {
  return line.coordinates.flatMap((position) => {
    const latLng = latLngFromGeoJsonPosition(position);
    return latLng ? [latLng] : [];
  });
}

export function latLngsFromPolygon(polygon: Polygon): LeafletLatLng[] {
  return polygon.coordinates.flatMap((ring) =>
    ring.flatMap((position) => {
      const latLng = latLngFromGeoJsonPosition(position);
      return latLng ? [latLng] : [];
    }),
  );
}

export function latLngsFromGeometry(geometry: Geometry): LeafletLatLng[] {
  switch (geometry.type) {
    case "Point": {
      const latLng = latLngFromPoint(geometry);
      return latLng ? [latLng] : [];
    }
    case "LineString":
      return latLngsFromLineString(geometry);
    case "Polygon":
      return latLngsFromPolygon(geometry);
    case "MultiPoint":
      return geometry.coordinates.flatMap((position) => {
        const latLng = latLngFromGeoJsonPosition(position);
        return latLng ? [latLng] : [];
      });
    case "MultiLineString":
      return geometry.coordinates.flatMap((line) =>
        line.flatMap((position) => {
          const latLng = latLngFromGeoJsonPosition(position);
          return latLng ? [latLng] : [];
        }),
      );
    case "MultiPolygon":
      return geometry.coordinates.flatMap((polygon) =>
        polygon.flatMap((ring) =>
          ring.flatMap((position) => {
            const latLng = latLngFromGeoJsonPosition(position);
            return latLng ? [latLng] : [];
          }),
        ),
      );
    case "GeometryCollection":
      return geometry.geometries.flatMap((item) => latLngsFromGeometry(item));
    default:
      return [];
  }
}

export function boundsFromLatLngs(latLngs: LeafletLatLng[]): LeafletBounds | undefined {
  if (latLngs.length === 0) return undefined;
  let south = latLngs[0]![0];
  let north = latLngs[0]![0];
  let west = latLngs[0]![1];
  let east = latLngs[0]![1];
  latLngs.forEach(([lat, lng]) => {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  });
  return [
    [south, west],
    [north, east],
  ];
}

export function boundsFromGeometry(geometry: Geometry): LeafletBounds | undefined {
  return boundsFromLatLngs(latLngsFromGeometry(geometry));
}
