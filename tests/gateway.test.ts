import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProviderAdapter } from '@/lib/providers/types';
import { ProviderError } from '@/lib/providers/types';
import { defaultGroupConfig } from '@/lib/source-groups';

vi.mock('@/lib/storage', () => ({
  clearKey: vi.fn(),
  clearProviderMaxResults: vi.fn().mockResolvedValue(undefined),
  clearSearchCache: vi.fn(),
  deleteCachedSearch: vi.fn(),
  getActiveProviderId: vi.fn(),
  getActiveSourceId: vi.fn(),
  getCachedSearch: vi.fn(),
  getCachedSearchEntry: vi.fn(),
  getConfiguredProviderIds: vi.fn(),
  getKey: vi.fn(),
  getProviderMaxResults: vi.fn().mockResolvedValue(null),
  getSearchCacheSummaries: vi.fn(),
  getSourceHidden: vi.fn(),
  getSourceOrder: vi.fn(),
  getProviderConfigSnapshot: vi.fn(),
  getSiteEngineDefinitions: vi.fn(),
  saveCachedSearch: vi.fn(),
  setActiveProviderId: vi.fn(),
  setActiveProviderAndSourceId: vi.fn(),
  setActiveSourceId: vi.fn(),
  selectActiveSourceId: vi.fn(),
  setKey: vi.fn(),
  setProviderMaxResults: vi.fn().mockResolvedValue(undefined),
  setSourceHidden: vi.fn(),
  setSourceOrder: vi.fn(),
  setGroupConfig: vi.fn().mockResolvedValue(undefined),
  createSiteEngineDefinition: vi.fn(),
  updateSiteEngineDefinition: vi.fn(),
  deleteSiteEngineDefinition: vi.fn(),
  createCustomEngineDefinition: vi.fn(),
  updateCustomEngineDefinition: vi.fn(),
  deleteCustomEngineDefinition: vi.fn(),
  getProviderInstances: vi.fn(),
  createProviderInstance: vi.fn(),
  updateProviderInstance: vi.fn(),
  deleteProviderInstance: vi.fn(),
  ensureDefaultInstance: vi.fn(),
}));

vi.mock('@/lib/providers/registry', () => ({
  allProviders: vi.fn(() => [
    { id: 'tavily', label: 'provider_tavily', supportsAnswer: true },
    { id: 'exa', label: 'provider_exa', supportsAnswer: true },
    { id: 'stepfun', label: 'provider_stepfun', supportsAnswer: false },
    { id: 'stepfun-plan', label: 'provider_stepfun_plan', supportsAnswer: true },
    { id: 'jina', label: 'provider_jina', supportsAnswer: false },
    { id: 'doubao', label: 'provider_doubao', supportsAnswer: false, favicon: '/icons/doubao.svg' },
    { id: 'doubao-global', label: 'provider_doubao_global', supportsAnswer: false, favicon: '/icons/doubao.svg' },
  ]),
  getAdapter: vi.fn(),
}));

// schema 启动护栏短路：gateway 模块加载即触发 schemaReady IIFE，
// 这里把两个 ensure mock 为 no-op，使 schemaReady 立即 resolve（不依赖 browser.storage）。
vi.mock('@/lib/schema', () => ({ ensureSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/search-cache', () => ({
  ensureCacheSchema: vi.fn().mockResolvedValue(undefined),
}));

// config-io 内部直接访问 browser.storage / browser.downloads，这里整体 mock 为可控函数。
vi.mock('@/lib/config-io', () => ({
  buildExportPayload: vi.fn(),
  parseImportPayload: vi.fn(),
  previewImport: vi.fn(),
  mergeImport: vi.fn(),
}));

import {
  handleClearSearchCache,
  handleClearProviderMaxResults,
  handleCreateSiteEngine,
  handleCreateCustomEngine,
  handleDeleteSiteEngine,
  handleDeleteCustomEngine,
  handleDeleteCachedSearch,
  handleDeleteProviderKey,
  handleExportConfig,
  handleGetCachedSearchEntry,
  handleGetProviderConfig,
  handleGetSearchCacheSummaries,
  handleImportConfig,
  handleSaveProviderKey,
  handleSearch,
  handleSetActiveProvider,
  handleSetActiveSource,
  handleSetProviderMaxResults,
  handleSetSourceOrder,
  handleSetSourceHidden,
  handleSetGroupConfig,
  handleTestKey,
  handleUpdateSiteEngine,
  handleUpdateCustomEngine,
  resolveInstance,
  handleSearchInstance,
  handleListAgentInstances,
  handleListAgentProviders,
  handleCreateProviderInstance,
  handleUpdateProviderInstance,
  handleDeleteProviderInstance,
} from '@/lib/gateway';
import {
  clearKey,
  clearProviderMaxResults,
  clearSearchCache,
  deleteCachedSearch,
  getActiveProviderId,
  getCachedSearch,
  getCachedSearchEntry,
  getConfiguredProviderIds,
  getKey,
  getProviderMaxResults,
  getSearchCacheSummaries,
  getSourceHidden,
  getSourceOrder,
  getProviderConfigSnapshot,
  saveCachedSearch,
  setActiveProviderId,
  setActiveProviderAndSourceId,
  selectActiveSourceId,
  setKey,
  setProviderMaxResults,
  setSourceHidden,
  setSourceOrder,
  setGroupConfig,
  createSiteEngineDefinition,
  updateSiteEngineDefinition,
  deleteSiteEngineDefinition,
  createCustomEngineDefinition,
  updateCustomEngineDefinition,
  deleteCustomEngineDefinition,
  getProviderInstances,
  createProviderInstance,
  updateProviderInstance,
  deleteProviderInstance,
  ensureDefaultInstance,
} from '@/lib/storage';
import { getAdapter } from '@/lib/providers/registry';
import { buildExportPayload, parseImportPayload, mergeImport } from '@/lib/config-io';
import type { ConfigExport, ImportReport } from '@/lib/config-io';

