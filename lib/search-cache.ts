import type { NormalizedSearchResponse, ProviderId } from './providers/types';

export const SEARCH_CACHE_INDEX_KEY = 'searchCacheIndex';
export const SEARCH_CACHE_ENTRY_PREFIX = 'searchCacheEntry:';
export const SEARCH_CACHE_CAP = 50;

// === 缓存池 schema 版本（与 config 域的 schemaVersion 独立演进）===
// 双版本体系：config 域用 schemaVersion（见 schema.ts 的 ensureSchema + migrations），
// 缓存池用 cacheSchemaVersion（本文件）。两域独立——纯 config 改动不触发缓存全量 IO，反之亦然。
// ⚠️ 修改本文件的 migrateCachePool version 比较逻辑时，同步检查 schema.ts 的 migrateConfig，
//    两处共享同构的 version-skip 语义。
export const CACHE_SCHEMA_VERSION_KEY = 'cacheSchemaVersion';
export const CURRENT_CACHE_SCHEMA_VERSION = 1;

// 缓存迁移：从 `version` 迁移到 `version + 1`。必须是纯函数 + 幂等。
// 接收整个缓存池快照（index + 全部 entries），返回迁移后的快照。
// dropEntryIds 声明想丢弃的 entry id（如解析失败的条目）；框架负责删除对应 storage key。
export type CacheMigration = {
  version: number;
  migrate: (pool: { index: SearchCacheIndex; entries: SearchCacheEntry[] }) => {
    index: SearchCacheIndex;
    entries: SearchCacheEntry[];
    dropEntryIds?: string[];
  };
};

// 迁移注册表：按 version 升序。首版为空（CURRENT_CACHE_SCHEMA_VERSION === 1）。
// 未来加版本两步：(1) 向此数组 append 一条 CacheMigration；(2) bump CURRENT_CACHE_SCHEMA_VERSION。
// ⚠️ 若迁移改变 SearchCacheIndex 形状，同步更新 isSearchCacheIndex 校验。
export const cacheMigrations: CacheMigration[] = [];

const MAX_CACHED_RESULTS = 10;
const MAX_CACHED_ANSWER_CHARS = 2000;
const MAX_CACHED_CITATIONS = 10;
const MAX_CACHED_SNIPPET_CHARS = 1000;
const MAX_SUMMARY_RESULTS = 3;
const MAX_ANSWER_PREVIEW_CHARS = 160;

export interface SearchCacheResultPreview {
  title: string;
  url: string;
}

export interface SearchCacheSummary {
  id: string;
  cacheKey: string;
  query: string;
  normalizedQuery: string;
  providerId: ProviderId;
  createdAt: number;
  lastAccessedAt: number;
  answerPreview?: string;
  resultPreviews: SearchCacheResultPreview[];
  resultCount: number;
}

export interface SearchCacheIndex {
  version: 1;
  order: string[];
  byKey: Record<string, string>;
  summaries: Record<string, SearchCacheSummary>;
}

export interface SearchCacheEntry {
  id: string;
  cacheKey: string;
  query: string;
  normalizedQuery: string;
  providerId: ProviderId;
  createdAt: number;
  lastAccessedAt: number;
  response: NormalizedSearchResponse;
}

export function emptySearchCacheIndex(): SearchCacheIndex {
  return { version: 1, order: [], byKey: {}, summaries: {} };
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export function makeSearchCacheKey(providerId: ProviderId, query: string): string {
  return `${providerId}:${normalizeSearchQuery(query)}`;
}

export function searchCacheEntryKey(id: string): string {
  return `${SEARCH_CACHE_ENTRY_PREFIX}${id}`;
}

export function isSearchCacheIndex(value: unknown): value is SearchCacheIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SearchCacheIndex>;
  return candidate.version === 1
    && Array.isArray(candidate.order)
    && isPlainRecord(candidate.byKey)
    && isPlainRecord(candidate.summaries);
}

export function buildSearchCacheEntry(response: NormalizedSearchResponse, now = Date.now()): SearchCacheEntry {
  const id = createCacheId();
  const normalizedQuery = normalizeSearchQuery(response.query);
  const cacheKey = makeSearchCacheKey(response.provider, normalizedQuery);
  return {
    id,
    cacheKey,
    query: response.query,
    normalizedQuery,
    providerId: response.provider,
    createdAt: now,
    lastAccessedAt: now,
    response: slimSearchResponse(response),
  };
}

