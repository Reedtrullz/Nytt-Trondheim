import type { WeatherPreparednessPayload } from "@nytt/shared";

export async function fetchWeatherPreparedness(
  options: { signal?: AbortSignal } = {},
): Promise<WeatherPreparednessPayload> {
  const response = await fetch("/api/weather/preparedness", {
    credentials: "include",
    signal: options.signal,
  });
  if (response.status === 401) {
    window.location.href = "/auth/github";
    throw new Error("Innlogging kreves");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Kunne ikke hente værberedskap.");
  }
  return (await response.json()) as WeatherPreparednessPayload;
}
