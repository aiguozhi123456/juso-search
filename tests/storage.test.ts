import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKey,
  setKey,
  clearKey,
  getConfiguredProviderIds,
  getActiveProviderId,
  setActiveProviderId,
  getThemePref,
  setThemePref,
  getLocalePref,
  setLocalePref,
  getCachedSearch,
  getCachedSearchEntry,
  getSearchCacheSummaries,
  saveCachedSearch,
  deleteCachedSearch,
  clearSearchCache,
} from '@/lib/storage';
import { SEARCH_CACHE_CAP } from '@/lib/search-cache';
import type { NormalizedSearchResponse } from '@/lib/providers/types';

// 内存版 chrome.storage.local，实现 storage.ts 用到的 get(null)/get(string)/get(string[])/set/remove。
function installStorage(): void {
  const store = new Map<string, unknown>();
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
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        },
      },
    },
  });
}

function responseFixture(overrides: Partial<NormalizedSearchResponse> = {}): NormalizedSearchResponse {
  return {
    query: 'hello world',
    provider: 'tavily',
    answer: {
      text: 'A'.repeat(2500),
      citations: Array.from({ length: 12 }, (_, i) => ({ url: `https://cite-${i}.test`, title: `C${i}` })),
    },
    results: Array.from({ length: 12 }, (_, i) => ({
      title: `R${i}`,
      url: `https://r-${i}.test`,
      snippet: i === 0 ? 'S'.repeat(1200) : `snippet ${i}`,
      content: `content ${i}`,
      score: i,
      publishedDate: '2026-07-07',
      favicon: `https://r-${i}.test/favicon.ico`,
    })),
    ...overrides,
  };
}

beforeEach(() => {
  installStorage();
});

describe('storage: BYOK keys', () => {
  it('round-trips a key', async () => {
    await setKey('tavily', 'tvly-abc');
    expect(await getKey('tavily')).toBe('tvly-abc');
  });

  it('returns null for missing key', async () => {
    expect(await getKey('exa')).toBeNull();
  });

  it('returns configured provider ids in registry order', async () => {
    await setKey('stepfun', 'sf-2');
    await setKey('tavily', 'tvly-1');
    expect(await getConfiguredProviderIds()).toEqual(['tavily', 'stepfun']);
  });

  it('ignores unknown provider ids when listing configured providers', async () => {
    await browser.storage.local.set({ providerKeys: { nonexistent: 'x', exa: 'exa-1' } });
    expect(await getConfiguredProviderIds()).toEqual(['exa']);
  });

  it('clearKey removes only that provider', async () => {
    await setKey('tavily', 'tvly-1');
    await setKey('exa', 'exa-2');
    await clearKey('tavily');
    expect(await getKey('tavily')).toBeNull();
    expect(await getKey('exa')).toBe('exa-2');
  });
});

describe('storage: active provider', () => {
  it('defaults to null when nothing configured', async () => {
    expect(await getActiveProviderId()).toBeNull();
  });

  it('falls back to first configured provider (registry order)', async () => {
    // registry order: tavily, exa, stepfun, stepfun-plan
    await setKey('exa', 'exa-x');
    await setKey('stepfun', 'sf-x');
    expect(await getActiveProviderId()).toBe('exa');
  });

  it('explicit choice wins over fallback', async () => {
    await setKey('tavily', 'tvly-x');
    await setKey('exa', 'exa-x');
    await setActiveProviderId('exa');
    expect(await getActiveProviderId()).toBe('exa');
  });

  it('falls back when explicit choice has no key', async () => {
    await setKey('tavily', 'tvly-x');
    await setActiveProviderId('stepfun');
    expect(await getActiveProviderId()).toBe('tavily');
  });

  it('falls back to first configured when stored active id is invalid', async () => {
    // 直接向 mock 存储写一个不存在的 provider id
    await browser.storage.local.set({ activeProvider: 'nonexistent' });
    await setKey('exa', 'exa-x');
    expect(await getActiveProviderId()).toBe('exa');
  });

  it('setActiveProviderId(null) falls back to first configured', async () => {
    await setKey('exa', 'exa-x');
    await setActiveProviderId('exa');
    expect(await getActiveProviderId()).toBe('exa');
    await setActiveProviderId(null);
    expect(await getActiveProviderId()).toBe('exa');
  });
});

