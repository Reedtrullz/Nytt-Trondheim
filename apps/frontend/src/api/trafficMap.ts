import type {
  TrafficEventCategory,
  TrafficEventSeverity,
  TrafficEventState,
  TrafficMapPayload,
} from "@nytt/shared";

export interface TrafficMapRequest {
  categories?: TrafficEventCategory[];
  severities?: TrafficEventSeverity[];
  states?: TrafficEventState[];
  estimatedNews?: boolean;
  includeTravelTime?: boolean;
  includeRoadContext?: boolean;
  from?: string;
  to?: string;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export async function fetchTrafficMap(
  request: TrafficMapRequest = {},
  options: { signal?: AbortSignal } = {},
): Promise<TrafficMapPayload> {
  const params = new URLSearchParams();
  if (request.categories !== undefined) params.set("categories", request.categories.join(","));
  if (request.severities !== undefined) params.set("severities", request.severities.join(","));
  if (request.states !== undefined) params.set("states", request.states.join(","));
  if (request.estimatedNews !== undefined)
    params.set("estimatedNews", String(request.estimatedNews));
  if (request.includeTravelTime !== undefined)
    params.set("includeTravelTime", String(request.includeTravelTime));
  if (request.includeRoadContext !== undefined)
    params.set("includeRoadContext", String(request.includeRoadContext));
  if (request.from) params.set("from", request.from);
  if (request.to) params.set("to", request.to);
  if (request.bounds) {
    params.set("north", String(request.bounds.north));
    params.set("south", String(request.bounds.south));
    params.set("east", String(request.bounds.east));
    params.set("west", String(request.bounds.west));
  }

  const suffix = params.toString();
  const response = await fetch(`/api/map/traffic-events${suffix ? `?${suffix}` : ""}`, {
    credentials: "include",
    signal: options.signal,
  });
  if (response.status === 401) {
    window.location.href = "/logg-inn";
    throw new Error("Innlogging kreves");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Kunne ikke hente trafikkdata.");
  }
  return (await response.json()) as TrafficMapPayload;
}
