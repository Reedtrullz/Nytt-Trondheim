import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TrafficMapPayload,
} from "@nytt/shared";
import { fetchTrafficMap } from "../api/trafficMap.js";
import type { MapBounds } from "../mapBounds.js";
import { useVisiblePolling } from "./useVisiblePolling.js";

export interface UseTrafficMapOptions {
  categories: TrafficEventCategory[];
  severities: TrafficEventSeverity[];
  states?: TrafficEventState[];
  estimatedNews?: boolean;
  from?: string;
  to?: string;
  bounds?: MapBounds;
}

function boundsKey(bounds: UseTrafficMapOptions["bounds"]): string {
  return bounds
    ? [bounds.north, bounds.south, bounds.east, bounds.west]
        .map((value) => value.toFixed(6))
        .join(",")
    : "";
}

function boundsFromKey(key: string): UseTrafficMapOptions["bounds"] {
  if (!key) return undefined;
  const [north, south, east, west] = key.split(",").map(Number);
  if (
    north === undefined ||
    south === undefined ||
    east === undefined ||
    west === undefined ||
    ![north, south, east, west].every(Number.isFinite)
  ) {
    return undefined;
  }
  return { north, south, east, west };
}

function categoriesFromKey(key: string): TrafficEventCategory[] {
  return key ? (key.split(",") as TrafficEventCategory[]) : [];
}

function severitiesFromKey(key: string): TrafficEventSeverity[] {
  return key ? (key.split(",") as TrafficEventSeverity[]) : [];
}

function statesFromKey(key: string): TrafficEventState[] | undefined {
  return key ? (key.split(",") as TrafficEventState[]) : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useTrafficMap(options: UseTrafficMapOptions) {
  const [data, setData] = useState<TrafficMapPayload | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const settledQueryKeyRef = useRef("");

  const categoriesKey = options.categories.join(",");
  const severitiesKey = options.severities.join(",");
  const statesKey = options.states?.join(",") ?? "";
  const estimatedNewsKey = options.estimatedNews ? "true" : "false";
  const fromKey = options.from ?? "";
  const toKey = options.to ?? "";
  const currentBoundsKey = boundsKey(options.bounds);
  const queryKey = [
    categoriesKey,
    severitiesKey,
    statesKey,
    estimatedNewsKey,
    fromKey,
    toKey,
    currentBoundsKey,
  ].join("|");

  const reload = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const queryChanged =
      settledQueryKeyRef.current !== "" && settledQueryKeyRef.current !== queryKey;

    setLoading(true);
    setError(undefined);
    if (queryChanged) setData(undefined);
    try {
      const payload = await fetchTrafficMap(
        {
          categories: categoriesFromKey(categoriesKey),
          severities: severitiesFromKey(severitiesKey),
          states: statesFromKey(statesKey),
          estimatedNews: estimatedNewsKey === "true",
          from: fromKey || undefined,
          to: toKey || undefined,
          bounds: boundsFromKey(currentBoundsKey),
        },
        { signal: controller.signal },
      );
      if (requestId === requestIdRef.current) {
        setData(payload);
        settledQueryKeyRef.current = queryKey;
      }
    } catch (err) {
      if (isAbortError(err)) return;
      if (requestId === requestIdRef.current) {
        if (queryChanged) setData(undefined);
        setError(err instanceof Error ? err.message : "Ukjent feil ved henting av trafikkdata.");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        abortRef.current = undefined;
      }
    }
  }, [
    categoriesKey,
    currentBoundsKey,
    estimatedNewsKey,
    fromKey,
    queryKey,
    severitiesKey,
    statesKey,
    toKey,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useVisiblePolling({
    intervalMs: 60_000,
    reload,
  });

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  return {
    data,
    loading,
    error,
    reload,
  };
}
