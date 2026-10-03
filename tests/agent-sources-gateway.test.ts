import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { AggregateInstance } from '@/lib/aggregate-instances';
import { handleListAgentSites, handleSearchSiteInstance, handleListAgentAggregates, handleSearchAggregate } from '@/lib/gateway';
import { runEngineSearch } from '@/lib/engine-search';
import { t, MSG } from '@/lib/i18n';

// Agent bridge v2 站点实例 / 聚合实例 handler 的行为锁定：
// - 清单脱敏形状（id/label/engineId/target，无密钥；聚合含 eligible/topN/members）
// - search-site 的 serpUrl/matchQuery 计算（经真实 buildSiteInstanceUrl + matchEngineByUrl 单一来源）
// - search-aggregate 的引擎成员条件门控（含引擎成员才要求 engine-search 子开关）

vi.mock('@/lib/storage', () => ({
  clearKey: vi.fn(),
  clearProviderMaxResults: vi.fn().mockResolvedValue(undefined),
  clearSearchCache: vi.fn(),
  createAggregateInstance: vi.fn(),
  deleteAggregateCacheEntries: vi.fn().mockResolvedValue(undefined),
  deleteAggregateInstance: vi.fn().mockResolvedValue(undefined),
  deleteCachedSearch: vi.fn(),
  getActiveProviderId: vi.fn(),
  getAggregateInstances: vi.fn().mockResolvedValue([]),
  getCachedSearch: vi.fn().mockResolvedValue(null),
  getCachedSearchEntry: vi.fn(),
  getConfiguredProviderIds: vi.fn().mockResolvedValue([]),
  getKey: vi.fn(),
  getProviderMaxResults: vi.fn().mockResolvedValue(null),
  getProviderInstances: vi.fn().mockResolvedValue([]),
  getRerankConfig: vi.fn().mockResolvedValue(null),
  getSearchCacheSummaries: vi.fn(),
  getProviderConfigSnapshot: vi.fn(),
  getSiteInstanceDefinitions: vi.fn().mockResolvedValue([]),
  getEngineSearchEnabled: vi.fn().mockResolvedValue(false),
  getSourceHidden: vi.fn(),
  saveCachedAggregateSearch: vi.fn().mockResolvedValue(null),
  saveCachedSearch: vi.fn(),
  selectActiveSourceId: vi.fn(),
  setKey: vi.fn(),
  setProviderMaxResults: vi.fn().mockResolvedValue(undefined),
  setRerankConfig: vi.fn().mockResolvedValue(undefined),
  setSourceHidden: vi.fn(),
  setSourceOrder: vi.fn(),
  setGroupConfig: vi.fn().mockResolvedValue(undefined),
  setAiAutoEnter: vi.fn().mockResolvedValue(undefined),
  setFlatLayoutFewSources: vi.fn().mockResolvedValue(undefined),
  setSelectionSearchEnabled: vi.fn(),
  setSelectionSearchSource: vi.fn(),
  updateAggregateInstance: vi.fn(),
  createSiteInstanceDefinition: vi.fn(),
  updateSiteInstanceDefinition: vi.fn(),
  deleteSiteInstanceDefinition: vi.fn(),
  createCustomEngineDefinition: vi.fn(),
  updateCustomEngineDefinition: vi.fn(),
  deleteCustomEngineDefinition: vi.fn(),
  createProviderInstance: vi.fn(),
  updateProviderInstance: vi.fn(),
  deleteProviderInstance: vi.fn(),
  ensureDefaultInstance: vi.fn(),
}));

vi.mock('@/lib/schema', () => ({ ensureSchema: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/search-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/search-cache')>()),
  ensureCacheSchema: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/config-io', () => ({
  buildExportPayload: vi.fn(),
  parseImportPayload: vi.fn(),
  previewImport: vi.fn(),
  mergeImport: vi.fn(),
}));
vi.mock('@/lib/agent-skill-packager', () => ({ packageAgentSkill: vi.fn() }));
vi.mock('@/lib/skill-variant', () => ({ SKILL_VARIANT: 'prod' }));

vi.mock('@/lib/engine-search', () => ({ runEngineSearch: vi.fn() }));

import { getSiteInstanceDefinitions, getEngineSearchEnabled, getAggregateInstances, getConfiguredProviderIds, getRerankConfig } from '@/lib/storage';

