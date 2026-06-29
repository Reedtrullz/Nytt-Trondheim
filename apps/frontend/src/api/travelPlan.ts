import type { TravelPlanPayload } from "@nytt/shared";

export interface TravelPlanRequest {
  from: string;
  to: string;
}

export async function fetchTravelPlan(
  request: TravelPlanRequest,
  options: { signal?: AbortSignal } = {},
): Promise<TravelPlanPayload> {
  const params = new URLSearchParams();
  params.set("from", request.from);
  params.set("to", request.to);
  const response = await fetch(`/api/map/travel-plan?${params.toString()}`, {
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
    throw new Error(body.error ?? "Kunne ikke hente reiseråd.");
  }
  return (await response.json()) as TravelPlanPayload;
}
