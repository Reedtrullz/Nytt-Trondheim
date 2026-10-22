import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TrafficMapPayload,
} from "@nytt/shared";
import { fetchTrafficMap } from "../api/trafficMap.js";
import type { MapBounds } from "../mapBounds.js";
import { boundsFromKey, boundsKey, MapPolling, useVisiblePolling } from "./useVisiblePolling.js";

export interface UseTrafficMapOptions {
  categories: TrafficEventCategory[];
  severities: TrafficEventSeverity[];
  states?: TrafficEventState[];
  estimatedNews?: boolean;
  includeTravelTime?: boolean;
  includeRoadContext?: boolean;
  from?: string;
  to?: string;
  bounds?: MapBounds;
}

export function optionalTrafficMapFlagKey(value: boolean | undefined): string {
  return value === undefined ? "undefined" : String(value);
}

export function optionalTrafficMapFlagFromKey(key: string): boolean | undefined {
  if (key === "undefined") return undefined;
  return key === "true";
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

export function useTrafficMap(options: UseTrafficMapOptions) {
  const [data, setData] = useState<TrafficMapPayload | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const polling = useRef(new MapPolling()).current;

  const categoriesKey = options.categories.join(",");
  const severitiesKey = options.severities.join(",");
  const statesKey = options.states?.join(",") ?? "";
  const estimatedNewsKey = options.estimatedNews ? "true" : "false";
  const includeTravelTimeKey = optionalTrafficMapFlagKey(options.includeTravelTime);
  const includeRoadContextKey = optionalTrafficMapFlagKey(options.includeRoadContext);
  const fromKey = options.from ?? "";
  const toKey = options.to ?? "";
  const currentBoundsKey = boundsKey(options.bounds);
  const queryKey = [
    categoriesKey,
    severitiesKey,
    statesKey,
    estimatedNewsKey,
    includeTravelTimeKey,
    includeRoadContextKey,
    fromKey,
    toKey,
    currentBoundsKey,
  ].join("|");

  const reload = useCallback(
    () =>
      polling.run(
        queryKey,
        (signal) =>
          fetchTrafficMap(
            {
              categories: categoriesFromKey(categoriesKey),
              severities: severitiesFromKey(severitiesKey),
              states: statesFromKey(statesKey),
              estimatedNews: estimatedNewsKey === "true",
              includeTravelTime: optionalTrafficMapFlagFromKey(includeTravelTimeKey),
              includeRoadContext: optionalTrafficMapFlagFromKey(includeRoadContextKey),
              from: fromKey || undefined,
              to: toKey || undefined,
              bounds: boundsFromKey(currentBoundsKey),
            },
            { signal },
          ),
        setData,
        setLoading,
        setError,
        "Ukjent feil ved henting av trafikkdata.",
      ),
    [
      categoriesKey,
      currentBoundsKey,
      estimatedNewsKey,
      fromKey,
      includeRoadContextKey,
      includeTravelTimeKey,
      polling,
      queryKey,
      severitiesKey,
      statesKey,
      toKey,
    ],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useVisiblePolling({
    intervalMs: 60_000,
    reload,
  });

  useEffect(() => () => polling.cancel(), [polling]);

  return {
    data,
    loading,
    error,
    reload,
  };
}
