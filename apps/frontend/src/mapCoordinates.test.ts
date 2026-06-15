import { describe, expect, it } from "vitest";
import {
  boundsFromGeometry,
  latLngFromGeoJsonPosition,
  latLngFromLonLat,
  latLngsFromGeometry,
  latLngsFromLineString,
} from "./mapCoordinates.js";

describe("map coordinate guards", () => {
  it("converts GeoJSON lon/lat coordinates to Leaflet lat/lng", () => {
    expect(latLngFromLonLat(10.3951, 63.4305)).toEqual([63.4305, 10.3951]);
    expect(latLngFromGeoJsonPosition([10.4, 63.4])).toEqual([63.4, 10.4]);
  });

  it("rejects invalid coordinates before they reach Leaflet", () => {
    expect(latLngFromLonLat(999, 63.4305)).toBeUndefined();
    expect(latLngFromLonLat(10.3951, 999)).toBeUndefined();
    expect(latLngFromLonLat(Number.NaN, 63.4305)).toBeUndefined();
  });

  it("filters invalid route positions from line strings", () => {
    expect(
      latLngsFromLineString({
        type: "LineString",
        coordinates: [
          [10.39, 63.39],
          [999, 999],
          [10.41, 63.4],
        ],
      }),
    ).toEqual([
      [63.39, 10.39],
      [63.4, 10.41],
    ]);
  });

  it("builds Leaflet bounds from line and polygon geometries", () => {
    expect(
      boundsFromGeometry({
        type: "Polygon",
        coordinates: [
          [
            [10.3, 63.4],
            [10.5, 63.4],
            [10.5, 63.45],
            [10.3, 63.4],
          ],
        ],
      }),
    ).toEqual([
      [63.4, 10.3],
      [63.45, 10.5],
    ]);
  });

  it("flattens geometry collections while skipping invalid members", () => {
    expect(
      latLngsFromGeometry({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [10.4, 63.4] },
          { type: "Point", coordinates: [999, 999] },
          {
            type: "LineString",
            coordinates: [
              [10.41, 63.41],
              [10.42, 63.42],
            ],
          },
        ],
      }),
    ).toEqual([
      [63.4, 10.4],
      [63.41, 10.41],
      [63.42, 10.42],
    ]);
  });
});
