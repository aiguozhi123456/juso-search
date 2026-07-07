import type { NormalizedSearchResponse, ProviderId } from './providers/types';
import { allProviders } from './providers/registry';
import {
  SEARCH_CACHE_CAP,
  SEARCH_CACHE_INDEX_KEY,
  buildSearchCacheEntry,
  buildSearchCacheSummary,
  emptySearchCacheIndex,
  isSearchCacheIndex,
  makeSearchCacheKey,
  searchCacheEntryKey,
  type SearchCacheEntry,
  type SearchCacheIndex,
  type SearchCacheSummary,
} from './search-cache';

// BYOK key 仅存 chrome.storage.local（R7 信任底线）。
// ⚠️ getKey 只应由 background service worker 调用；
//   搜索页/设置页不应直接读 key，仅由 worker 代理调 provider API。

const KEYS_KEY = 'providerKeys'; // Record<ProviderId, string>
const ACTIVE_KEY = 'activeProvider'; // ProviderId | null
const THEME_KEY = 'themePref'; // ThemePref
const LOCALE_KEY = 'localePref'; // LocalePref

export type ThemePref = 'auto' | 'light' | 'dark';
export type LocalePref = 'auto' | 'zh_CN' | 'en';
let searchCacheMutationQueue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<Record<string, unknown>> {
  return browser.storage.local.get(null) as Promise<Record<string, unknown>>;
}

async function readKeys(): Promise<Record<string, string>> {
  const all = await readAll();
  return (all[KEYS_KEY] ?? {}) as Record<string, string>;
}

function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}

export async function getConfiguredProviderIds(): Promise<ProviderId[]> {
  const keys = await readKeys();
  return allProviders().filter((p) => keys[p.id]).map((p) => p.id);
}

/** 返回某 provider 的 key，未配置则 null。仅 worker 调用。 */
export async function getKey(id: ProviderId): Promise<string | null> {
  const keys = await readKeys();
  return keys[id] ?? null;
}

export async function setKey(id: ProviderId, key: string): Promise<void> {
  const keys = await readKeys();
  keys[id] = key;
  await browser.storage.local.set({ [KEYS_KEY]: keys });
}

export async function clearKey(id: ProviderId): Promise<void> {
  const keys = await readKeys();
  delete keys[id];
  await browser.storage.local.set({ [KEYS_KEY]: keys });
}

/**
 * 有效激活 provider：显式选择优先（须为已知 provider）；否则回退到首个已配 key 的 provider；
 * 都没有则 null。切换只影响后续查询（R3）。
 */
export async function getActiveProviderId(): Promise<ProviderId | null> {
  const all = await readAll();
  const stored = all[ACTIVE_KEY];
  const keys = await readKeys();
  if (isKnownProvider(stored) && keys[stored]) return stored;
  return allProviders().find((p) => keys[p.id])?.id ?? null;
}

export async function setActiveProviderId(id: ProviderId | null): Promise<void> {
  await browser.storage.local.set({ [ACTIVE_KEY]: id });
}

/** 主题偏好：auto（跟随系统，默认）/ light / dark。
 *  仅读 THEME_KEY，不 get(null)，避免把 BYOK providerKeys 读入页面内存（R7 信任底线）。 */
export async function getThemePref(): Promise<ThemePref> {
  const got = await browser.storage.local.get(THEME_KEY);
  const stored = got[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  await browser.storage.local.set({ [THEME_KEY]: pref });
}

/** UI 语言偏好：auto（跟随浏览器 UI 语言，默认）/ zh_CN / en。
 *  仅读 LOCALE_KEY，不 get(null)（与 themePref 同样的 key 卫生原则）。 */
export async function getLocalePref(): Promise<LocalePref> {
  const got = await browser.storage.local.get(LOCALE_KEY);
  const stored = got[LOCALE_KEY];
  return stored === 'zh_CN' || stored === 'en' ? stored : 'auto';
}

export async function setLocalePref(pref: LocalePref): Promise<void> {
  await browser.storage.local.set({ [LOCALE_KEY]: pref });
}

async function readSearchCacheIndex(): Promise<SearchCacheIndex> {
  const got = await browser.storage.local.get(SEARCH_CACHE_INDEX_KEY);
  const stored = got[SEARCH_CACHE_INDEX_KEY];
  return isSearchCacheIndex(stored) ? stored : emptySearchCacheIndex();
}

async function readSearchCacheEntry(id: string): Promise<SearchCacheEntry | null> {
  const got = await browser.storage.local.get(searchCacheEntryKey(id));
  return (got[searchCacheEntryKey(id)] ?? null) as SearchCacheEntry | null;
}

export async function getSearchCacheSummaries(): Promise<SearchCacheSummary[]> {
  const index = await readSearchCacheIndex();
  return index.order.map((id) => index.summaries[id]).filter(Boolean);
}

export async function getCachedSearch(providerId: ProviderId, query: string): Promise<SearchCacheEntry | null> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    const cacheKey = makeSearchCacheKey(providerId, query);
    const id = index.byKey[cacheKey];
    if (!id) return null;
    return touchCachedSearchEntry(index, id);
  });
}

