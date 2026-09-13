import type { NormalizedSearchResponse } from '../providers/types';
import { isProviderInstanceId } from '../provider-instances';
import type { AggregateInstanceId, AggregateSearchResponse } from '../aggregate/types';
import {
  SEARCH_CACHE_CAP,
  SEARCH_CACHE_INDEX_KEY,
  buildAggregateCacheEntry,
  buildSearchCacheEntry,
  buildSearchCacheSummary,
  emptySearchCacheIndex,
  isAggregateCacheSummary,
  isSearchCacheIndex,
  makeSearchCacheKey,
  searchCacheEntryKey,
  type SearchCacheEntry,
  type SearchCacheIndex,
  type SearchCacheSummary,
} from '../search-cache';

let searchCacheMutationQueue: Promise<unknown> = Promise.resolve();

async function withSearchCacheMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = searchCacheMutationQueue.then(mutation, mutation);
  searchCacheMutationQueue = run.catch(() => undefined);
  return run;
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

export async function getCachedSearch(id: string, query: string): Promise<SearchCacheEntry | null> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    const cacheKey = makeSearchCacheKey(id, query);
    const entryId = index.byKey[cacheKey];
    if (!entryId) return null;
    return touchCachedSearchEntry(index, entryId);
  });
}

export async function getCachedSearchEntry(id: string): Promise<SearchCacheEntry | null> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    if (!index.summaries[id]) return null;
    return touchCachedSearchEntry(index, id);
  });
}

export async function saveCachedSearch(response: NormalizedSearchResponse, id?: string): Promise<SearchCacheEntry> {
  return withSearchCacheMutation(async () => saveCachedSearchUnlocked(response, id));
}

async function saveCachedSearchUnlocked(response: NormalizedSearchResponse, id?: string): Promise<SearchCacheEntry> {
  const index = await readSearchCacheIndex();
  // id 是实例 id 时把 instanceId 写入条目（cache key 随之按实例区分，避免同 provider 实例间碰撞）；
  // 裸 provider 搜索（id 缺省或为 providerId）不带 instanceId，key 沿用 provider 前缀。
  const instanceId = id && isProviderInstanceId(id) ? id : undefined;
  const entry = buildSearchCacheEntry(response, instanceId);
  await writeSearchCacheEntryUnlocked(index, entry);
  return entry;
}

/** 聚合级缓存写（KTD7）：键 = agg 实例 id（与读侧 getCachedSearch(aggInstanceId, …) 同键同源），
 *  与 provider 条目共池 LRU、同一 mutation queue。调用方（gateway）best-effort：.catch(() => null)。 */
export async function saveCachedAggregateSearch(response: AggregateSearchResponse): Promise<SearchCacheEntry> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    const entry = buildAggregateCacheEntry(response);
    await writeSearchCacheEntryUnlocked(index, entry);
    return entry;
  });
}

/** 聚合缓存精确失效（KTD9 拆分语义）：
 *  - 'all'：setRerankConfig 变更 / 导入路径 endpoint·model 实际变更（设置不在键内 ⇒ 写时失效）；
 *  - AggregateInstanceId：该实例 members/topN 变更或实例删除（实例 id 即缓存键，天然精确）。
 *  只删聚合条目（providerId 哨兵判别），provider 历史条目一律存活（AE5）。 */
export async function deleteAggregateCacheEntries(scope: 'all' | AggregateInstanceId): Promise<void> {
  await withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    const doomedIds = index.order.filter((id) => {
      const summary = index.summaries[id];
      return !!summary && isAggregateCacheSummary(summary) && (scope === 'all' || summary.instanceId === scope);
    });
    if (doomedIds.length === 0) return;
    for (const id of doomedIds) {
      const summary = index.summaries[id];
      if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
      delete index.summaries[id];
    }
    index.order = index.order.filter((entryId) => !doomedIds.includes(entryId));
    await browser.storage.local.set({ [SEARCH_CACHE_INDEX_KEY]: index });
    await removeSearchCacheEntries(doomedIds);
  });
}

/**
 * 共享 entry 写入核心（KTD7 抽取）：同 key 替换 + LRU 头插 + 超容淘汰。
 * saveCachedSearchUnlocked 与 saveCachedAggregateSearch 共用，进同一 mutation queue。
 */
async function writeSearchCacheEntryUnlocked(index: SearchCacheIndex, entry: SearchCacheEntry): Promise<void> {
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
