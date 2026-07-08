import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTransportMapPayload, PublicTransportVehicleMode } from "@nytt/shared";
import { fetchPublicTransportMap } from "../api/publicTransportMap.js";
import type { MapBounds } from "../mapBounds.js";
import { useVisiblePolling } from "./useVisiblePolling.js";

export interface UsePublicTransportMapOptions {
  modes?: PublicTransportVehicleMode[];
  includeAlerts?: boolean;
  bounds?: MapBounds;
  enabled?: boolean;
}

function boundsKey(bounds: UsePublicTransportMapOptions["bounds"]): string {
  return bounds
    ? [bounds.north, bounds.south, bounds.east, bounds.west]
        .map((value) => value.toFixed(6))
        .join(",")
    : "";
}

function boundsFromKey(key: string): UsePublicTransportMapOptions["bounds"] {
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

function modesFromKey(key: string): PublicTransportVehicleMode[] | undefined {
  return key ? (key.split(",") as PublicTransportVehicleMode[]) : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function usePublicTransportMap(options: UsePublicTransportMapOptions = {}) {
  const [data, setData] = useState<PublicTransportMapPayload | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const modesKey = options.modes?.join(",") ?? "";
  const includeAlertsKey = options.includeAlerts === undefined ? "" : String(options.includeAlerts);
  const currentBoundsKey = boundsKey(options.bounds);
  const enabled = options.enabled ?? true;

  const reload = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();

    if (!enabled) {
      setLoading(false);
      setError(undefined);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(undefined);
    try {
      const payload = await fetchPublicTransportMap(
        {
          modes: modesFromKey(modesKey),
          includeAlerts: includeAlertsKey ? includeAlertsKey === "true" : undefined,
          bounds: boundsFromKey(currentBoundsKey),
        },
        { signal: controller.signal },
      );
      if (requestId === requestIdRef.current) setData(payload);
    } catch (err) {
      if (isAbortError(err)) return;
      if (requestId === requestIdRef.current) {
        setError(
          err instanceof Error ? err.message : "Ukjent feil ved henting av kollektivtrafikk.",
        );
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        abortRef.current = undefined;
      }
    }
  }, [currentBoundsKey, enabled, includeAlertsKey, modesKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useVisiblePolling({
    enabled,
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
