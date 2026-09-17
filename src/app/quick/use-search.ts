"use client";

import { useEffect, useState } from "react";

// Debounced GET search that cancels stale requests, so fast typing
// never shows results for an older query.
export function useSearch<T>(endpoint: string, query: string, { enabled = true, delayMs = 150 } = {}) {
  const [state, setState] = useState<{ key: string; results: T[] }>({ key: "", results: [] });
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = `${endpoint}?q=${encodeURIComponent(query.trim())}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(key, { signal: controller.signal });
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        setState({ key, results: await res.json() });
        setFailedKey(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(err);
          setFailedKey(key);
        }
      }
    }, delayMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, enabled, delayMs]);

  return {
    results: state.results,
    loading: enabled && state.key !== key && failedKey !== key,
    failed: failedKey === key,
  };
}