const mockedGetActive = vi.mocked(getActiveProviderId);
const mockedGetProviderConfigSnapshot = vi.mocked(getProviderConfigSnapshot);
const mockedClearSearchCache = vi.mocked(clearSearchCache);
const mockedDeleteCachedSearch = vi.mocked(deleteCachedSearch);
const mockedGetCachedSearch = vi.mocked(getCachedSearch);
const mockedGetCachedSearchEntry = vi.mocked(getCachedSearchEntry);
const mockedGetConfigured = vi.mocked(getConfiguredProviderIds);
const mockedGetSourceOrder = vi.mocked(getSourceOrder);
const mockedGetSourceHidden = vi.mocked(getSourceHidden);
const mockedGetKey = vi.mocked(getKey);
const mockedGetProviderMaxResults = vi.mocked(getProviderMaxResults);
const mockedGetSearchCacheSummaries = vi.mocked(getSearchCacheSummaries);
const mockedSaveCachedSearch = vi.mocked(saveCachedSearch);
const mockedSetActive = vi.mocked(setActiveProviderId);
const mockedSetActiveAndSource = vi.mocked(setActiveProviderAndSourceId);
const mockedSelectActiveSource = vi.mocked(selectActiveSourceId);
const mockedSetKey = vi.mocked(setKey);
const mockedSetProviderMaxResults = vi.mocked(setProviderMaxResults);
const mockedSetSourceOrder = vi.mocked(setSourceOrder);
const mockedSetSourceHidden = vi.mocked(setSourceHidden);
const mockedSetGroupConfig = vi.mocked(setGroupConfig);
const mockedClearKey = vi.mocked(clearKey);
const mockedClearProviderMaxResults = vi.mocked(clearProviderMaxResults);
const mockedCreateSiteEngineDefinition = vi.mocked(createSiteEngineDefinition);
const mockedUpdateSiteEngineDefinition = vi.mocked(updateSiteEngineDefinition);
const mockedDeleteSiteEngineDefinition = vi.mocked(deleteSiteEngineDefinition);
const mockedCreateCustomEngineDefinition = vi.mocked(createCustomEngineDefinition);
const mockedUpdateCustomEngineDefinition = vi.mocked(updateCustomEngineDefinition);
const mockedDeleteCustomEngineDefinition = vi.mocked(deleteCustomEngineDefinition);
const mockedGetProviderInstances = vi.mocked(getProviderInstances);
const mockedCreateProviderInstance = vi.mocked(createProviderInstance);
const mockedUpdateProviderInstance = vi.mocked(updateProviderInstance);
const mockedDeleteProviderInstance = vi.mocked(deleteProviderInstance);
const mockedEnsureDefaultInstance = vi.mocked(ensureDefaultInstance);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedBuildExportPayload = vi.mocked(buildExportPayload);
const mockedParseImportPayload = vi.mocked(parseImportPayload);
const mockedMergeImport = vi.mocked(mergeImport);

function fakeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: 'tavily',
    label: 'provider_tavily', // i18n 消息名（不再是显示串）
    supportsAnswer: true,
    favicon: '/icons/tavily.svg',
    search: vi.fn().mockResolvedValue({ query: 'q', provider: 'tavily', results: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetCachedSearch.mockResolvedValue(null);
  mockedGetProviderInstances.mockResolvedValue([]);
  mockedSaveCachedSearch.mockImplementation(async (response) => ({
    id: 'cache-1',
    cacheKey: `${response.provider}:${response.query}`,
    query: response.query,
    normalizedQuery: response.query,
    providerId: response.provider,
    createdAt: 1000,
    lastAccessedAt: 1000,
    response,
  }));
  mockedGetSourceOrder.mockResolvedValue(['tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu']);
  mockedGetSourceHidden.mockResolvedValue([]);
});

