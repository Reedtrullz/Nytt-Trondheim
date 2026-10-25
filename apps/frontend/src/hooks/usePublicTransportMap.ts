import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicTransportMapPayload, PublicTransportVehicleMode } from "@nytt/shared";
import { fetchPublicTransportMap } from "../api/publicTransportMap.js";
import type { MapBounds } from "../mapBounds.js";
import { boundsFromKey, boundsKey, MapPolling, useVisiblePolling } from "./useVisiblePolling.js";

export interface UsePublicTransportMapOptions {
  modes?: PublicTransportVehicleMode[];
  includeAlerts?: boolean;
  bounds?: MapBounds;
  enabled?: boolean;
}

function modesFromKey(key: string): PublicTransportVehicleMode[] | undefined {
  return key ? (key.split(",") as PublicTransportVehicleMode[]) : undefined;
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

    await polling.run(
      `${modesKey}|${includeAlertsKey}|${currentBoundsKey}`,
      (signal) =>
        fetchPublicTransportMap(
          {
            modes: modesFromKey(modesKey),
            includeAlerts: includeAlertsKey ? includeAlertsKey === "true" : undefined,
            bounds: boundsFromKey(currentBoundsKey),
          },
          { signal },
        ),
      setData,
      setLoading,
      setError,
      "Ukjent feil ved henting av kollektivtrafikk.",
    );
  }, [currentBoundsKey, enabled, includeAlertsKey, modesKey, polling]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useVisiblePolling({
    enabled,
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
