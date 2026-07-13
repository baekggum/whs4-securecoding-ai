import { useCallback, useEffect, useState, type DependencyList, type Dispatch, type SetStateAction } from "react";

interface AsyncDataResult<T> {
  /** Last successfully fetched value (kept while a refetch is in flight). */
  data: T | null;
  /** Escape hatch for local mutations (e.g. appending a "load more" page). */
  setData: Dispatch<SetStateAction<T | null>>;
  /** True during the initial fetch and every deps-change/reload refetch. */
  loading: boolean;
  /** Rejection value of the latest fetch, or null. Callers decide the UX. */
  error: unknown;
  /** Refetches with the current deps (also flips `loading` back on). */
  reload: () => void;
}

// Shared fetch-on-mount pattern for read views: tracks loading/error state,
// ignores stale responses when deps change mid-flight, and exposes `reload`
// for after-mutation refreshes. Fetchers that want a fallback value instead
// of an error (빈 화면 방지 폴백) should `.catch` inside the fetcher itself so
// the fallback intent stays visible at the call site.
export function useAsyncData<T>(fetcher: () => Promise<T | null>, deps: DependencyList): AsyncDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The fetcher is intentionally not a dependency — callers pass inline
    // closures and control refetches via `deps` and `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  return { data, setData, loading, error, reload };
}