describe('storage: theme pref', () => {
  it('defaults to auto', async () => {
    expect(await getThemePref()).toBe('auto');
  });

  it('round-trips explicit prefs', async () => {
    await setThemePref('dark');
    expect(await getThemePref()).toBe('dark');
    await setThemePref('light');
    expect(await getThemePref()).toBe('light');
    await setThemePref('auto');
    expect(await getThemePref()).toBe('auto');
  });

  it('rejects unknown stored values, falling back to auto', async () => {
    await browser.storage.local.set({ themePref: 'neon' });
    expect(await getThemePref()).toBe('auto');
  });
});

describe('storage: locale pref', () => {
  it('defaults to auto', async () => {
    expect(await getLocalePref()).toBe('auto');
  });

  it('round-trips explicit prefs', async () => {
    await setLocalePref('zh_CN');
    expect(await getLocalePref()).toBe('zh_CN');
    await setLocalePref('en');
    expect(await getLocalePref()).toBe('en');
    await setLocalePref('auto');
    expect(await getLocalePref()).toBe('auto');
  });

  it('rejects unknown stored values, falling back to auto', async () => {
    await browser.storage.local.set({ localePref: 'fr' });
    expect(await getLocalePref()).toBe('auto');
  });
});

describe('storage: local search cache', () => {
  it('returns null on cache miss', async () => {
    expect(await getCachedSearch('tavily', 'hello')).toBeNull();
  });

  it('hits by provider and normalized query without crossing providers', async () => {
    await saveCachedSearch(responseFixture({ query: ' hello   world ' }));

    const hit = await getCachedSearch('tavily', 'hello world');
    expect(hit?.response.query).toBe(' hello   world ');
    expect(await getCachedSearch('exa', 'hello world')).toBeNull();
  });

  it('stores a slim replayable response and summary', async () => {
    await saveCachedSearch(responseFixture());

    const [summary] = await getSearchCacheSummaries();
    const hit = await getCachedSearchEntry(summary.id);

    expect(summary.answerPreview).toHaveLength(160);
    expect(summary.resultPreviews).toHaveLength(3);
    expect(summary.resultCount).toBe(10);
    expect(hit?.response.answer?.text).toHaveLength(2000);
    expect(hit?.response.answer?.citations).toHaveLength(10);
    expect(hit?.response.results).toHaveLength(10);
    expect(hit?.response.results[0].snippet).toHaveLength(1000);
    expect(hit?.response.results[0]).not.toHaveProperty('content');
  });

  it('replaces an existing provider/query cache entry', async () => {
    await saveCachedSearch(responseFixture({ results: [{ title: 'old', url: 'https://old.test', snippet: 'old' }] }));
    await saveCachedSearch(responseFixture({ results: [{ title: 'new', url: 'https://new.test', snippet: 'new' }] }));

    const summaries = await getSearchCacheSummaries();
    const hit = await getCachedSearch('tavily', 'hello world');
    expect(summaries).toHaveLength(1);
    expect(hit?.response.results[0].title).toBe('new');
  });

  it('returns a cached entry even when LRU touch persistence fails', async () => {
    await saveCachedSearch(responseFixture({ query: 'cached' }));
    const originalSet = browser.storage.local.set;
    browser.storage.local.set = async () => {
      throw new Error('quota');
    };

    const hit = await getCachedSearch('tavily', 'cached');

    expect(hit?.query).toBe('cached');
    browser.storage.local.set = originalSet;
  });

  it('deletes a single cached entry', async () => {
    await saveCachedSearch(responseFixture({ query: 'one' }));
    await saveCachedSearch(responseFixture({ query: 'two' }));
    const [first] = await getSearchCacheSummaries();

    await deleteCachedSearch(first.id);

    expect(await getCachedSearchEntry(first.id)).toBeNull();
    expect(await getSearchCacheSummaries()).toHaveLength(1);
  });

  it('clears all indexed cached entries', async () => {
    await saveCachedSearch(responseFixture({ query: 'one' }));
    await saveCachedSearch(responseFixture({ query: 'two' }));

    await clearSearchCache();

    expect(await getSearchCacheSummaries()).toEqual([]);
    expect(await getCachedSearch('tavily', 'one')).toBeNull();
  });

  it('enforces the cache capacity', async () => {
    for (let i = 0; i < SEARCH_CACHE_CAP + 1; i += 1) {
      await saveCachedSearch(responseFixture({ query: `q-${i}` }));
    }

    const summaries = await getSearchCacheSummaries();
    expect(summaries).toHaveLength(SEARCH_CACHE_CAP);
    expect(summaries[0].query).toBe(`q-${SEARCH_CACHE_CAP}`);
    expect(await getCachedSearch('tavily', 'q-0')).toBeNull();
  });
});
