import type { TravelPlaceSuggestionPayload, TravelPlanPayload } from "@nytt/shared";

export interface TravelPlanRequest {
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
  departAt?: string;
}

export async function fetchTravelPlan(
  request: TravelPlanRequest,
  options: { signal?: AbortSignal } = {},
): Promise<TravelPlanPayload> {
  const params = new URLSearchParams();
  params.set("from", request.from);
  params.set("to", request.to);
  if (request.fromLabel) params.set("fromLabel", request.fromLabel);
  if (request.toLabel) params.set("toLabel", request.toLabel);
  if (request.departAt) params.set("departAt", request.departAt);
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

export async function fetchTravelPlaceSuggestions(
  request: { q: string; limit?: number },
  options: { signal?: AbortSignal } = {},
): Promise<TravelPlaceSuggestionPayload> {
  const params = new URLSearchParams();
  params.set("q", request.q);
  if (request.limit !== undefined) params.set("limit", String(request.limit));
  const response = await fetch(`/api/map/travel-suggestions?${params.toString()}`, {
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
    throw new Error(body.error ?? "Kunne ikke hente stedsforslag.");
  }
  return (await response.json()) as TravelPlaceSuggestionPayload;
}
