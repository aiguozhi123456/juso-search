import { useEffect, useRef, useState } from 'react';
import { sendMessage } from './messaging';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';

export function useSearchCache(open: boolean): {
  summaries: SearchCacheSummary[];
  loading: boolean;
  loadEntry: (id: string) => Promise<SearchCacheEntry | null>;
  deleteEntry: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [summaries, setSummaries] = useState<SearchCacheSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const clearingRef = useRef(false);

  async function refresh() {
    if (clearingRef.current) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const next = await sendMessage('getSearchCacheSummaries', undefined);
      if (requestId === requestIdRef.current) setSummaries(next);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    void (async () => {
      try {
        const next = await sendMessage('getSearchCacheSummaries', undefined);
        if (alive && requestId === requestIdRef.current) setSummaries(next);
      } finally {
        if (alive && requestId === requestIdRef.current) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      requestIdRef.current += 1;
    };
  }, [open]);

  async function loadEntry(id: string): Promise<SearchCacheEntry | null> {
    return sendMessage('getCachedSearchEntry', id);
  }

  async function deleteEntry(id: string): Promise<void> {
    await sendMessage('deleteCachedSearch', id);
    await refresh();
  }

  async function clear(): Promise<void> {
    clearingRef.current = true;
    requestIdRef.current += 1;
    try {
      await sendMessage('clearSearchCache', undefined);
      setSummaries([]);
      setLoading(false);
    } finally {
      clearingRef.current = false;
    }
  }

  return { summaries, loading, loadEntry, deleteEntry, clear, refresh };
}
