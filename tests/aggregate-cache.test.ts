import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AGGREGATE_CACHE_PROVIDER_ID,
  SEARCH_CACHE_CAP,
  SEARCH_CACHE_INDEX_KEY,
  buildAggregateCacheEntry,
  buildSearchCacheEntry,
  buildSearchCacheSummary,
  isAggregateCacheEntry,
  isAggregateCacheSummary,
  makeSearchCacheKey,
  slimAggregateResponse,
  type SearchCacheEntry,
  type SearchCacheIndex,
} from '@/lib/search-cache';
import {
  deleteAggregateCacheEntries,
  getCachedSearch,
  getSearchCacheSummaries,
  saveCachedAggregateSearch,
  saveCachedSearch,
} from '@/lib/storage';
import type { AggregateInstanceId, AggregateSearchResponse } from '@/lib/aggregate/types';
import type { NormalizedSearchResponse } from '@/lib/providers/types';

// 聚合缓存路径回归（KTD7/KTD9）：agg entry round-trip、slim各界、scope 删除（共池 LRU）、
// summary agg 分支（Oracle F8）、键同源审计。mock 内存 storage，沿 tests/search-cache-schema.test.ts 模式。

function installStorage(seed: Record<string, unknown> = {}): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed));
  vi.stubGlobal('browser', {
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
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

const AGG_A: AggregateInstanceId = 'agg:aaaa';
const AGG_B: AggregateInstanceId = 'agg:bbbb';

function aggResponse(overrides: Partial<AggregateSearchResponse> = {}): AggregateSearchResponse {
  return {
    instanceId: AGG_A,
    query: 'hello world',
    kind: 'aggregate',
    answers: [
      { sourceId: 'tavily', answer: { text: 'answer from tavily', citations: [{ url: 'https://a.test/1', title: 'A1' }] } },
    ],
    results: [
      { title: 'R1', url: 'https://r1.test/a', snippet: 's1', sources: ['tavily', 'exa'], score: 0.9 },
      { title: 'R2', url: 'https://r2.test/b', snippet: 's2', sources: ['exa'], score: 0.5 },
    ],
    members: [
      { sourceId: 'tavily', ok: true, cached: true, resultCount: 2 },
      { sourceId: 'exa', ok: false, errorKind: 'unauthorized', errorMessage: 'bad key' },
    ],
    dedupedCount: 3,
    rerank: { model: 'bge-reranker-base', rerankedAt: 1234 },
    ...overrides,
  };
}

function providerResponse(query = 'hello world'): NormalizedSearchResponse {
  return { query, provider: 'tavily', results: [{ title: 'P1', url: 'https://p.test/1', snippet: 'ps' }] };
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aggregate cache entry (KTD7)', () => {
  it('round-trips through the shared pool with the agg-instance-id key', async () => {
    const saved = await saveCachedAggregateSearch(aggResponse());

    // 键同源审计：cacheKey = makeSearchCacheKey(aggInstanceId, normalizedQuery)（IU6 镜像）。
    expect(saved.cacheKey).toBe('agg:aaaa:hello world');
    expect(saved.cacheKey).toBe(makeSearchCacheKey(AGG_A, '  hello   world '));
    expect(saved.instanceId).toBe(AGG_A);

    // 读侧同键命中（与 gateway 的 getCachedSearch(aggInstanceId, …) 同一入口）。
    const cached = await getCachedSearch(AGG_A, 'hello world');
    expect(cached).not.toBeNull();
    expect(cached!.id).toBe(saved.id);
    expect(isAggregateCacheEntry(cached!)).toBe(true);
    const response = cached!.response as unknown as AggregateSearchResponse;
    expect(response.kind).toBe('aggregate');
    expect(response.instanceId).toBe(AGG_A);
    expect(response.answers).toEqual([{ sourceId: 'tavily', answer: { text: 'answer from tavily', citations: [{ url: 'https://a.test/1', title: 'A1' }] } }]);
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toMatchObject({ url: 'https://r1.test/a', score: 0.9, sources: ['tavily', 'exa'] });
    expect(response.members).toEqual(aggResponse().members);
    // dedupedCount 随 slim 白名单保真（R13 meta 条「去重 D 条」的数据源）。
    expect(response.dedupedCount).toBe(3);
    expect(response.rerank).toEqual({ model: 'bge-reranker-base', rerankedAt: 1234 });
  });

  it('applies the KTD7 slim bounds (answers 2000/citations 10, results 20/snippet 1000) and keeps provenance', () => {
    const big = aggResponse({
      answers: [{
        sourceId: 'tavily',
        answer: {
          text: 'x'.repeat(3000),
          citations: Array.from({ length: 30 }, (_, i) => ({ url: `https://c.test/${i}`, title: `C${i}` })),
        },
      }],
      results: Array.from({ length: 30 }, (_, i) => ({
        title: `T${i}`,
        url: `https://t.test/${i}`,
        snippet: 'y'.repeat(1500),
        content: 'SECRET-CONTENT',
        score: i,
        sources: ['tavily', 'exa'] as ['tavily', 'exa'],
      })),
    });
    const slim = slimAggregateResponse(big);

    expect(slim.answers[0].answer.text).toHaveLength(2000);
    expect(slim.answers[0].answer.citations).toHaveLength(10);
    expect(slim.results).toHaveLength(20);
    expect(slim.results[0].snippet).toHaveLength(1000);
    // provenance 与 score 保留；content 不入缓存（白名单拷贝）。
    expect(slim.results[0].sources).toEqual(['tavily', 'exa']);
    expect(slim.results[0].score).toBe(0);
    expect('content' in slim.results[0]).toBe(false);
    // members/rerank 全保。
    expect(slim.members).toEqual(big.members);
    expect(slim.rerank).toEqual(big.rerank);
  });

  it('replaces the entry on the same instance+query key instead of duplicating', async () => {
    await saveCachedAggregateSearch(aggResponse());
    await saveCachedAggregateSearch(aggResponse({ rerank: { rerankedAt: 999 } }));

    const summaries = await getSearchCacheSummaries();
    expect(summaries).toHaveLength(1);
    const cached = await getCachedSearch(AGG_A, 'hello world');
    expect((cached!.response as unknown as AggregateSearchResponse).rerank.rerankedAt).toBe(999);
  });
});

describe('deleteAggregateCacheEntries scope (KTD9)', () => {
  it('deletes only the targeted instance entries; other aggregates and provider history survive', async () => {
    await saveCachedAggregateSearch(aggResponse()); // agg:aaaa
    await saveCachedAggregateSearch(aggResponse({ instanceId: AGG_B })); // agg:bbbb
    await saveCachedSearch(providerResponse()); // provider 历史条目
    expect(await getSearchCacheSummaries()).toHaveLength(3);

    await deleteAggregateCacheEntries(AGG_A);

    const afterInstanceDelete = await getSearchCacheSummaries();
    expect(afterInstanceDelete).toHaveLength(2);
    expect(afterInstanceDelete.some((s) => s.instanceId === AGG_B)).toBe(true);
    expect(afterInstanceDelete.some((s) => s.providerId === 'tavily')).toBe(true);
    expect(await getCachedSearch(AGG_A, 'hello world')).toBeNull();
    expect(await getCachedSearch(AGG_B, 'hello world')).not.toBeNull();

    await deleteAggregateCacheEntries('all');

    const afterAll = await getSearchCacheSummaries();
    expect(afterAll).toHaveLength(1);
    expect(afterAll[0].providerId).toBe('tavily'); // provider 历史存活（AE5）
    expect(await getCachedSearch(AGG_B, 'hello world')).toBeNull();
  });

  it('is a no-op when there are no aggregate entries', async () => {
    await saveCachedSearch(providerResponse());
    await deleteAggregateCacheEntries('all');
    expect(await getSearchCacheSummaries()).toHaveLength(1);
  });
});

describe('shared pool LRU (KTD9 cap 100)', () => {
  it('evicts the least-recently-used entry across aggregate and provider entries alike', async () => {
    expect(SEARCH_CACHE_CAP).toBe(100);
    // 混合填充 101 条（聚合 60 + provider 41）；单条 entry 尽量小以保持测试轻量。
    for (let i = 0; i < 60; i += 1) {
      await saveCachedAggregateSearch(aggResponse({ instanceId: 'agg:bulk', query: `agg-q-${i}` }));
    }
    for (let i = 0; i < 41; i += 1) {
      await saveCachedSearch(providerResponse(`p-q-${i}`));
    }
    expect(await getSearchCacheSummaries()).toHaveLength(SEARCH_CACHE_CAP);
    // 最老条目（agg-q-0）被淘汰。
    expect(await getCachedSearch('agg:bulk', 'agg-q-0')).toBeNull();
    expect(await getCachedSearch('agg:bulk', 'agg-q-1')).not.toBeNull();

    // 命中会 touch LRU：再写 1 条后，agg-q-1（刚命中）存活、agg-q-2 被淘汰。
    await getCachedSearch('agg:bulk', 'agg-q-1');
    await saveCachedAggregateSearch(aggResponse({ instanceId: 'agg:bulk', query: 'agg-q-new' }));
    expect(await getCachedSearch('agg:bulk', 'agg-q-1')).not.toBeNull();
    expect(await getCachedSearch('agg:bulk', 'agg-q-2')).toBeNull();
  });
});

describe('buildSearchCacheSummary aggregate branch (Oracle F8)', () => {
  it('uses the aggregate sentinel + instanceId and previews answers[0]', () => {
    const entry = buildAggregateCacheEntry(aggResponse());
    const summary = buildSearchCacheSummary(entry);
    expect(String(summary.providerId)).toBe(AGGREGATE_CACHE_PROVIDER_ID);
    expect(summary.instanceId).toBe(AGG_A);
    expect(summary.answerPreview).toBe('answer from tavily');
    expect(summary.resultCount).toBe(2);
    expect(summary.resultPreviews).toHaveLength(2);
    expect(isAggregateCacheSummary(summary)).toBe(true);
  });

  it('truncates the answer preview and omits it when there are no answers', () => {
    const long = buildAggregateCacheEntry(aggResponse({
      answers: [{ sourceId: 'tavily', answer: { text: 'a'.repeat(300), citations: [] } }],
    }));
    expect(buildSearchCacheSummary(long).answerPreview).toHaveLength(160);

    const none = buildAggregateCacheEntry(aggResponse({ answers: [] }));
    expect(buildSearchCacheSummary(none).answerPreview).toBeUndefined();
  });

  it('leaves solo entries on the solo branch', () => {
    const solo: SearchCacheEntry = buildSearchCacheEntry(providerResponse());
    const summary = buildSearchCacheSummary(solo);
    expect(summary.providerId).toBe('tavily');
    expect(summary.instanceId).toBeUndefined();
    expect(summary.answerPreview).toBeUndefined();
    expect(isAggregateCacheEntry(solo)).toBe(false);
    expect(isAggregateCacheSummary(summary)).toBe(false);
  });
});

describe('aggregate index integrity', () => {
  it('keeps the index well-formed after aggregate writes', async () => {
    await saveCachedAggregateSearch(aggResponse());
    const index = (await browser.storage.local.get(SEARCH_CACHE_INDEX_KEY))[SEARCH_CACHE_INDEX_KEY] as SearchCacheIndex;
    expect(index.order).toHaveLength(1);
    expect(index.byKey['agg:aaaa:hello world']).toBe(index.order[0]);
    expect(index.summaries[index.order[0]].resultCount).toBe(2);
  });
});