describe('handleSearch', () => {
  it('routes to the active adapter and returns ok', async () => {
    const adapter = fakeAdapter();
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('tvly-k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'hello' });

    expect(mockedGetCachedSearch).toHaveBeenCalledWith('tavily', 'hello');
    expect(mockedGetAdapter).toHaveBeenCalledWith('tavily');
    expect(adapter.search).toHaveBeenCalledWith('hello', {}, 'tvly-k');
    expect(mockedSaveCachedSearch).toHaveBeenCalledWith({ query: 'q', provider: 'tavily', results: [] }, 'tavily');
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.response.provider).toBe('tavily');
      expect(reply.cache).toEqual({ hit: false, entryId: 'cache-1', createdAt: 1000 });
    }
  });

  it('returns a cached response without calling the adapter', async () => {
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetCachedSearch.mockResolvedValue({
      id: 'cache-hit',
      cacheKey: 'tavily:hello',
      query: 'hello',
      normalizedQuery: 'hello',
      providerId: 'tavily',
      createdAt: 123,
      lastAccessedAt: 456,
      response: { query: 'hello', provider: 'tavily', results: [{ title: 'Cached', url: 'https://cached.test', snippet: 'cached' }] },
    });

    const reply = await handleSearch({ query: 'hello' });

    expect(mockedGetAdapter).not.toHaveBeenCalled();
    expect(mockedGetKey).not.toHaveBeenCalled();
    expect(mockedSaveCachedSearch).not.toHaveBeenCalled();
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.cache).toEqual({ hit: true, entryId: 'cache-hit', createdAt: 123 });
      expect(reply.response.results[0].title).toBe('Cached');
    }
  });

  it('forceRefresh bypasses cache and refreshes provider result', async () => {
    const adapter = fakeAdapter();
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetCachedSearch.mockResolvedValue({
      id: 'cache-hit',
      cacheKey: 'tavily:hello',
      query: 'hello',
      normalizedQuery: 'hello',
      providerId: 'tavily',
      createdAt: 123,
      lastAccessedAt: 456,
      response: { query: 'hello', provider: 'tavily', results: [] },
    });
    mockedGetKey.mockResolvedValue('tvly-k');
    mockedGetAdapter.mockReturnValue(adapter);

    await handleSearch({ query: 'hello', forceRefresh: true });

    expect(mockedGetCachedSearch).not.toHaveBeenCalled();
    expect(adapter.search).toHaveBeenCalledWith('hello', {}, 'tvly-k');
    expect(mockedSaveCachedSearch).toHaveBeenCalled();
  });

  it('uses the requested provider snapshot when it is configured', async () => {
    const adapter = fakeAdapter({ id: 'exa', search: vi.fn().mockResolvedValue({ query: 'q', provider: 'exa', results: [] }) });
    mockedGetConfigured.mockResolvedValue(['exa']);
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('exa-k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'q', providerId: 'exa' });

    expect(mockedGetActive).not.toHaveBeenCalled();
    expect(mockedGetAdapter).toHaveBeenCalledWith('exa');
    expect(adapter.search).toHaveBeenCalledWith('q', {}, 'exa-k');
    expect(reply.ok).toBe(true);
  });

  it('injects stored maxResults into the adapter search call', async () => {
    const adapter = fakeAdapter();
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('tvly-k');
    mockedGetProviderMaxResults.mockResolvedValue(5);
    mockedGetAdapter.mockReturnValue(adapter);

    await handleSearch({ query: 'q' });

    expect(mockedGetProviderMaxResults).toHaveBeenCalledWith('tavily');
    expect(adapter.search).toHaveBeenCalledWith('q', { maxResults: 5 }, 'tvly-k');
  });

  it('omits maxResults when no per-provider value is stored', async () => {
    const adapter = fakeAdapter();
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('tvly-k');
    mockedGetProviderMaxResults.mockResolvedValue(null);
    mockedGetAdapter.mockReturnValue(adapter);

    await handleSearch({ query: 'q' });

    expect(adapter.search).toHaveBeenCalledWith('q', {}, 'tvly-k');
  });

  it('does not fall back when the requested provider is no longer configured', async () => {
    mockedGetConfigured.mockResolvedValue(['tavily']);
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'exa', label: 'provider_exa' }));

    const reply = await handleSearch({ query: 'q', providerId: 'exa' });

    expect(mockedGetActive).not.toHaveBeenCalled();
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('keyMissing');
  });

  it('does not cache failed provider responses', async () => {
    const adapter = fakeAdapter({
      search: vi.fn().mockRejectedValue(new ProviderError('unauthorized', 'bad key', 401)),
    });
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'q' });

    expect(reply.ok).toBe(false);
    expect(mockedSaveCachedSearch).not.toHaveBeenCalled();
  });

  it('does not cache a successful response when the signal aborts before persistence', async () => {
    const controller = new AbortController();
    const adapter = fakeAdapter({
      search: vi.fn().mockImplementation(async () => {
        controller.abort();
        return { query: 'q', provider: 'tavily', results: [] };
      }),
    });
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'q' }, controller.signal);

    expect(mockedSaveCachedSearch).not.toHaveBeenCalled();
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('unknown');
  });

  it('returns provider results even when cache persistence fails', async () => {
    const adapter = fakeAdapter({
      search: vi.fn().mockResolvedValue({ query: 'q', provider: 'tavily', results: [{ title: 'R', url: 'https://r.test', snippet: 'r' }] }),
    });
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(adapter);
    mockedSaveCachedSearch.mockRejectedValue(new Error('storage full'));

    const reply = await handleSearch({ query: 'q' });

    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.response.results[0].title).toBe('R');
      expect(reply.cache).toEqual({ hit: false, entryId: undefined, createdAt: undefined });
    }
  });

  it('returns keyMissing when no provider configured', async () => {
    mockedGetActive.mockResolvedValue(null);
    const reply = await handleSearch({ query: 'q' });
    expect(reply).toEqual({ ok: false, error: { kind: 'keyMissing', message: expect.any(String) } });
    expect(mockedGetKey).not.toHaveBeenCalled();
  });

  it('returns keyMissing when active provider has no key', async () => {
    mockedGetActive.mockResolvedValue('stepfun');
    mockedGetKey.mockResolvedValue(null);
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'stepfun', label: 'provider_stepfun' }));
    const reply = await handleSearch({ query: 'q' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('keyMissing');
  });

  it('maps a ProviderError to providerError', async () => {
    const adapter = fakeAdapter({
      search: vi.fn().mockRejectedValue(new ProviderError('unauthorized', 'bad key', 401)),
    });
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'q' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('providerError');
      expect(reply.error.providerErrorKind).toBe('unauthorized');
    }
  });

  it('maps a generic error to unknown', async () => {
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(fakeAdapter({ search: vi.fn().mockRejectedValue(new Error('boom')) }));
    const reply = await handleSearch({ query: 'q' });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('unknown');
      expect(reply.error.message).toBe('服务暂时不可用，请稍后重试'); // i18n 真实查表（默认 zh_CN）
    }
  });
});

