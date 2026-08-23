import { useCallback, useEffect, useRef, useState } from "react";

export interface UseApiResourceOptions<T> {
  /** Fetch function; identity changes trigger refetch. Wrap inline calls in useCallback. */
  fetcher: (signal: AbortSignal) => Promise<T>;
  /** Keys that identify the current request. Changes reset state and abort in-flight work. */
  key: string;
  /** Keep the previous payload visible while a new request loads. Default true. */
  keepPreviousData?: boolean;
  /** Milliseconds to wait after key changes before fetching. Default 0. */
  debounceMs?: number;
}

export interface UseApiResourceResult<T> {
  data: T | undefined;
  loading: boolean;
  refreshing: boolean;
  error: string | undefined;
  retry: () => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useApiResource<T>({
  fetcher,
  key,
  keepPreviousData = true,
  debounceMs = 0,
}: UseApiResourceOptions<T>): UseApiResourceResult<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const hasData = data !== undefined;
    if (hasData && keepPreviousData) {
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }
    setError(undefined);

    const run = () => {
      if (requestId !== requestIdRef.current) return;
      fetcher(controller.signal)
        .then((payload) => {
          if (requestId !== requestIdRef.current) return;
          setData(payload);
          setLoading(false);
          setRefreshing(false);
          setError(undefined);
        })
        .catch((reason: unknown) => {
          if (requestId !== requestIdRef.current || isAbortError(reason)) return;
          setError(reason instanceof Error ? reason.message : "Ukjent feil ved henting.");
          setLoading(false);
          setRefreshing(false);
        });
    };

    if (debounceMs > 0) {
      const timer = setTimeout(run, debounceMs);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }
    run();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- data is intentionally read once per effect run
  }, [key, attempt, fetcher]);

  return { data, loading, refreshing, error, retry };
}
