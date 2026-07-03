import type { NearbyStoryItem, NearbyStoryKind } from "./homeNearby.js";
import { distanceKmBetween } from "./homeLocalFocus.js";

export interface NewsMapCluster {
  id: string;
  items: NearbyStoryItem[];
  position: [number, number];
  markerLabel: string;
  kind: NearbyStoryKind | "cluster";
  title: string;
  selected: boolean;
}

export interface NewsMapClusterSummary {
  storyCount: number;
  markerCount: number;
  clusterCount: number;
  compressedStoryCount: number;
}

const defaultClusterRadiusMeters = 260;

function averagePosition(items: NearbyStoryItem[]): [number, number] {
  const total = items.reduce(
    (acc, item) => ({
      lat: acc.lat + item.position[0],
      lng: acc.lng + item.position[1],
    }),
    { lat: 0, lng: 0 },
  );
  return [total.lat / items.length, total.lng / items.length];
}

function clusterTitle(items: NearbyStoryItem[]): string {
  if (items.length === 1) {
    const item = items[0]!;
    return `${item.markerLabel}. ${item.title} (${item.locationLabel})`;
  }
  const place = items[0]?.locationLabel ?? "området";
  const titles = items
    .slice(0, 3)
    .map((item) => item.title)
    .join(", ");
  const suffix = items.length > 3 ? ` og ${items.length - 3} til` : "";
  return `${items.length} saker nær ${place}: ${titles}${suffix}`;
}

function clusterKind(items: NearbyStoryItem[]): NearbyStoryKind | "cluster" {
  if (items.length === 1) return items[0]!.kind;
  if (items.every((item) => item.kind === items[0]?.kind)) return items[0]!.kind;
  return "cluster";
}

function clusterId(items: NearbyStoryItem[]): string {
  if (items.length === 1) return items[0]!.id;
  return `cluster:${items.map((item) => item.id).join("|")}`;
}

export function clusterNearbyStoryItems(
  items: NearbyStoryItem[],
  {
    radiusMeters = defaultClusterRadiusMeters,
    selectedId,
  }: { radiusMeters?: number; selectedId?: string } = {},
): NewsMapCluster[] {
  const radiusKm = Math.max(0, radiusMeters) / 1000;
  const buckets: NearbyStoryItem[][] = [];

  for (const item of items) {
    const bucket = buckets.find((candidate) => {
      const center = averagePosition(candidate);
      return (
        distanceKmBetween(
          { lat: center[0], lng: center[1] },
          { lat: item.position[0], lng: item.position[1] },
        ) <= radiusKm
      );
    });
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.push([item]);
    }
  }

  return buckets.map((bucket) => ({
    id: clusterId(bucket),
    items: bucket,
    position: averagePosition(bucket),
    markerLabel: bucket.length === 1 ? bucket[0]!.markerLabel : String(bucket.length),
    kind: clusterKind(bucket),
    title: clusterTitle(bucket),
    selected: selectedId ? bucket.some((item) => item.id === selectedId) : false,
  }));
}

export function newsMapClusterSummary(
  items: NearbyStoryItem[],
  options: { radiusMeters?: number } = {},
): NewsMapClusterSummary {
  const clusters = clusterNearbyStoryItems(items, options);
  return {
    storyCount: items.length,
    markerCount: clusters.length,
    clusterCount: clusters.filter((cluster) => cluster.items.length > 1).length,
    compressedStoryCount: clusters.reduce(
      (sum, cluster) => sum + Math.max(0, cluster.items.length - 1),
      0,
    ),
  };
}