export function buildSearchCacheSummary(entry: SearchCacheEntry): SearchCacheSummary {
  const answerPreview = entry.response.answer?.text ? truncate(entry.response.answer.text.replace(/\s+/g, ' '), MAX_ANSWER_PREVIEW_CHARS) : undefined;
  return {
    id: entry.id,
    cacheKey: entry.cacheKey,
    query: entry.query,
    normalizedQuery: entry.normalizedQuery,
    providerId: entry.providerId,
    createdAt: entry.createdAt,
    lastAccessedAt: entry.lastAccessedAt,
    answerPreview,
    resultPreviews: entry.response.results.slice(0, MAX_SUMMARY_RESULTS).map((result) => ({
      title: result.title,
      url: result.url,
    })),
    resultCount: entry.response.results.length,
  };
}

function slimSearchResponse(response: NormalizedSearchResponse): NormalizedSearchResponse {
  const answer = response.answer
    ? {
        text: truncate(response.answer.text, MAX_CACHED_ANSWER_CHARS),
        citations: response.answer.citations.slice(0, MAX_CACHED_CITATIONS).map((citation) => ({
          url: citation.url,
          title: citation.title,
        })),
      }
    : undefined;
  return {
    query: response.query,
    provider: response.provider,
    answer,
    results: response.results.slice(0, MAX_CACHED_RESULTS).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: truncate(result.snippet, MAX_CACHED_SNIPPET_CHARS),
      score: result.score,
      publishedDate: result.publishedDate,
      favicon: result.favicon,
    })),
  };
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}

function createCacheId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// === 缓存池 schema 迁移：ensureCacheSchema ===
//
// 与 config 域的 ensureSchema 同构，三层短路：
//   - 稳态：读 cacheSchemaVersion 单键 === 当前 → return，~0.1ms，不读缓存。
//   - 首装：缺戳 → 写当前版本（缓存多半空，不读 entry 池）。
//   - 升级：落后 → 读 index + 全部 entry → 跑迁移链 → 写 diff（变更 entry + index + 版本戳）。
//
// 幂等：迁移函数须幂等；worker 被杀则下次重跑（版本戳未更新即重跑安全）。
// 失败兜底：迁移抛异常 → catch → 丢弃整个缓存池（clearSearchCache 语义）+ 盖章当前版本，
//   缓存可重生，不因一次失败永久卡住。此兜底在 ensureCacheSchemaFailedRecovery 中实现。
//
// 注意：本文件不直接 import clearSearchCache（storage.ts），避免循环依赖。
// ensureCacheSchema 内部直接操作 storage key（用 SEARCH_CACHE_INDEX_KEY / 前缀 / 版本戳）。

/** 读 cacheSchemaVersion 单键；缺则 0（首装）。 */
export async function readCacheSchemaVersion(): Promise<number> {
  const got = await browser.storage.local.get(CACHE_SCHEMA_VERSION_KEY);
  const v = got[CACHE_SCHEMA_VERSION_KEY];
  return typeof v === 'number' ? v : 0;
}

/**
 * 纯函数：对缓存池应用从 fromVersion 到 toVersion 的迁移链。供测试用。
 */
export function migrateCachePool(
  pool: { index: SearchCacheIndex; entries: SearchCacheEntry[] },
  fromVersion: number,
  toVersion: number,
  chain: CacheMigration[] = cacheMigrations,
): { index: SearchCacheIndex; entries: SearchCacheEntry[]; dropEntryIds: string[] } {
  let idx = pool.index;
  let entries = pool.entries;
  const dropped = new Set<string>();
  for (const m of chain) {
    if (m.version < fromVersion || m.version >= toVersion) continue;
    const result = m.migrate({ index: idx, entries });
    idx = result.index;
    entries = result.entries;
    for (const id of result.dropEntryIds ?? []) dropped.add(id);
  }
  // 对称清理：从 entries 与 index（order/summaries/byKey）同步剔除已 drop 的 id。
  // 防止迁移只 drop entries 但没改 index 时，index 仍引用已不存在的条目。
  if (dropped.size > 0) {
    entries = entries.filter((e) => !dropped.has(e.id));
    idx = {
      ...idx,
      order: idx.order.filter((id) => !dropped.has(id)),
      summaries: omitKeys(idx.summaries, dropped),
      byKey: omitKeys(idx.byKey, dropped),
    };
  }
  return { index: idx, entries, dropEntryIds: [...dropped] };
}

/** 从 record 中剔除 ids 集合包含的所有键（及其引用）。返回浅拷贝。 */
function omitKeys<T extends Record<string, unknown>>(record: T, ids: Set<string>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!ids.has(k)) out[k] = v;
  }
  return out as T;
}

/**
 * 确保缓存池处于 CURRENT_CACHE_SCHEMA_VERSION。幂等。
 * 不抛异常：迁移失败时丢弃整个缓存池（可重生），盖章当前版本。
 */
