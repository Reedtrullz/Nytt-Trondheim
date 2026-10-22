import { useEffect } from "react";
import { ApiError } from "../api.js";
import type { MapBounds } from "../mapBounds.js";

export function boundsKey(bounds: MapBounds | undefined): string {
  return bounds
    ? [bounds.north, bounds.south, bounds.east, bounds.west]
        .map((value) => value.toFixed(6))
        .join(",")
    : "";
}

export function boundsFromKey(key: string): MapBounds | undefined {
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

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const MAX_RETRY_MS = 3_600_000;
const MAX_FALLBACK_MS = 60_000;
const HTTP_DATE = /^\w{3}, \d\d \w{3} \d{4} [\d:]{8} GMT$/;

// Retry-After as delta-seconds or HTTP-date; anything else is invalid (undefined).
export function retryAfterDeadline(raw: string | undefined, now: number): number | undefined {
  const deadline =
    raw && /^\d+$/.test(raw)
      ? now + Number(raw) * 1000
      : raw && HTTP_DATE.test(raw)
        ? Date.parse(raw)
        : NaN;
  return Number.isFinite(deadline) ? Math.min(deadline, now + MAX_RETRY_MS) : undefined;
}

// Owns at most one in-flight request for the current query key; rate limits delay later starts.
export class MapPolling {
  private key = "";
  private current?: AbortController;
  private retryAt = 0;
  private failures = 0;

  async run<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    setData: (data: T) => void,
    setLoading: (loading: boolean) => void,
    setError: (message: string | undefined) => void,
    fallbackMessage: string,
  ): Promise<void> {
    if (key !== this.key) {
      this.cancel();
      this.key = key;
    }
    if (this.current || Date.now() < this.retryAt) return;
    const controller = new AbortController();
    this.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const data = await load(controller.signal);
      if (this.current === controller) {
        setData(data);
        this.failures = 0;
        this.retryAt = 0;
      }
    } catch (error) {
      if (isAbortError(error) || this.current !== controller) return;
      if (error instanceof ApiError && (error.status === 429 || error.status === 503)) {
        const now = Date.now();
        this.retryAt =
          retryAfterDeadline(error.retryAfter, now) ??
          now + Math.min(MAX_FALLBACK_MS, 1000 * 2 ** this.failures++);
      }
      setError(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      if (this.current === controller) {
        setLoading(false);
        this.current = undefined;
      }
    }
  }

  cancel(): void {
    this.current?.abort();
    this.current = undefined;
    this.retryAt = 0;
    this.failures = 0;
  }
}

export function shouldPollWhenVisible({
  enabled,
  hidden,
}: {
  enabled: boolean;
  hidden: boolean;
}): boolean {
  return enabled && !hidden;
}

export function useVisiblePolling({
  enabled = true,
  intervalMs,
  reload,
}: {
  enabled?: boolean;
  intervalMs: number;
  reload: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (!enabled) return undefined;

    const runIfVisible = () => {
      if (
        shouldPollWhenVisible({
          enabled,
          hidden: typeof document !== "undefined" ? document.hidden : false,
        })
      ) {
        void reload();
      }
    };

    const interval = window.setInterval(runIfVisible, intervalMs);
    const handleVisibilityChange = () => {
      runIfVisible();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs, reload]);
}