const mockedRunEngineSearch = vi.mocked(runEngineSearch);
// vi.mock 工厂的 mock 需经 vi.mocked 取得 Mock 类型（直用真实签名无 mockResolvedValue）。
const mockedGetSiteInstanceDefinitions = vi.mocked(getSiteInstanceDefinitions);
const mockedGetEngineSearchEnabled = vi.mocked(getEngineSearchEnabled);
const mockedGetAggregateInstances = vi.mocked(getAggregateInstances);
const mockedGetConfiguredProviderIds = vi.mocked(getConfiguredProviderIds);
const mockedGetRerankConfig = vi.mocked(getRerankConfig);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('browser', { tabs: { create: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(), sendMessage: vi.fn(), onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } } });
  mockedGetSiteInstanceDefinitions.mockResolvedValue([]);
  mockedGetAggregateInstances.mockResolvedValue([]);
  mockedGetConfiguredProviderIds.mockResolvedValue([]);
  // getRerankConfig 恒返回 RerankConfig（存储读侧兜底）；endpoint 空串 = 未配置。
  mockedGetRerankConfig.mockResolvedValue({ endpoint: '' });
  mockedGetEngineSearchEnabled.mockResolvedValue(false);
});

describe('handleListAgentSites', () => {
  it('maps definitions to the sanitized site shape (id/label/engineId/target, empty description)', async () => {
    mockedGetSiteInstanceDefinitions.mockResolvedValue([
      { id: 'site:abc', name: 'Example 站内', engineId: 'bing', target: 'example.com' },
      { id: 'site:def', name: 'Baidu 站内', engineId: 'baidu', target: 'example.org', options: { mode: 'zhannei' } },
    ]);
    await expect(handleListAgentSites()).resolves.toEqual({
      sites: [
        { id: 'site:abc', label: 'Example 站内', engineId: 'bing', target: 'example.com', description: '' },
        { id: 'site:def', label: 'Baidu 站内', engineId: 'baidu', target: 'example.org', description: '' },
      ],
    });
  });
});

describe('handleSearchSiteInstance', () => {
  it('returns ok:false unknown for a missing definition without touching the browser', async () => {
    await expect(handleSearchSiteInstance({ action: 'search-site', query: 'x', siteId: 'site:missing' })).resolves.toEqual({
      ok: false,
      error: { kind: 'unknown', message: t(MSG.error_site_instance_unknown) },
    });
    expect(mockedRunEngineSearch).not.toHaveBeenCalled();
  });

  it('builds the q1 URL, derives matchQuery from the constructed URL, and wraps extraction results', async () => {
    mockedGetSiteInstanceDefinitions.mockResolvedValue([{ id: 'site:abc', name: 'Example', engineId: 'bing', target: 'example.com', options: { mode: 'q1' } }]);
    mockedRunEngineSearch.mockResolvedValue({ engine: 'bing', query: 'hello', results: [{ title: 'T', url: 'https://example.com/1', snippet: 'S' }] });
    await expect(handleSearchSiteInstance({ action: 'search-site', query: 'hello', siteId: 'site:abc' }, undefined, 25_000)).resolves.toEqual({
      ok: true,
      response: { query: 'hello', engine: 'bing', results: [{ title: 'T', url: 'https://example.com/1', snippet: 'S' }] },
      cache: { hit: false },
    });
    const [request, , deps] = mockedRunEngineSearch.mock.calls[0];
    expect(request.engineId).toBe('bing');
    expect(request.query).toBe('hello');
    expect(request.serpUrl).toBe('https://www.bing.com/search?q=hello&q1=site%3Aexample.com');
    expect(request.matchQuery).toBe('hello');
    expect((deps as { completeTimeoutMs?: number }).completeTimeoutMs).toBe(25_000);
  });

  it('derives the prefixed matchQuery for query-mode constructions (site: prefix embedded in wd)', async () => {
    mockedGetSiteInstanceDefinitions.mockResolvedValue([{ id: 'site:abc', name: 'Baidu query', engineId: 'baidu', target: 'example.com', options: { mode: 'query' } }]);
    mockedRunEngineSearch.mockResolvedValue({ engine: 'baidu', query: 'hello', results: [] });
    await handleSearchSiteInstance({ action: 'search-site', query: 'hello', siteId: 'site:abc' });
    const [request] = mockedRunEngineSearch.mock.calls[0];
    expect(request.serpUrl).toBe('https://www.baidu.com/s?wd=site%3Aexample.com%20hello');
    expect(request.matchQuery).toBe('site:example.com hello');
  });

  it('derives the bare matchQuery for zhannei constructions (base query in q)', async () => {
    mockedGetSiteInstanceDefinitions.mockResolvedValue([{ id: 'site:abc', name: 'Baidu zhannei', engineId: 'baidu', target: 'example.com', options: { mode: 'zhannei' } }]);
    mockedRunEngineSearch.mockResolvedValue({ engine: 'baidu', query: 'hello', results: [] });
    await handleSearchSiteInstance({ action: 'search-site', query: 'hello', siteId: 'site:abc' });
    const [request] = mockedRunEngineSearch.mock.calls[0];
    expect(request.serpUrl).toBe('https://zhannei.baidu.com/cse/site?q=hello&cc=example.com');
    expect(request.matchQuery).toBe('hello');
  });

  it('maps extraction errors to a providerError envelope and passes maxResults through', async () => {
    mockedGetSiteInstanceDefinitions.mockResolvedValue([{ id: 'site:abc', name: 'Example', engineId: 'google', target: 'example.com' }]);
    mockedRunEngineSearch.mockResolvedValue({ engine: 'google', query: 'hello', error: 'challenge' });
    await expect(handleSearchSiteInstance({ action: 'search-site', query: 'hello', siteId: 'site:abc', maxResults: 7 })).resolves.toEqual({
      ok: false,
      error: { kind: 'providerError', message: 'challenge' },
    });
    expect(mockedRunEngineSearch.mock.calls[0][0]).toMatchObject({ maxResults: 7 });
  });
});