describe('handleTestKey', () => {
  it('returns ok on a successful minimal query', async () => {
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(fakeAdapter());
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(true);
  });

  it('returns keyMissing when no key', async () => {
    mockedGetKey.mockResolvedValue(null);
    mockedGetAdapter.mockReturnValue(fakeAdapter());
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('keyMissing');
  });

  it('returns providerError on adapter failure', async () => {
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(
      fakeAdapter({ search: vi.fn().mockRejectedValue(new ProviderError('rateLimit', 'slow down', 429)) }),
    );
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('providerError');
  });

  it('coerces a generic error to providerError in testKey', async () => {
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(
      fakeAdapter({ search: vi.fn().mockRejectedValue(new Error('unexpected')) }),
    );
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('providerError');
  });
});

describe('handleGetProviderConfig', () => {
  it('returns configured provider ids and active provider without keys', async () => {
    mockedGetProviderConfigSnapshot.mockResolvedValue({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'exa', activeSourceId: 'google', sourceOrder: ['tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu'], sourceHidden: [], siteEngines: [], customEngines: [], providerInstances: [], providerMaxResults: {}, groupConfig: defaultGroupConfig([]) });

    await expect(handleGetProviderConfig()).resolves.toEqual({
      configuredProviderIds: ['tavily', 'exa'],
      activeProviderId: 'exa',
      activeSourceId: 'google',
      sourceOrder: ['tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu'],
      sourceHidden: [], siteEngines: [], customEngines: [], providerInstances: [],
      providerMaxResults: {},
      groupConfig: defaultGroupConfig([]),
    });
  });
});

describe('handleSetSourceHidden', () => {
  it('writes the hidden source list from the worker context', async () => {
    mockedSetSourceHidden.mockResolvedValue(undefined);
    await handleSetSourceHidden(['baidu']);
    expect(mockedSetSourceHidden).toHaveBeenCalledWith(['baidu']);
  });
});

describe('handleSetSourceOrder', () => {
  it('writes the source order from the worker context', async () => {
    const sourceOrder = ['bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'baidu'] as const;
    await handleSetSourceOrder([...sourceOrder]);
    expect(mockedSetSourceOrder).toHaveBeenCalledWith(sourceOrder);
  });
});

describe('handleSetGroupConfig', () => {
  it('writes the group config from the worker context', async () => {
    const cfg = defaultGroupConfig(['tavily', 'google']);
    await handleSetGroupConfig(cfg);
    expect(mockedSetGroupConfig).toHaveBeenCalledWith(cfg);
  });
});

describe('handleSaveProviderKey', () => {
  it('writes provider keys from the worker context', async () => {
    mockedSetKey.mockResolvedValue(undefined);

    await handleSaveProviderKey('tavily', 'tvly-abc');

    expect(mockedSetKey).toHaveBeenCalledWith('tavily', 'tvly-abc');
  });

  it('auto-creates a default instance when saving a key for an instance-supporting provider with no instances', async () => {
    mockedSetKey.mockResolvedValue(undefined);
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'exa', label: 'provider_exa' }));
    mockedEnsureDefaultInstance.mockResolvedValue(undefined);

    await handleSaveProviderKey('exa', 'exa-k');

    // 名字 = 适配器 label 经 t() 解析（provider_exa → Exa）；读-判-建委托给 ensureDefaultInstance（队列内原子）。
    expect(mockedEnsureDefaultInstance).toHaveBeenCalledWith('exa', 'Exa');
  });

  it('does not auto-create an instance for a provider without instance options (tavily)', async () => {
    mockedSetKey.mockResolvedValue(undefined);

    await handleSaveProviderKey('tavily', 'tvly-abc');

    expect(mockedEnsureDefaultInstance).not.toHaveBeenCalled();
  });

  it('does not auto-create a second instance when one already exists for the provider', async () => {
    mockedSetKey.mockResolvedValue(undefined);
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'exa', label: 'provider_exa' }));
    mockedEnsureDefaultInstance.mockResolvedValue(undefined);

    await handleSaveProviderKey('exa', 'exa-k');

    // 「已有实例则 no-op」在 storage 的 ensureDefaultInstance 内判定（并发下仍在队列内原子化）；
    // gateway 层仅委托。
    expect(mockedEnsureDefaultInstance).toHaveBeenCalledWith('exa', 'Exa');
  });

  it('keeps the key save as the primary operation when the best-effort auto-create fails', async () => {
    mockedSetKey.mockResolvedValue(undefined);
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'exa', label: 'provider_exa' }));
    mockedEnsureDefaultInstance.mockRejectedValue(new Error('storage boom'));

    await expect(handleSaveProviderKey('exa', 'exa-k')).resolves.toBeUndefined();
    expect(mockedSetKey).toHaveBeenCalledWith('exa', 'exa-k');
    expect(mockedEnsureDefaultInstance).toHaveBeenCalledWith('exa', 'Exa');
  });
});

