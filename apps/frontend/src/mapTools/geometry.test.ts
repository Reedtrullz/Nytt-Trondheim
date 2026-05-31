import { describe, expect, it } from "vitest";
import type { LonLat } from "./geometry.js";
import {
  bearingDegrees,
  circlePolygon,
  lineDistanceMeters,
  pointToLineDistanceMeters,
  polygonAreaSquareMeters,
  sectorPolygon,
} from "./geometry.js";

describe("map tool geometry helpers", () => {
  it("measures a line distance in meters", () => {
    expect(
      lineDistanceMeters([
        [10.3951, 63.4305],
        [10.4051, 63.4305],
      ]),
    ).toBeGreaterThan(490);
    expect(
      lineDistanceMeters([
        [10.3951, 63.4305],
        [10.4051, 63.4305],
      ]),
    ).toBeLessThan(510);
  });

  it("calculates bearing from west to east", () => {
    expect(bearingDegrees([10.3951, 63.4305], [10.4051, 63.4305])).toBeGreaterThan(85);
    expect(bearingDegrees([10.3951, 63.4305], [10.4051, 63.4305])).toBeLessThan(95);
  });

  it("measures distance to the middle of a line segment, not just vertices", () => {
    const line: Array<[number, number]> = [
      [10.0, 63.43],
      [10.8, 63.43],
    ];
    const point: [number, number] = [10.4, 63.431];
    const segmentDistance = pointToLineDistanceMeters(point, line);
    const vertexDistance = Math.min(
      lineDistanceMeters([point, line[0]!]),
      lineDistanceMeters([point, line[1]!]),
    );
    expect(segmentDistance).toBeLessThan(150);
    expect(vertexDistance).toBeGreaterThan(19_000);
  });

  it("creates closed circle and sector polygons", () => {
    const circle = circlePolygon([10.3951, 63.4305], 500, 16);
    expect(circle.type).toBe("Polygon");
    expect(circle.coordinates[0]![0]).toEqual(circle.coordinates[0]!.at(-1));
    const sector = sectorPolygon([10.3951, 63.4305], 1000, 45, 135, 8);
    expect(sector.coordinates[0]![0]).toEqual([10.3951, 63.4305]);
    expect(sector.coordinates[0]!.at(-1)).toEqual([10.3951, 63.4305]);
  });

  it("estimates polygon area for a search sector", () => {
    const circle = circlePolygon([10.3951, 63.4305], 1000, 64);
    const ring = circle.coordinates[0] as LonLat[];
    expect(polygonAreaSquareMeters(ring)).toBeGreaterThan(2_800_000);
    expect(polygonAreaSquareMeters(ring)).toBeLessThan(3_400_000);
  });
});
