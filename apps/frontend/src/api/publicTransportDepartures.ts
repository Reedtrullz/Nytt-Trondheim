import type { PublicTransportDepartureBoardPayload } from "@nytt/shared";
import { ApiError } from "../api.js";

export interface PublicTransportDepartureBoardRequest {
  center?: { lat: number; lon: number };
  radiusMeters?: number;
  stopLimit?: number;
  departureLimit?: number;
  startTime?: string;
}

export async function fetchPublicTransportDepartureBoard(
  request: PublicTransportDepartureBoardRequest = {},
  options: { signal?: AbortSignal } = {},
): Promise<PublicTransportDepartureBoardPayload> {
  const params = new URLSearchParams();
  if (request.center) {
    params.set("lat", String(request.center.lat));
    params.set("lon", String(request.center.lon));
  }
  if (request.radiusMeters !== undefined) params.set("radiusMeters", String(request.radiusMeters));
  if (request.stopLimit !== undefined) params.set("stopLimit", String(request.stopLimit));
  if (request.departureLimit !== undefined) {
    params.set("departureLimit", String(request.departureLimit));
  }
  if (request.startTime) params.set("startTime", request.startTime);

  const suffix = params.toString();
  const response = await fetch(
    `/api/map/public-transport/departures${suffix ? `?${suffix}` : ""}`,
    {
      credentials: "include",
      signal: options.signal,
    },
  );
  if (response.status === 401) {
    window.location.href = "/logg-inn";
    throw new ApiError("Innlogging kreves", 401);
  }
  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After") ?? undefined;
    if (response.status === 429) {
      throw new ApiError("For mange forespørsler. Prøv igjen om litt.", 429, retryAfter);
    }
    const body = (await response.json().catch(() => ({ error: "Kunne ikke hente avganger." }))) as {
      error?: string;
    };
    throw new ApiError(body.error ?? "Kunne ikke hente avganger.", response.status, retryAfter);
  }
  return (await response.json()) as PublicTransportDepartureBoardPayload;
}
