export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

function factorForDecimals(decimals: number): number {
  return 10 ** decimals;
}

export function normalizeMapBounds(bounds: MapBounds, decimals = 4): MapBounds {
  const factor = factorForDecimals(decimals);
  return {
    north: Math.ceil(bounds.north * factor) / factor,
    south: Math.floor(bounds.south * factor) / factor,
    east: Math.ceil(bounds.east * factor) / factor,
    west: Math.floor(bounds.west * factor) / factor,
  };
}

export function mapBoundsEqual(left?: MapBounds, right?: MapBounds): boolean {
  if (!left || !right) return left === right;
  return (
    left.north === right.north &&
    left.south === right.south &&
    left.east === right.east &&
    left.west === right.west
  );
}