describe('handleSetProviderMaxResults', () => {
  it('writes the clamped maxResults and clears the search cache', async () => {
    mockedSetProviderMaxResults.mockResolvedValue(undefined);
    mockedClearSearchCache.mockResolvedValue(undefined);

    await handleSetProviderMaxResults('tavily', 5);

    expect(mockedSetProviderMaxResults).toHaveBeenCalledWith('tavily', 5);
    expect(mockedClearSearchCache).toHaveBeenCalled();
  });
});

describe('handleClearProviderMaxResults', () => {
  it('clears the stored maxResults and the search cache', async () => {
    mockedClearProviderMaxResults.mockResolvedValue(undefined);
    mockedClearSearchCache.mockResolvedValue(undefined);

    await handleClearProviderMaxResults('tavily');

    expect(mockedClearProviderMaxResults).toHaveBeenCalledWith('tavily');
    expect(mockedClearSearchCache).toHaveBeenCalled();
  });
});

describe('handleDeleteProviderKey', () => {
  it('clears the provider key from the worker context', async () => {
    mockedClearKey.mockResolvedValue(undefined);

    await handleDeleteProviderKey('tavily');

    expect(mockedClearKey).toHaveBeenCalledWith('tavily');
  });
});

describe('handleSetActiveProvider', () => {
  it('writes both active provider and active source from the worker context', async () => {
    mockedSetActiveAndSource.mockResolvedValue(undefined);

    await handleSetActiveProvider('exa');

    expect(mockedSetActiveAndSource).toHaveBeenCalledWith('exa');
  });
});

describe('handleSetActiveSource', () => {
  it('delegates engine selection to the atomic storage operation', async () => {
    mockedSelectActiveSource.mockResolvedValue(undefined);

    await handleSetActiveSource('baidu');

    expect(mockedSelectActiveSource).toHaveBeenCalledWith('baidu');
    expect(mockedSetActive).not.toHaveBeenCalled();
  });

  it('delegates provider selection to the atomic storage operation', async () => {
    mockedSelectActiveSource.mockResolvedValue(undefined);

    await handleSetActiveSource('exa');

    expect(mockedSelectActiveSource).toHaveBeenCalledWith('exa');
  });

  it('rejects a forged Site Engine id', async () => {
    mockedSelectActiveSource.mockRejectedValue(new Error('invalid_source'));
    await expect(handleSetActiveSource('site:forged')).rejects.toThrow('invalid_source');
  });
});

describe('Site Engine gateway handlers', () => {
  const created = { id: 'site:worker-id' as const, name: 'Docs', target: 'https://docs.example.com/', engineId: 'google' as const };

  it('creates a worker-generated id and delegates canonicalization to storage', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'worker-id' });
    mockedCreateSiteEngineDefinition.mockResolvedValue(created);
    await expect(handleCreateSiteEngine({ name: ' Docs ', target: 'docs.example.com', engineId: 'google' })).resolves.toEqual(created);
    expect(mockedCreateSiteEngineDefinition).toHaveBeenCalledWith({ ...created, name: ' Docs ', target: 'docs.example.com' });
  });

  it('updates using the existing id and deletes only valid Site Engine ids', async () => {
    mockedUpdateSiteEngineDefinition.mockResolvedValue(created);
    await handleUpdateSiteEngine({ ...created, name: 'Changed' });
    expect(mockedUpdateSiteEngineDefinition).toHaveBeenCalledWith(created.id, { ...created, name: 'Changed' });
    await expect(handleDeleteSiteEngine('not-a-site' as never)).rejects.toThrow('invalid_site_engine');
    await handleDeleteSiteEngine(created.id);
    expect(mockedDeleteSiteEngineDefinition).toHaveBeenCalledWith(created.id);
  });
});

