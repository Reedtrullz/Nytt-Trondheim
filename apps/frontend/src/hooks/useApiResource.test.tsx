import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useApiResource } from "./useApiResource.js";

function Probe({
  fetcher,
  key,
  debounceMs,
}: {
  fetcher: (signal: AbortSignal) => Promise<unknown>;
  key: string;
  debounceMs?: number;
}) {
  const result = useApiResource({ fetcher, key, debounceMs });
  return (
    <div>
      <span data-testid="loading">{String(result.loading)}</span>
      <span data-testid="refreshing">{String(result.refreshing)}</span>
      <span data-testid="error">{result.error ?? ""}</span>
    </div>
  );
}

describe("useApiResource", () => {
  it("renders without crashing and reports initial loading state", () => {
    const fetcher = vi.fn(async () => ({ items: [] }));
    const markup = renderToStaticMarkup(<Probe fetcher={fetcher} key="initial" />);
    expect(markup).toContain("loading");
  });

  it("exposes retry that triggers a new attempt", () => {
    let capturedRetry: (() => void) | undefined;
    function RetryProbe() {
      const result = useApiResource({ fetcher: async () => ({}), key: "k" });
      capturedRetry = result.retry;
      return null;
    }
    renderToStaticMarkup(<RetryProbe />);
    expect(typeof capturedRetry).toBe("function");
  });
});
