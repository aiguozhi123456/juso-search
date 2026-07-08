import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureCacheSchema,
  readCacheSchemaVersion,
  migrateCachePool,
  CURRENT_CACHE_SCHEMA_VERSION,
  CACHE_SCHEMA_VERSION_KEY,
  emptySearchCacheIndex,
  type CacheMigration,
  type SearchCacheEntry,
  type SearchCacheIndex,
} from '@/lib/search-cache';
import type { NormalizedSearchResponse } from '@/lib/providers/types';

// 内存版 chrome.storage.local，支持 get(string | string[] | null) + set + remove。
function installStorage(seed: Record<string, unknown> = {}): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed));
  vi.stubGlobal('browser', {
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          if (typeof keys === 'string') {
            return store.has(keys) ? { [keys]: store.get(keys) } : {};
          }
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (store.has(k)) out[k] = store.get(k);
            return out;
          }
          return {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
      },
    },
  });
  return { store };
}

function entry(id: string, overrides: Partial<SearchCacheEntry> = {}): SearchCacheEntry {
  return {
    id,
    cacheKey: `tavily:${id}`,
    query: id,
    normalizedQuery: id,
    providerId: 'tavily',
    createdAt: 1000,
    lastAccessedAt: 1000,
    response: { query: id, provider: 'tavily', results: [{ title: id, url: `https://${id}.test`, snippet: 's' }] },
    ...overrides,
  };
}

function indexWith(entries: SearchCacheEntry[]): SearchCacheIndex {
  const index = emptySearchCacheIndex();
  for (const e of entries) {
    index.byKey[e.cacheKey] = e.id;
    index.summaries[e.id] = {
      id: e.id,
      cacheKey: e.cacheKey,
      query: e.query,
      normalizedQuery: e.normalizedQuery,
      providerId: e.providerId,
      createdAt: e.createdAt,
      lastAccessedAt: e.lastAccessedAt,
      resultCount: e.response.results.length,
      resultPreviews: [],
    };
    index.order.push(e.id);
  }
  return index;
}

beforeEach(() => {
  installStorage();
});

describe('ensureCacheSchema: stamping (first install)', () => {
  it('writes CURRENT_CACHE_SCHEMA_VERSION when the version key is missing', async () => {
    await ensureCacheSchema();
    expect(await readCacheSchemaVersion()).toBe(CURRENT_CACHE_SCHEMA_VERSION);
  });

  it('stamps without reading the entry pool when version missing', async () => {
    // 首装路径应只读版本键，不读 index/entry（缓存多半空）
    installStorage({ searchCacheIndex: emptySearchCacheIndex() });
    const getSpy = vi.spyOn(browser.storage.local, 'get');
    await ensureCacheSchema();
    // 第一次读版本键；不应有读 index 的大批量调用
    expect(getSpy.mock.calls[0][0]).toBe(CACHE_SCHEMA_VERSION_KEY);
  });
});

describe('ensureCacheSchema: steady state', () => {
  it('does not write when already at CURRENT_CACHE_SCHEMA_VERSION', async () => {
    installStorage({ [CACHE_SCHEMA_VERSION_KEY]: CURRENT_CACHE_SCHEMA_VERSION });
    const setSpy = vi.spyOn(browser.storage.local, 'set');
    await ensureCacheSchema();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('only reads the version key in steady state', async () => {
    installStorage({ [CACHE_SCHEMA_VERSION_KEY]: CURRENT_CACHE_SCHEMA_VERSION });
    const getSpy = vi.spyOn(browser.storage.local, 'get');
    await ensureCacheSchema();
    expect(getSpy.mock.calls[0][0]).toBe(CACHE_SCHEMA_VERSION_KEY);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe('ensureCacheSchema: downgrade tolerance', () => {
  it('ignores a stored version higher than current', async () => {
    installStorage({ [CACHE_SCHEMA_VERSION_KEY]: 999 });
    const setSpy = vi.spyOn(browser.storage.local, 'set');
    await ensureCacheSchema();
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('migrateCachePool (pure migration runner)', () => {
  it('runs migrations in version order', () => {
    const chain: CacheMigration[] = [
      { version: 1, migrate: ({ index, entries }) => ({ index, entries: entries.map((e) => ({ ...e, query: `${e.query}-v2` })) }) },
    ];
    const out = migrateCachePool({ index: indexWith([entry('a')]), entries: [entry('a')] }, 1, 2, chain);
    expect(out.entries[0].query).toBe('a-v2');
  });

  it('drops entries listed in dropEntryIds', () => {
    const chain: CacheMigration[] = [
      { version: 1, migrate: ({ index, entries }) => ({
        index: { ...index, order: index.order.filter((id) => id !== 'b'), summaries: omit(index.summaries, 'b') },
        entries,
        dropEntryIds: ['b'],
      }) },
    ];
    const out = migrateCachePool({ index: indexWith([entry('a'), entry('b')]), entries: [entry('a'), entry('b')] }, 1, 2, chain);
    expect(out.entries.map((e) => e.id)).toEqual(['a']);
    expect(out.dropEntryIds).toEqual(['b']);
  });

  it('is idempotent when migrations are pure', () => {
    // 幂等迁移示例：把 lastAccessedAt 设为固定值（而非累加/追加），跑两次结果一致。
    const chain: CacheMigration[] = [
      { version: 1, migrate: ({ index, entries }) => ({
        index,
        entries: entries.map((e) => ({ ...e, lastAccessedAt: 9999 })),
      }) },
    ];
    const input = { index: indexWith([entry('a')]), entries: [entry('a')] };
    const once = migrateCachePool(input, 1, 2, chain);
    const twice = migrateCachePool(once, 1, 2, chain);
    expect(twice).toEqual(once);
    expect(once.entries[0].lastAccessedAt).toBe(9999);
  });

  it('real-world scenario: answer.text -> answer.parts', () => {
    const withAnswer = entry('a', {
      response: {
        query: 'a', provider: 'tavily',
        answer: { text: 'hello', citations: [{ url: 'https://x.test' }] },
        results: [],
      } as NormalizedSearchResponse,
    });
    const chain: CacheMigration[] = [
      { version: 1, migrate: ({ index, entries }) => ({
        index,
        entries: entries.map((e): SearchCacheEntry => {
          if (!e.response.answer) return e;
          return {
            ...e,
            response: {
              ...e.response,
              answer: { parts: [e.response.answer.text], citations: e.response.answer.citations },
            },
          } as unknown as SearchCacheEntry;
        }),
      }) },
    ];
    const out = migrateCachePool({ index: indexWith([withAnswer]), entries: [withAnswer] }, 1, 2, chain);
    expect((out.entries[0].response as { answer?: { parts?: string[] } }).answer?.parts).toEqual(['hello']);
  });
});

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const out = { ...obj };
  delete (out as Record<string, unknown>)[key];
  return out;
}