describe('Custom Engine gateway handlers', () => {
  const created = { id: 'custom:worker-id' as const, name: 'My Engine', urlTemplate: 'https://example.com/search?q=%s' };

  it('creates with a worker-generated id and delegates to storage', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'worker-id' });
    mockedCreateCustomEngineDefinition.mockResolvedValue(created);
    await expect(handleCreateCustomEngine({ name: ' My Engine ', urlTemplate: 'https://example.com/search?q=%s' })).resolves.toEqual(created);
    expect(mockedCreateCustomEngineDefinition).toHaveBeenCalledWith({ ...created, name: ' My Engine ' });
  });

  it('rejects when storage rejects an invalid urlTemplate', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'worker-id' });
    mockedCreateCustomEngineDefinition.mockRejectedValue(new Error('invalid_custom_engine'));
    await expect(handleCreateCustomEngine({ name: 'Bad', urlTemplate: 'https://example.com/no-placeholder' })).rejects.toThrow('invalid_custom_engine');
  });

  it('rejects when storage rejects a duplicate urlTemplate', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'dup-id' });
    mockedCreateCustomEngineDefinition.mockRejectedValue(new Error('invalid_custom_engine'));
    await expect(handleCreateCustomEngine({ name: 'Dup', urlTemplate: 'https://example.com/search?q=%s' })).rejects.toThrow('invalid_custom_engine');
  });

  it('rejects when storage rejects over capacity', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'cap-id' });
    mockedCreateCustomEngineDefinition.mockRejectedValue(new Error('invalid_custom_engine'));
    await expect(handleCreateCustomEngine({ name: 'Over', urlTemplate: 'https://over.com/%s' })).rejects.toThrow('invalid_custom_engine');
  });

  it('updates name and urlTemplate using the existing id', async () => {
    const updated = { ...created, name: 'Changed', urlTemplate: 'https://changed.com/%s' };
    mockedUpdateCustomEngineDefinition.mockResolvedValue(updated);
    await handleUpdateCustomEngine(updated);
    expect(mockedUpdateCustomEngineDefinition).toHaveBeenCalledWith(created.id, updated);
  });

  it('rejects update for an unknown id', async () => {
    mockedUpdateCustomEngineDefinition.mockRejectedValue(new Error('invalid_custom_engine'));
    await expect(handleUpdateCustomEngine({ id: 'custom:unknown' as never, name: 'X', urlTemplate: 'https://x.com/%s' })).rejects.toThrow('invalid_custom_engine');
  });

  it('deletes an existing custom engine', async () => {
    mockedDeleteCustomEngineDefinition.mockResolvedValue(undefined);
    await handleDeleteCustomEngine(created.id);
    expect(mockedDeleteCustomEngineDefinition).toHaveBeenCalledWith(created.id);
  });

  it('rejects delete for an invalid id format', async () => {
    await expect(handleDeleteCustomEngine('not-custom' as never)).rejects.toThrow('invalid_custom_engine');
    expect(mockedDeleteCustomEngineDefinition).not.toHaveBeenCalled();
  });
});

describe('resolveInstance', () => {
  const instance = { id: 'inst:exa:abc' as const, baseProviderId: 'exa' as const, name: 'AI Research', options: { category: 'news' } };

  it('resolves an instance id to base provider + options', async () => {
    mockedGetProviderInstances.mockResolvedValue([instance]);

    await expect(resolveInstance('inst:exa:abc')).resolves.toEqual({
      providerId: 'exa',
      providerSettings: { category: 'news' },
      cacheKeyId: 'inst:exa:abc',
    });
  });

  it('returns bare provider id without options for a bare ProviderId', async () => {
    await expect(resolveInstance('tavily')).resolves.toEqual({ providerId: 'tavily', cacheKeyId: 'tavily' });
  });

  it('returns null for undefined and unknown source ids', async () => {
    mockedGetProviderInstances.mockResolvedValue([instance]);

    await expect(resolveInstance(undefined)).resolves.toBeNull();
    await expect(resolveInstance('inst:exa:nope')).resolves.toBeNull();
    await expect(resolveInstance('not-a-source' as never)).resolves.toBeNull();
  });
});

