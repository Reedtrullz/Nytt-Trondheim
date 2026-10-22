import { useEffect } from "react";
import { ApiError } from "../api.js";

const MAX_RETRY_MS = 3_600_000;
const MAX_FALLBACK_MS = 60_000;
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

// Retry-After as delta-seconds or HTTP-date; anything else is invalid (undefined).
export function retryAfterDeadline(raw: string | undefined, now: number): number | undefined {
  const value = raw?.trim();
  let deadline = NaN;
  if (value && /^\d+$/.test(value)) deadline = now + Number(value) * 1000;
  else if (value && HTTP_DATE.test(value)) deadline = Date.parse(value);
  return Number.isFinite(deadline)
    ? Math.min(Math.max(now, deadline), now + MAX_RETRY_MS)
    : undefined;
}

// Owns at most one in-flight request for the current query key; rate limits delay later starts.
export class MapPolling {
  private key = "";
  private current?: AbortController;
  private retryAt = 0;
  private failures = 0;

  start(key: string): AbortController | undefined {
    if (key !== this.key) {
      this.cancel();
      this.key = key;
    }
    if (this.current || Date.now() < this.retryAt) return undefined;
    this.current = new AbortController();
    return this.current;
  }

  owns(controller: AbortController): boolean {
    return this.current === controller;
  }

  succeeded(controller: AbortController): void {
    if (!this.owns(controller)) return;
    this.failures = 0;
    this.retryAt = 0;
  }

  failed(controller: AbortController, error: unknown): void {
    if (!this.owns(controller)) return;
    if (!(error instanceof ApiError) || (error.status !== 429 && error.status !== 503)) return;
    const now = Date.now();
    this.failures = Math.min(this.failures + 1, 7);
    this.retryAt =
      retryAfterDeadline(error.retryAfter, now) ??
      now + Math.min(MAX_FALLBACK_MS, 1000 * 2 ** (this.failures - 1));
  }

  finished(controller: AbortController): void {
    if (this.owns(controller)) this.current = undefined;
  }

  cancel(): void {
    this.current?.abort();
    this.current = undefined;
    this.key = "";
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
