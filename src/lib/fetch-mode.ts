import { AsyncLocalStorage } from "async_hooks";

type FetchMode = { fresh: boolean };

const store = new AsyncLocalStorage<FetchMode>();

/** Kör arbete med cache: no-store på utgående fetch (t.ex. 12 min före stopp). */
export function runWithFreshFetch<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ fresh: true }, fn);
}

export function isFreshFetch(): boolean {
  return store.getStore()?.fresh === true;
}

export function upstreamFetchInit(
  extra?: RequestInit & { next?: { revalidate?: number } }
): RequestInit {
  const fresh = isFreshFetch();
  const headers = {
    Accept: "application/json",
    "User-Agent": "MikaelsTips/1.0",
    ...(extra?.headers as Record<string, string> | undefined),
  };
  if (fresh) {
    const { next: _n, ...rest } = extra || {};
    return { ...rest, headers, cache: "no-store" };
  }
  return {
    ...extra,
    headers,
    next: extra?.next ?? { revalidate: 60 },
  };
}