describe('handleSearch instance resolution', () => {
  const instance = { id: 'inst:exa:abc' as const, baseProviderId: 'exa' as const, name: 'AI Research', options: { category: 'news' } };

  it('injects per-instance options via providerSettings when the request carries an instance id', async () => {
    const adapter = fakeAdapter({ id: 'exa', search: vi.fn().mockResolvedValue({ query: 'q', provider: 'exa', results: [] }) });
    mockedGetProviderInstances.mockResolvedValue([instance]);
    mockedGetKey.mockResolvedValue('exa-k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'q', providerId: 'inst:exa:abc' as never });

    expect(mockedGetCachedSearch).toHaveBeenCalledWith('inst:exa:abc', 'q');
    expect(mockedGetAdapter).toHaveBeenCalledWith('exa');
    expect(adapter.search).toHaveBeenCalledWith('q', { providerSettings: { category: 'news' } }, 'exa-k');
    expect(reply.ok).toBe(true);
  });

  it('routes a bare provider id with instances to the first instance options (default instance)', async () => {
    const adapter = fakeAdapter({ id: 'exa', search: vi.fn().mockResolvedValue({ query: 'q', provider: 'exa', results: [] }) });
    mockedGetConfigured.mockResolvedValue(['exa']);
    mockedGetProviderInstances.mockResolvedValue([
      { id: 'inst:exa:first', baseProviderId: 'exa', name: 'First', options: { category: 'publication' } },
      { id: 'inst:exa:second', baseProviderId: 'exa', name: 'Second', options: { category: 'news' } },
    ]);
    mockedGetKey.mockResolvedValue('exa-k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch({ query: 'q', providerId: 'exa' });

    expect(adapter.search).toHaveBeenCalledWith('q', { providerSettings: { category: 'publication' } }, 'exa-k');
    expect(reply.ok).toBe(true);
  });

  it('does not inject providerSettings for a bare provider without instances', async () => {
    const adapter = fakeAdapter();
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetProviderInstances.mockResolvedValue([]);
    mockedGetKey.mockResolvedValue('tvly-k');
    mockedGetAdapter.mockReturnValue(adapter);

    await handleSearch({ query: 'q' });

    expect(adapter.search).toHaveBeenCalledWith('q', {}, 'tvly-k');
  });
});

describe('handleSearchInstance (agent v2)', () => {
  const instance = { id: 'inst:exa:abc' as const, baseProviderId: 'exa' as const, name: 'AI Research', options: { category: 'news' } };

  it('resolves the instance and searches with its options', async () => {
    const adapter = fakeAdapter({ id: 'exa', search: vi.fn().mockResolvedValue({ query: 'q', provider: 'exa', results: [] }) });
    mockedGetProviderInstances.mockResolvedValue([instance]);
    mockedGetKey.mockResolvedValue('exa-k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearchInstance({ action: 'search-instance', query: 'q', instanceId: 'inst:exa:abc' });

    expect(adapter.search).toHaveBeenCalledWith('q', { providerSettings: { category: 'news' } }, 'exa-k');
    expect(mockedSaveCachedSearch).toHaveBeenCalled();
    expect(reply.ok).toBe(true);
  });

  it('returns keyMissing for an unknown instance id', async () => {
    mockedGetProviderInstances.mockResolvedValue([]);

    const reply = await handleSearchInstance({ action: 'search-instance', query: 'q', instanceId: 'inst:exa:nope' });

    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('keyMissing');
    expect(mockedGetAdapter).not.toHaveBeenCalled();
  });
});

describe('handleListAgentProviders (agent v1)', () => {
  it('marks hasInstances on providers that own at least one instance', async () => {
    mockedGetProviderInstances.mockResolvedValue([
      { id: 'inst:exa:abc', baseProviderId: 'exa', name: 'AI Research', options: { category: 'news' } },
      { id: 'inst:exa:def', baseProviderId: 'exa', name: '创业资讯', options: { category: 'publication' } },
    ]);
    mockedGetConfigured.mockResolvedValue(['exa', 'tavily']);

    const reply = await handleListAgentProviders();
    const exa = reply.providers.find((p) => p.id === 'exa');
    const tavily = reply.providers.find((p) => p.id === 'tavily');
    expect(exa?.hasInstances).toBe(true);
    expect(exa?.configured).toBe(true);
    expect(tavily?.hasInstances).toBeUndefined();
    expect(tavily?.configured).toBe(true);
  });

  it('omits hasInstances entirely when no provider has instances', async () => {
    mockedGetProviderInstances.mockResolvedValue([]);
    mockedGetConfigured.mockResolvedValue(['exa']);

    const reply = await handleListAgentProviders();
    for (const provider of reply.providers) {
      expect(provider.hasInstances).toBeUndefined();
    }
    expect(reply.providers.length).toBeGreaterThan(0);
  });
});

describe('handleListAgentInstances (agent v2)', () => {
  it('maps instances to AgentInstance shape with configured flag', async () => {
    mockedGetProviderInstances.mockResolvedValue([
      { id: 'inst:exa:abc', baseProviderId: 'exa', name: 'AI Research', options: { category: 'publication' } },
      { id: 'inst:exa:def', baseProviderId: 'exa', name: '创业资讯', options: { category: 'news' } },
    ]);
    mockedGetConfigured.mockResolvedValue(['exa']);

    await expect(handleListAgentInstances()).resolves.toEqual({
      instances: [
        { id: 'inst:exa:abc', providerId: 'exa', label: 'AI Research', description: '', configured: true },
        { id: 'inst:exa:def', providerId: 'exa', label: '创业资讯', description: '', configured: true },
      ],
    });
  });

  it('marks configured false when the base provider has no key', async () => {
    mockedGetProviderInstances.mockResolvedValue([
      { id: 'inst:exa:abc', baseProviderId: 'exa', name: 'AI Research', options: {} },
    ]);
    mockedGetConfigured.mockResolvedValue(['tavily']);

    await expect(handleListAgentInstances()).resolves.toEqual({
      instances: [{ id: 'inst:exa:abc', providerId: 'exa', label: 'AI Research', description: '', configured: false }],
    });
  });
});

describe('Provider Instance gateway handlers', () => {
  const created = { id: 'inst:exa:worker-id' as const, baseProviderId: 'exa' as const, name: 'AI Research', options: { category: 'publication' } };

  it('creates an instance delegating to storage', async () => {
    mockedCreateProviderInstance.mockResolvedValue(created);

    await expect(handleCreateProviderInstance({ baseProviderId: 'exa', name: 'AI Research', options: { category: 'publication' } })).resolves.toEqual(created);
    expect(mockedCreateProviderInstance).toHaveBeenCalledWith('exa', 'AI Research', { category: 'publication' });
  });

  it('updates an instance delegating to storage', async () => {
    const updated = { ...created, name: 'Renamed' };
    mockedUpdateProviderInstance.mockResolvedValue(updated);

    await expect(handleUpdateProviderInstance({ id: created.id, patch: { name: 'Renamed' } })).resolves.toEqual(updated);
    expect(mockedUpdateProviderInstance).toHaveBeenCalledWith(created.id, { name: 'Renamed' });
  });

  it('deletes an instance and clears the search cache', async () => {
    mockedDeleteProviderInstance.mockResolvedValue(undefined);
    mockedClearSearchCache.mockResolvedValue(undefined);

    await handleDeleteProviderInstance(created.id);

    expect(mockedDeleteProviderInstance).toHaveBeenCalledWith(created.id);
    expect(mockedClearSearchCache).toHaveBeenCalled();
  });

  it('rejects delete for an invalid id format', async () => {
    await expect(handleDeleteProviderInstance('not-inst' as never)).rejects.toThrow('invalid_provider_instance');
    expect(mockedDeleteProviderInstance).not.toHaveBeenCalled();
  });
});

describe('search cache handlers', () => {
  it('returns cache summaries', async () => {
    mockedGetSearchCacheSummaries.mockResolvedValue([
      { id: 'c1', cacheKey: 'tavily:q', query: 'q', normalizedQuery: 'q', providerId: 'tavily', createdAt: 1, lastAccessedAt: 1, resultPreviews: [], resultCount: 0 },
    ]);
    await expect(handleGetSearchCacheSummaries()).resolves.toHaveLength(1);
  });

  it('returns a cached entry by id', async () => {
    mockedGetCachedSearchEntry.mockResolvedValue({
      id: 'c1',
      cacheKey: 'tavily:q',
      query: 'q',
      normalizedQuery: 'q',
      providerId: 'tavily',
      createdAt: 1,
      lastAccessedAt: 1,
      response: { query: 'q', provider: 'tavily', results: [] },
    });
    await expect(handleGetCachedSearchEntry('c1')).resolves.toEqual(expect.objectContaining({ id: 'c1' }));
  });

  it('deletes a cached search by id', async () => {
    await handleDeleteCachedSearch('c1');
    expect(mockedDeleteCachedSearch).toHaveBeenCalledWith('c1');
  });

  it('clears the search cache', async () => {
    await handleClearSearchCache();
    expect(mockedClearSearchCache).toHaveBeenCalled();
  });
});

describe('handleExportConfig', () => {
  it('builds payload, turns into data url, and triggers download with a dated filename', async () => {
    mockedBuildExportPayload.mockResolvedValue({
      schemaVersion: 1,
      exportedAt: new Date('2026-07-08T10:00:00Z').getTime(),
      appVersion: '1.0.0',
      providerKeys: { tavily: 'tvly-secret' },
      activeProvider: 'tavily',
      activeSource: 'tavily',
      themePref: 'dark',
      localePref: 'en',
      siteEngines: [],
    });
    const onDownload = vi.fn().mockResolvedValue(undefined);

    const reply = await handleExportConfig(onDownload);

    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.filename).toMatch(/^juso-config-\d{8}-\d{4}\.json$/);
    }
    // onDownload 收到 data url（含明文 key）+ 文件名
    expect(onDownload).toHaveBeenCalledTimes(1);
    const [url, filename] = onDownload.mock.calls[0];
    expect(url.startsWith('data:application/json;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1])).toContain('tvly-secret');
    expect(filename).toMatch(/^juso-config-\d{8}-\d{4}\.json$/);
  });

  it('returns download_failed when download throws', async () => {
    mockedBuildExportPayload.mockResolvedValue({
      schemaVersion: 1, exportedAt: 0, appVersion: '1.0.0',
      providerKeys: {}, activeProvider: null, activeSource: 'google', themePref: 'auto', localePref: 'auto',
      siteEngines: [],
    });
    const onDownload = vi.fn().mockRejectedValue(new Error('blocked'));
    const reply = await handleExportConfig(onDownload);
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('download_failed');
  });
});

describe('handleImportConfig', () => {
  it('parses then merges and returns the report', async () => {
    const payload: ConfigExport = { schemaVersion: 1, exportedAt: 0, appVersion: 'x', providerKeys: {}, activeProvider: null, activeSource: 'google', themePref: 'auto', localePref: 'auto', siteEngines: [] };
    mockedParseImportPayload.mockReturnValue({ ok: true, value: payload });
    mockedMergeImport.mockResolvedValue({
      written: ['exa'], skipped: ['tavily'],
      activeProviderOverridden: true, activeSourceOverridden: true, themePrefOverridden: true, localePrefOverridden: true,
      serpBarPositionOverridden: false,
      sourceOrderOverridden: true, sourceHiddenOverridden: false, siteEnginesOverridden: false, customEnginesOverridden: false, providerInstancesOverridden: false, providerMaxResultsOverridden: false,
      groupConfigOverridden: false,
    } as ImportReport);
    const reply = await handleImportConfig({ payload, applyPrefs: true });
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.report.written).toEqual(['exa']);
      expect(reply.report.skipped).toEqual(['tavily']);
    }
    expect(mockedMergeImport).toHaveBeenCalledWith(payload, { applyPrefs: true });
  });

  it('passes applyPrefs=false through to mergeImport', async () => {
    const payload: ConfigExport = { schemaVersion: 1, exportedAt: 0, appVersion: 'x', providerKeys: {}, activeProvider: null, activeSource: 'google', themePref: 'auto', localePref: 'auto', siteEngines: [] };
    mockedParseImportPayload.mockReturnValue({ ok: true, value: payload });
    mockedMergeImport.mockResolvedValue({
      written: [], skipped: [],
      activeProviderOverridden: false, activeSourceOverridden: false, themePrefOverridden: false, localePrefOverridden: false,
      serpBarPositionOverridden: false,
      sourceOrderOverridden: false, sourceHiddenOverridden: false, siteEnginesOverridden: false, customEnginesOverridden: false, providerInstancesOverridden: false, providerMaxResultsOverridden: false,
      groupConfigOverridden: false,
    } as ImportReport);
    await handleImportConfig({ payload, applyPrefs: false });
    expect(mockedMergeImport).toHaveBeenCalledWith(payload, { applyPrefs: false });
  });

  it('returns invalid when parse fails', async () => {
    const payload = { schemaVersion: 999 } as never;
    mockedParseImportPayload.mockReturnValue({ ok: false, error: 'schema_version_mismatch' });
    const reply = await handleImportConfig({ payload, applyPrefs: true });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('invalid');
    expect(mockedMergeImport).not.toHaveBeenCalled();
  });
});
