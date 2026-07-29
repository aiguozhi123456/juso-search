import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKey,
  setKey,
  clearKey,
  getConfiguredProviderIds,
  getActiveProviderId,
  setActiveProviderId,
  getActiveSourceId,
  setActiveSourceId,
  selectActiveSourceId,
  getThemePref,
  setThemePref,
  getLocalePref,
  setLocalePref,
  getStylePref,
  setStylePref,
  getSourceOrder,
  setSourceOrder,
  getSourceHidden,
  setSourceHidden,
  getCachedSearch,
  getCachedSearchEntry,
  getSearchCacheSummaries,
  saveCachedSearch,
  deleteCachedSearch,
  clearSearchCache,
  getAgentBridgeEnabled,
  setAgentBridgeEnabled,
  getEngineSearchEnabled,
  setEngineSearchEnabled,
  getSiteEngineDefinitions,
  createSiteEngineDefinition,
  updateSiteEngineDefinition,
  getProviderConfigSnapshot,
  deleteSiteEngineDefinition,
  getGroupConfig,
  setGroupConfig,
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

describe('storage: active source', () => {
  it('defaults to google when nothing configured', async () => {
    expect(await getActiveSourceId()).toBe('google');
  });

  it('explicit baidu engine round-trips without keys', async () => {
    await setActiveSourceId('baidu');
    expect(await getActiveSourceId()).toBe('baidu');
  });

  it('missing activeSource falls back to effective active provider', async () => {
    await setKey('tavily', 'tvly-x');
    await setKey('exa', 'exa-x');
    await setActiveProviderId('exa');
    expect(await getActiveSourceId()).toBe('exa');
  });

  it('stored provider activeSource without key falls back', async () => {
    await setKey('tavily', 'tvly-x');
    await setActiveSourceId('exa');
    expect(await getActiveSourceId()).toBe('tavily');
  });

  it('invalid stored source falls back', async () => {
    await browser.storage.local.set({ activeSource: 'ghost' });
    expect(await getActiveSourceId()).toBe('google');
    await setKey('exa', 'exa-x');
    expect(await getActiveSourceId()).toBe('exa');
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

describe('storage: style pref', () => {
  it('defaults to classic', async () => {
    expect(await getStylePref()).toBe('classic');
  });

  it('round-trips colorful and rejects unknown stored values', async () => {
    await setStylePref('colorful');
    expect(await getStylePref()).toBe('colorful');
    await browser.storage.local.set({ stylePref: 'decorative' });
    expect(await getStylePref()).toBe('classic');
  });
});

describe('storage: agentBridgeEnabled', () => {
  it('defaults to false when unset', async () => {
    expect(await getAgentBridgeEnabled()).toBe(false);
  });

  it('round-trips true and false', async () => {
    await setAgentBridgeEnabled(true);
    expect(await getAgentBridgeEnabled()).toBe(true);
    await setAgentBridgeEnabled(false);
    expect(await getAgentBridgeEnabled()).toBe(false);
  });

  it('rejects truthy-but-not-true stored values', async () => {
    await browser.storage.local.set({ agentBridgeEnabled: 1 });
    expect(await getAgentBridgeEnabled()).toBe(false);
    await browser.storage.local.set({ agentBridgeEnabled: 'true' });
    expect(await getAgentBridgeEnabled()).toBe(false);
  });
});

describe('storage: engineSearchEnabled', () => {
  it('defaults to false when unset', async () => {
    expect(await getEngineSearchEnabled()).toBe(false);
  });

  it('round-trips true and false', async () => {
    await setEngineSearchEnabled(true);
    expect(await getEngineSearchEnabled()).toBe(true);
    await setEngineSearchEnabled(false);
    expect(await getEngineSearchEnabled()).toBe(false);
  });

  it('rejects truthy-but-not-true stored values', async () => {
    await browser.storage.local.set({ engineSearchEnabled: 1 });
    expect(await getEngineSearchEnabled()).toBe(false);
  });
});

describe('storage: source order', () => {
  it('round-trips a normalized complete order', async () => {
    await setSourceOrder(['bing', 'exa', 'google', 'tavily', 'baidu', 'stepfun', 'stepfun-plan']);
    expect(await getSourceOrder()).toEqual(['bing', 'exa', 'google', 'tavily', 'baidu', 'stepfun', 'stepfun-plan', 'brave', 'jina', 'doubao', 'doubao-global', 'douyin', 'xiaohongshu', 'bilibili']);
  });

  it('normalizes invalid stored values', async () => {
    await browser.storage.local.set({ sourceOrder: ['bing', 'ghost', 'bing'] });
    expect(await getSourceOrder()).toEqual(['bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili']);
  });
});

describe('storage: groupConfig', () => {
  it('returns the default group config when unset (all sources grouped by type)', async () => {
    const cfg = await getGroupConfig();
    expect(cfg.groups.map((g) => g.id)).toEqual(['ai-search', 'engines', 'sites']);
    expect(cfg.layout).toEqual([
      { kind: 'group', groupId: 'ai-search' },
      { kind: 'group', groupId: 'engines' },
      { kind: 'group', groupId: 'sites' },
    ]);
    expect(cfg.assignments).toEqual({});
  });

  it('round-trips a pinned + grouped layout, normalizing dirty data', async () => {
    await setGroupConfig({
      groups: [
        { id: 'ai-search', label: { kind: 'i18n', key: 'group_ai_search' } },
        { id: 'engines', label: { kind: 'i18n', key: 'group_engines' } },
        { id: 'sites', label: { kind: 'i18n', key: 'group_sites' } },
        { id: 'custom', label: { kind: 'literal', value: 'Custom' } },
      ],
      layout: [
        { kind: 'source', sourceId: 'google' },
        { kind: 'group', groupId: 'ai-search' },
        { kind: 'group', groupId: 'custom' },
      ],
      assignments: { tavily: 'custom', google: 'ai-search', ghost: 'custom' },
    });
    const cfg = await getGroupConfig();
    // google pinned → its assignment dropped; ghost (unknown source) dropped
    expect(cfg.assignments).toEqual({ tavily: 'custom' });
    expect(cfg.layout).toEqual([
      { kind: 'source', sourceId: 'google' },
      { kind: 'group', groupId: 'ai-search' },
      { kind: 'group', groupId: 'custom' },
    ]);
  });

  it('is included in getProviderConfigSnapshot', async () => {
    await setGroupConfig({
      groups: [{ id: 'ai-search', label: { kind: 'i18n', key: 'group_ai_search' } }],
      layout: [{ kind: 'group', groupId: 'ai-search' }],
      assignments: {},
    });
    const snap = await getProviderConfigSnapshot();
    expect(snap.groupConfig).toBeDefined();
    // missing builtin groups (engines, sites) filled into groups in DEFAULT_GROUPS order;
    // the persisted ai-search is reordered into its canonical position. Layout preserved as stored.
    expect(snap.groupConfig.groups.map((g) => g.id)).toEqual(['ai-search', 'engines', 'sites']);
    expect(snap.groupConfig.layout).toEqual([{ kind: 'group', groupId: 'ai-search' }]);
  });
});

describe('sourceHidden', () => {
  it('returns empty array when unset', async () => {
    expect(await getSourceHidden()).toEqual([]);
  });
  it('persists and reads back a normalized list', async () => {
    await setSourceHidden(['baidu', 'tavily', 'ghost' as never, 'baidu']);
    expect(await getSourceHidden()).toEqual(['baidu', 'tavily']);
  });
  it('keeps at least one usable source visible', async () => {
    await setSourceHidden(['tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili']);
    expect(await getSourceHidden()).not.toContain('google');
  });
  it('normalizes a legacy all-hidden snapshot to retain a visible source', async () => {
    await browser.storage.local.set({ sourceHidden: ['tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili'] });
    const snapshot = await getProviderConfigSnapshot();
    expect(snapshot.sourceHidden).not.toContain('google');
  });
  it('reveals a fallback atomically when clearing the last visible provider key', async () => {
    await browser.storage.local.set({ providerKeys: { tavily: 'key' }, sourceHidden: ['exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili'] });
    await clearKey('tavily');
    const got = await browser.storage.local.get(['providerKeys', 'sourceHidden']);
    expect(got.providerKeys).toEqual({});
    expect(got.sourceHidden).not.toContain('google');
  });
});

describe('storage: Site Engines', () => {
  const site = { id: 'site:123e4567-e89b-12d3-a456-426614174000' as const, name: ' Docs ', target: 'docs.example.com/guide?x=1', engineId: 'google' as const };

  it('defensively drops malformed, duplicate-id, and duplicate-scope persisted definitions', async () => {
    await browser.storage.local.set({ siteEngines: [site, { ...site, name: 'duplicate' }, { id: 'site:other', name: 'same scope', target: 'https://docs.example.com/guide', engineId: 'google' }, { id: 'site:bad id', name: 'bad', target: 'x.com', engineId: 'google' }] });
    await expect(getSiteEngineDefinitions()).resolves.toEqual([{ ...site, name: 'Docs', target: 'https://docs.example.com/guide' }]);
  });

  it('canonicalizes creates, preserves update ids, and rejects duplicate or unknown updates', async () => {
    const created = await createSiteEngineDefinition(site);
    expect(created).toEqual({ ...site, name: 'Docs', target: 'https://docs.example.com/guide' });
    await expect(updateSiteEngineDefinition(created.id, { ...created, name: ' Updated ' })).resolves.toEqual({ ...created, name: 'Updated' });
    await expect(createSiteEngineDefinition({ ...site, id: 'site:other', name: 'same scope' })).rejects.toThrow('invalid_site_engine');
    await expect(updateSiteEngineDefinition('site:unknown', created)).rejects.toThrow('invalid_site_engine');
  });

  it('enforces Site Engine collection and field limits', async () => {
    await expect(createSiteEngineDefinition({ ...site, name: 'x'.repeat(41) })).rejects.toThrow('invalid_site_engine');
    await expect(createSiteEngineDefinition({ ...site, target: `https://example.com/${'x'.repeat(2048)}` })).rejects.toThrow('invalid_site_engine');
    for (let index = 0; index < 50; index += 1) {
      await createSiteEngineDefinition({ ...site, id: `site:${index}`, name: `Site ${index}`, target: `https://example${index}.com/` });
    }
    await expect(createSiteEngineDefinition({ ...site, id: 'site:overflow', name: 'Overflow', target: 'https://overflow.example/' })).rejects.toThrow('invalid_site_engine');
  });

  it('rejects creates that would exceed the serialized byte budget without wiping storage', async () => {
    const siteEnginesMod = await import('@/lib/site-engines');
    const pad = 'x'.repeat(40);
    const seeded = Array.from({ length: 5 }, (_, i) => ({
      id: `site:seed${i}`,
      name: pad,
      target: `https://seed${i}.example.com/`,
      engineId: 'google' as const,
    }));
    await browser.storage.local.set({ siteEngines: seeded });
    // Pure valid collections under the count cap stay below the real byte budget;
    // force the write-path guard so we still assert reject-without-wipe.
    const spy = vi.spyOn(siteEnginesMod, 'siteEnginesSerializedBytes').mockReturnValue(
      siteEnginesMod.MAX_SITE_ENGINES_SERIALIZED_BYTES + 1,
    );
    try {
      const before = await browser.storage.local.get('siteEngines');
      await expect(createSiteEngineDefinition({
        id: 'site:overflow-bytes',
        name: pad,
        target: 'https://overflow-bytes.example.com/',
        engineId: 'google',
      })).rejects.toThrow('invalid_site_engine');
      const after = await browser.storage.local.get('siteEngines');
      expect(after.siteEngines).toEqual(before.siteEngines);
      expect(await getSiteEngineDefinitions()).toHaveLength(seeded.length);
    } finally {
      spy.mockRestore();
    }
  });

  it('reads a non-empty subset when storage already holds an oversize-by-bytes collection', async () => {
    const { MAX_SITE_ENGINES, MAX_SITE_ENGINES_SERIALIZED_BYTES, siteEnginesSerializedBytes } = await import('@/lib/site-engines');
    const pad = 'x'.repeat(40);
    // Bloated raw payload (extra fields) exceeds the byte budget; valid fields remain normalizable.
    const oversized = Array.from({ length: MAX_SITE_ENGINES }, (_, i) => ({
      id: `site:over${i}`,
      name: pad,
      target: `https://over${i}.example.com/${'p'.repeat(1800)}`,
      engineId: 'google' as const,
      junk: 'J'.repeat(2000),
    }));
    expect(siteEnginesSerializedBytes(oversized)).toBeGreaterThan(MAX_SITE_ENGINES_SERIALIZED_BYTES);
    await browser.storage.local.set({ siteEngines: oversized });
    const defs = await getSiteEngineDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]?.id).toBe('site:over0');
    // Create must not wipe prior engines via empty-normalize → write tiny array.
    await expect(createSiteEngineDefinition({
      id: 'site:after-oversize',
      name: 'After',
      target: 'https://after-oversize.example.com/',
      engineId: 'google',
    })).rejects.toThrow('invalid_site_engine');
    const still = await browser.storage.local.get('siteEngines');
    expect((still.siteEngines as unknown[]).length).toBe(oversized.length);
    // Delete can shrink; must not replace with empty-derived wipe of all prior engines.
    await deleteSiteEngineDefinition('site:over0');
    const afterDelete = await getSiteEngineDefinitions();
    expect(afterDelete.some((d) => d.id === 'site:over0')).toBe(false);
    expect(afterDelete.length).toBeGreaterThan(0);
  });

  it('returns one coherent normalized snapshot with a Site Engine active source', async () => {
    await browser.storage.local.set({
      providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: site.id,
      siteEngines: [site], sourceOrder: [site.id, 'bing'], sourceHidden: [site.id, 'ghost'],
    });
    await expect(getProviderConfigSnapshot()).resolves.toMatchObject({
      activeSourceId: site.id,
      siteEngines: [{ ...site, name: 'Docs', target: 'https://docs.example.com/guide' }],
      sourceOrder: [site.id, 'bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili'],
      sourceHidden: [site.id],
    });
  });

  it('deleting an active Site Engine removes graph references and selects a valid fallback', async () => {
    await createSiteEngineDefinition(site);
    await browser.storage.local.set({ activeSource: site.id, sourceOrder: [site.id, 'bing'], sourceHidden: [site.id] });
    await deleteSiteEngineDefinition(site.id);
    const got = await browser.storage.local.get(['siteEngines', 'sourceOrder', 'sourceHidden', 'activeSource']);
    expect(got.siteEngines).toEqual([]);
    expect(got.sourceOrder).not.toContain(site.id);
    expect(got.sourceHidden).not.toContain(site.id);
    expect(got.activeSource).toBe('bing');
  });

  it('deleting an active Site Engine skips hidden fallback sources', async () => {
    await createSiteEngineDefinition(site);
    await browser.storage.local.set({ activeSource: site.id, sourceOrder: [site.id, 'bing', 'google'], sourceHidden: ['bing'] });
    await deleteSiteEngineDefinition(site.id);
    expect((await browser.storage.local.get('activeSource')).activeSource).toBe('google');
  });

  it('serializes selection with deletion so a removed Site Engine cannot become active', async () => {
    await createSiteEngineDefinition(site);
    const deletion = deleteSiteEngineDefinition(site.id);
    const selection = selectActiveSourceId(site.id);
    await deletion;
    await expect(selection).rejects.toThrow('invalid_source');
    expect((await browser.storage.local.get('activeSource')).activeSource).not.toBe(site.id);
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
    expect(summary.resultCount).toBe(12);
    expect(hit?.response.answer?.text).toHaveLength(2000);
    expect(hit?.response.answer?.citations).toHaveLength(10);
    expect(hit?.response.results).toHaveLength(12);
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
