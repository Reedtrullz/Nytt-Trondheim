import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TrafficMapPayload,
} from "@nytt/shared";
import { fetchTrafficMap } from "../api/trafficMap.js";

export interface UseTrafficMapOptions {
  categories: TrafficEventCategory[];
  severities: TrafficEventSeverity[];
  states?: TrafficEventState[];
  from?: string;
  to?: string;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
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

  const categoriesKey = options.categories.join(",");
  const severitiesKey = options.severities.join(",");
  const statesKey = options.states?.join(",") ?? "";
  const fromKey = options.from ?? "";
  const toKey = options.to ?? "";
  const currentBoundsKey = boundsKey(options.bounds);

  const reload = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(undefined);
    try {
      const payload = await fetchTrafficMap(
        {
          categories: categoriesFromKey(categoriesKey),
          severities: severitiesFromKey(severitiesKey),
          states: statesFromKey(statesKey),
          from: fromKey || undefined,
          to: toKey || undefined,
          bounds: boundsFromKey(currentBoundsKey),
        },
        { signal: controller.signal },
      );
      if (requestId === requestIdRef.current) setData(payload);
    } catch (err) {
      if (isAbortError(err)) return;
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : "Ukjent feil ved henting av trafikkdata.");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        abortRef.current = undefined;
      }
    }
  }, [categoriesKey, currentBoundsKey, fromKey, severitiesKey, statesKey, toKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void reload();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [reload]);

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
