import { describe, expect, it } from "vitest";
import { mapBoundsEqual, normalizeMapBounds } from "./mapBounds.js";

describe("map bounds helpers", () => {
  it("rounds bounds outward so tiny map jitter keeps the same query window", () => {
    expect(
      normalizeMapBounds({
        north: 63.430012,
        south: 63.420098,
        east: 10.400012,
        west: 10.390098,
      }),
    ).toEqual({
      north: 63.4301,
      south: 63.42,
      east: 10.4001,
      west: 10.39,
    });
  });

  it("treats equivalent normalized bounds as equal", () => {
    const first = normalizeMapBounds({
      north: 63.430012,
      south: 63.420098,
      east: 10.400012,
      west: 10.390098,
    });
    const second = normalizeMapBounds({
      north: 63.430019,
      south: 63.420091,
      east: 10.400019,
      west: 10.390091,
    });

    expect(mapBoundsEqual(first, second)).toBe(true);
    expect(mapBoundsEqual(first, undefined)).toBe(false);
  });
});
