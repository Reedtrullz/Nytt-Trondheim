import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTimeoutMs, fetchWithSourcePolicy, sourceUserAgent } from "../src/fetchPolicy.js";

const originalTimeout = process.env.NYTT_FETCH_TIMEOUT_MS;

afterEach(() => {
  vi.useRealTimers();
  if (originalTimeout === undefined) {
    delete process.env.NYTT_FETCH_TIMEOUT_MS;
  } else {
    process.env.NYTT_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

describe("worker fetch source policy", () => {
  it("preserves request details while adding source identity and abort signal", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      capturedInit = init;
      return new Response("ok");
    });

    await fetchWithSourcePolicy(fetcher, "https://example.test/source", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: "payload",
    });

    const headers = new Headers(capturedInit?.headers);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe("payload");
    expect(capturedInit?.signal).toBeTruthy();
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("User-Agent")).toBe(sourceUserAgent);
  });

  it("does not replace a source-specific user agent", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      capturedInit = init;
      return new Response("ok");
    });

    await fetchWithSourcePolicy(fetcher, "https://example.test/source", {
      headers: { "User-Agent": "NyttTrondheim/TravelTime" },
    });

    expect(new Headers(capturedInit?.headers).get("User-Agent")).toBe("NyttTrondheim/TravelTime");
  });

  it("rejects on the configured timeout even when a fetcher ignores abort", async () => {
    vi.useFakeTimers();
    process.env.NYTT_FETCH_TIMEOUT_MS = "5";
    let capturedSignal: AbortSignal | undefined;
    const promise = fetchWithSourcePolicy(async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }, "https://example.test/slow-source");
    const assertion = expect(promise).rejects.toThrow("Kildehenting tidsavbrutt etter 5 ms");

    await vi.advanceTimersByTimeAsync(fetchTimeoutMs() + 1);

    expect(capturedSignal?.aborted).toBe(true);
    await assertion;
  });
});
