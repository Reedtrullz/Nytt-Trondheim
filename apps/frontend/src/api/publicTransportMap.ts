import type { PublicTransportMapPayload, PublicTransportVehicleMode } from "@nytt/shared";

export interface PublicTransportMapRequest {
  modes?: PublicTransportVehicleMode[];
  includeAlerts?: boolean;
  bounds?: { north: number; south: number; east: number; west: number };
}

export async function fetchPublicTransportMap(
  request: PublicTransportMapRequest = {},
  options: { signal?: AbortSignal } = {},
): Promise<PublicTransportMapPayload> {
  const params = new URLSearchParams();
  if (request.modes?.length) params.set("modes", request.modes.join(","));
  if (request.includeAlerts !== undefined) {
    params.set("includeAlerts", String(request.includeAlerts));
  }
  if (request.bounds) {
    params.set("north", String(request.bounds.north));
    params.set("south", String(request.bounds.south));
    params.set("east", String(request.bounds.east));
    params.set("west", String(request.bounds.west));
  }

  const suffix = params.toString();
  const response = await fetch(`/api/map/public-transport${suffix ? `?${suffix}` : ""}`, {
    credentials: "include",
    signal: options.signal,
  });
  if (response.status === 401) {
    window.location.href = "/auth/github";
    throw new Error("Innlogging kreves");
  }
  if (!response.ok) throw new Error("Kunne ikke hente kollektivtrafikk.");
  return (await response.json()) as PublicTransportMapPayload;
}