export async function ensureCacheSchema(): Promise<void> {
  const stored = await readCacheSchemaVersion();
  if (stored === CURRENT_CACHE_SCHEMA_VERSION) return;
  if (stored > CURRENT_CACHE_SCHEMA_VERSION) return; // 降级：向前兼容
  if (stored === 0) {
    // 首装盖章：缓存多半空，不读 entry 池，仅写版本戳
    await browser.storage.local.set({ [CACHE_SCHEMA_VERSION_KEY]: CURRENT_CACHE_SCHEMA_VERSION });
    return;
  }
  // 升级路径：读 index + 全部 entry → 迁移 → 写 diff
  try {
    await runCacheMigration(stored, CURRENT_CACHE_SCHEMA_VERSION);
  } catch {
    // 兜底：丢弃整个缓存池 + 盖章
    await recoverCacheSchemaByClear();
  }
}

/** 读 index + 全部 entry，跑迁移链，写 diff（变更 entry + index + 版本戳 + 删除 drop）。 */
async function runCacheMigration(fromVersion: number, toVersion: number): Promise<void> {
  const idxGot = await browser.storage.local.get(SEARCH_CACHE_INDEX_KEY);
  const index = isSearchCacheIndex(idxGot[SEARCH_CACHE_INDEX_KEY])
    ? idxGot[SEARCH_CACHE_INDEX_KEY]
    : emptySearchCacheIndex();
  if (index.order.length === 0) {
    // 空池：无需读 entry，直接盖章
    await browser.storage.local.set({ [CACHE_SCHEMA_VERSION_KEY]: toVersion });
    return;
  }
  const entryKeys = index.order.map(searchCacheEntryKey);
  const entriesGot = await browser.storage.local.get(entryKeys);
  const entries: SearchCacheEntry[] = [];
  for (const id of index.order) {
    const e = entriesGot[searchCacheEntryKey(id)];
    if (e) entries.push(e as SearchCacheEntry);
  }
  const result = migrateCachePool({ index, entries }, fromVersion, toVersion);

  // 先删除被 drop 的 entry keys + 索引中已不存在的 entry keys（cleanup）。
  // worker 若在此处被杀，下次启动仍读到旧版本戳 → 重跑幂等迁移 → 最终一致。
  const removeKeys: string[] = [];
  const survivingIds = new Set(result.entries.map((e) => e.id));
  for (const id of result.dropEntryIds) {
    if (!survivingIds.has(id)) removeKeys.push(searchCacheEntryKey(id));
  }
  // 原索引里有、新索引里没有的 id（迁移可能 drop 但没列入 dropEntryIds，
  // 或 #11 的对称清理已从 result.index 移除但 storage 仍残留）
  for (const id of index.order) {
    if (!result.index.summaries[id] && !survivingIds.has(id)) {
      removeKeys.push(searchCacheEntryKey(id));
    }
  }
  if (removeKeys.length > 0) {
    await browser.storage.local.remove(removeKeys);
  }

  // 最后提交：重写全部存活 entry key（迁移后形状可能变）+ index + 版本戳（commit 点）。
  // 版本戳是最后写入，保证 storage 处于已迁移终态后才"承认"升级完成。
  const setObj: Record<string, unknown> = {
    [CACHE_SCHEMA_VERSION_KEY]: toVersion,
    [SEARCH_CACHE_INDEX_KEY]: result.index,
  };
  for (const e of result.entries) {
    setObj[searchCacheEntryKey(e.id)] = e;
  }
  await browser.storage.local.set(setObj);
}

/** 兜底恢复：丢弃整个缓存池（index + 全部 entry）+ 盖章当前版本。
 *  先写空 index + 版本戳（commit 点），再 best-effort 删除残留 entry keys。
 *  worker 若在 set 与 remove 之间被杀，版本戳已更新 → 下次启动跳过迁移，
 *  残留 entry 是无害的孤儿（索引为空，不会被读取，且 bounded by SEARCH_CACHE_CAP）。 */
async function recoverCacheSchemaByClear(): Promise<void> {
  const idxGot = await browser.storage.local.get(SEARCH_CACHE_INDEX_KEY);
  const index = isSearchCacheIndex(idxGot[SEARCH_CACHE_INDEX_KEY])
    ? idxGot[SEARCH_CACHE_INDEX_KEY]
    : emptySearchCacheIndex();
  // 先 commit：空索引 + 版本戳（让 storage 进入可恢复的干净态）
  await browser.storage.local.set({
    [CACHE_SCHEMA_VERSION_KEY]: CURRENT_CACHE_SCHEMA_VERSION,
    [SEARCH_CACHE_INDEX_KEY]: emptySearchCacheIndex(),
  });
  // best-effort 删除残留 entry keys
  const orphanKeys = index.order.map(searchCacheEntryKey);
  if (orphanKeys.length > 0) {
    await browser.storage.local.remove(orphanKeys).catch(() => undefined);
  }
}
