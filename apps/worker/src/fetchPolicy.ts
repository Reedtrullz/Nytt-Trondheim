export const sourceUserAgent = "NyttTrondheim/0.1 kontakt@reidar.tech";

export const defaultFetchTimeoutMs = 15_000;

export function fetchTimeoutMs(): number {
  const configured = Number(process.env.NYTT_FETCH_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultFetchTimeoutMs;
}

export async function fetchWithSourcePolicy(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
): Promise<Response> {
  const timeoutMs = fetchTimeoutMs();
  const controller = new AbortController();
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", sourceUserAgent);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error(`Kildehenting tidsavbrutt etter ${timeoutMs} ms`);
  const responsePromise = fetcher(input, {
    ...init,
    headers,
    signal: controller.signal,
  });
  const timeoutPromise = new Promise<Response>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([responsePromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    responsePromise.catch(() => undefined);
  }
}