describe('handleListAgentAggregates', () => {
  const instance: AggregateInstance = { id: 'agg:abc', name: '研究聚合', members: ['tavily', 'google'], topN: 15 };

  it('reports eligible with members and topN when rerank is configured and a member is valid', async () => {
    mockedGetAggregateInstances.mockResolvedValue([instance]);
    mockedGetConfiguredProviderIds.mockResolvedValue(['tavily']);
    mockedGetRerankConfig.mockResolvedValue({ endpoint: 'http://127.0.0.1:8000/rerank' });
    await expect(handleListAgentAggregates()).resolves.toEqual({
      aggregates: [{ id: 'agg:abc', label: '研究聚合', eligible: true, topN: 15, members: ['tavily', 'google'] }],
    });
  });

  it('reports eligible:false when rerank is unconfigured', async () => {
    mockedGetAggregateInstances.mockResolvedValue([instance]);
    await expect(handleListAgentAggregates()).resolves.toEqual({
      aggregates: [{ id: 'agg:abc', label: '研究聚合', eligible: false, topN: 15, members: ['tavily', 'google'] }],
    });
  });
});

describe('handleSearchAggregate gating (engine members require the engine-search sub-switch)', () => {
  const engineMemberInstance: AggregateInstance = { id: 'agg:eng', name: 'with engine', members: ['google'], topN: 20 };
  const providerInstance: AggregateInstance = { id: 'agg:prov', name: 'providers only', members: ['tavily'], topN: 20 };

  it('blocks an engine-member aggregate with the dedicated message when the sub-switch is off', async () => {
    mockedGetAggregateInstances.mockResolvedValue([engineMemberInstance]);
    mockedGetEngineSearchEnabled.mockResolvedValue(false);
    await expect(handleSearchAggregate({ action: 'search-aggregate', query: 'x', aggregateId: 'agg:eng' })).resolves.toEqual({
      ok: false,
      error: { kind: 'unknown', message: t(MSG.error_agent_engine_search_disabled) },
    });
  });

  it('lets a provider-only aggregate run with the sub-switch off (reaches the rerank keyMissing error)', async () => {
    mockedGetAggregateInstances.mockResolvedValue([providerInstance]);
    mockedGetEngineSearchEnabled.mockResolvedValue(false);
    const reply = await handleSearchAggregate({ action: 'search-aggregate', query: 'x', aggregateId: 'agg:prov' });
    expect(reply).toMatchObject({ ok: false, error: { kind: 'keyMissing' } });
    expect((reply as { error: { message: string } }).error.message).not.toBe(t(MSG.error_agent_engine_search_disabled));
  });

  it('lets an engine-member aggregate run with the sub-switch on', async () => {
    mockedGetAggregateInstances.mockResolvedValue([engineMemberInstance]);
    mockedGetEngineSearchEnabled.mockResolvedValue(true);
    await expect(handleSearchAggregate({ action: 'search-aggregate', query: 'x', aggregateId: 'agg:eng' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'keyMissing' },
    });
  });

  it('skips the gate for an unknown instance and surfaces the aggregate-flow unknown error', async () => {
    mockedGetEngineSearchEnabled.mockResolvedValue(false);
    await expect(handleSearchAggregate({ action: 'search-aggregate', query: 'x', aggregateId: 'agg:missing' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unknown', message: t(MSG.error_aggregate_instance_unknown) },
    });
  });
});