export async function getCachedSearchEntry(id: string): Promise<SearchCacheEntry | null> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    if (!index.summaries[id]) return null;
    return touchCachedSearchEntry(index, id);
  });
}

export async function saveCachedSearch(response: NormalizedSearchResponse): Promise<SearchCacheEntry> {
  return withSearchCacheMutation(async () => saveCachedSearchUnlocked(response));
}

async function saveCachedSearchUnlocked(response: NormalizedSearchResponse): Promise<SearchCacheEntry> {
  const index = await readSearchCacheIndex();
  const entry = buildSearchCacheEntry(response);
  const oldId = index.byKey[entry.cacheKey];
  const idsToRemove = new Set<string>();
  if (oldId && oldId !== entry.id) idsToRemove.add(oldId);

  index.byKey[entry.cacheKey] = entry.id;
  index.summaries[entry.id] = buildSearchCacheSummary(entry);
  index.order = [entry.id, ...index.order.filter((id) => id !== entry.id && id !== oldId)];

  for (const id of index.order.slice(SEARCH_CACHE_CAP)) {
    idsToRemove.add(id);
    const summary = index.summaries[id];
    if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
    delete index.summaries[id];
  }
  index.order = index.order.slice(0, SEARCH_CACHE_CAP);

  await browser.storage.local.set({
    [searchCacheEntryKey(entry.id)]: entry,
    [SEARCH_CACHE_INDEX_KEY]: index,
  });
  await removeSearchCacheEntries([...idsToRemove]);
  return entry;
}

export async function deleteCachedSearch(id: string): Promise<void> {
  await withSearchCacheMutation(async () => deleteCachedSearchUnlocked(id));
}

async function deleteCachedSearchUnlocked(id: string): Promise<void> {
  const index = await readSearchCacheIndex();
  const summary = index.summaries[id];
  if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
  delete index.summaries[id];
  index.order = index.order.filter((entryId) => entryId !== id);
  await browser.storage.local.set({ [SEARCH_CACHE_INDEX_KEY]: index });
  await removeSearchCacheEntries([id]);
}

export async function clearSearchCache(): Promise<void> {
  await withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    await browser.storage.local.remove([
      SEARCH_CACHE_INDEX_KEY,
      ...index.order.map(searchCacheEntryKey),
    ]);
  });
}

async function touchCachedSearchEntry(index: SearchCacheIndex, id: string): Promise<SearchCacheEntry | null> {
  const entry = await readSearchCacheEntry(id);
  if (!entry) {
    await removeStaleSearchCacheReference(index, id);
    return null;
  }
  const now = Date.now();
  entry.lastAccessedAt = now;
  const summary = buildSearchCacheSummary(entry);
  index.summaries[id] = summary;
  index.byKey[entry.cacheKey] = id;
  index.order = [id, ...index.order.filter((entryId) => entryId !== id)];
  try {
    await browser.storage.local.set({
      [searchCacheEntryKey(id)]: entry,
      [SEARCH_CACHE_INDEX_KEY]: index,
    });
  } catch {
    // LRU touch 是 best-effort：写失败时仍返回可读的缓存条目，避免命中读路径降级为 provider 调用。
  }
  return entry;
}

async function removeStaleSearchCacheReference(index: SearchCacheIndex, id: string): Promise<void> {
  const summary = index.summaries[id];
  if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
  delete index.summaries[id];
  index.order = index.order.filter((entryId) => entryId !== id);
  await browser.storage.local.set({ [SEARCH_CACHE_INDEX_KEY]: index });
}

async function removeSearchCacheEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await browser.storage.local.remove(ids.map(searchCacheEntryKey));
}

async function withSearchCacheMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = searchCacheMutationQueue.then(mutation, mutation);
  searchCacheMutationQueue = run.catch(() => undefined);
  return run;
}
