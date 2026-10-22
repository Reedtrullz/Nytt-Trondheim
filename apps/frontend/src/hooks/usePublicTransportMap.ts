import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTransportMapPayload, PublicTransportVehicleMode } from "@nytt/shared";
import { fetchPublicTransportMap } from "../api/publicTransportMap.js";
import type { MapBounds } from "../mapBounds.js";
import { MapPolling, useVisiblePolling } from "./useVisiblePolling.js";

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
  const polling = useRef(new MapPolling()).current;

  const modesKey = options.modes?.join(",") ?? "";
  const includeAlertsKey = options.includeAlerts === undefined ? "" : String(options.includeAlerts);
  const currentBoundsKey = boundsKey(options.bounds);
  const enabled = options.enabled ?? true;

  const reload = useCallback(async () => {
    if (!enabled) {
      polling.cancel();
      setLoading(false);
      setError(undefined);
      return;
    }

    const controller = polling.start(`${modesKey}|${includeAlertsKey}|${currentBoundsKey}`);
    if (!controller) return;

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
      if (polling.owns(controller)) {
        setData(payload);
        polling.succeeded(controller);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      if (polling.owns(controller)) {
        polling.failed(controller, err);
        setError(
          err instanceof Error ? err.message : "Ukjent feil ved henting av kollektivtrafikk.",
        );
      }
    } finally {
      if (polling.owns(controller)) {
        setLoading(false);
        polling.finished(controller);
      }
    }
  }, [currentBoundsKey, enabled, includeAlertsKey, modesKey, polling]);

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
      polling.cancel();
    };
  }, [polling]);

  return {
    data,
    loading,
    error,
    reload,
  };
}
