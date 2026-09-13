import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProviderAdapter, ProviderId } from '@/lib/providers/types';
import { ProviderError } from '@/lib/providers/types';
import type { AggregateInstanceId, AggregateSearchResponse } from '@/lib/aggregate/types';
import type { AggregateInstance } from '@/lib/aggregate-instances';
import { RerankError } from '@/lib/aggregate/rerank-client';
import type { NormalizedSearchResponse, NormalizedResult } from '@/lib/providers/types';
import type { SearchCacheEntry } from '@/lib/search-cache';

vi.mock('@/lib/storage', () => ({
  clearKey: vi.fn(),
  clearProviderMaxResults: vi.fn().mockResolvedValue(undefined),
  clearSearchCache: vi.fn(),
  createAggregateInstance: vi.fn(),
  deleteAggregateCacheEntries: vi.fn().mockResolvedValue(undefined),
  deleteAggregateInstance: vi.fn().mockResolvedValue(undefined),
  deleteCachedSearch: vi.fn(),
  getActiveProviderId: vi.fn(),
  getAggregateInstances: vi.fn(),
  getCachedSearch: vi.fn(),
  getCachedSearchEntry: vi.fn(),
  getConfiguredProviderIds: vi.fn(),
  getKey: vi.fn(),
  getProviderMaxResults: vi.fn().mockResolvedValue(null),
  getProviderInstances: vi.fn(),
  getRerankConfig: vi.fn(),
  getSearchCacheSummaries: vi.fn(),
  getSourceHidden: vi.fn(),
  saveCachedAggregateSearch: vi.fn(),
  saveCachedSearch: vi.fn(),
  setActiveProviderAndSourceId: vi.fn(),
  selectActiveSourceId: vi.fn(),
  setKey: vi.fn(),
  setProviderMaxResults: vi.fn().mockResolvedValue(undefined),
  setRerankConfig: vi.fn().mockResolvedValue(undefined),
  setSourceHidden: vi.fn(),
  setSourceOrder: vi.fn(),
  setGroupConfig: vi.fn().mockResolvedValue(undefined),
  setAiAutoEnter: vi.fn().mockResolvedValue(undefined),
  setFlatLayoutFewSources: vi.fn().mockResolvedValue(undefined),
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
  getProviderConfigSnapshot: vi.fn(),
  ensureDefaultInstance: vi.fn(),
}));

vi.mock('@/lib/providers/registry', () => ({
  allProviders: vi.fn(() => [
    { id: 'tavily', label: 'provider_tavily', supportsAnswer: true },
    { id: 'exa', label: 'provider_exa', supportsAnswer: true },
    { id: 'brave', label: 'provider_brave', supportsAnswer: false },
    { id: 'stepfun', label: 'provider_stepfun', supportsAnswer: false },
    { id: 'stepfun-plan', label: 'provider_stepfun_plan', supportsAnswer: true },
    { id: 'jina', label: 'provider_jina', supportsAnswer: false },
    { id: 'doubao', label: 'provider_doubao', supportsAnswer: false },
    { id: 'doubao-global', label: 'provider_doubao_global', supportsAnswer: false },
    { id: 'parallel', label: 'provider_parallel', supportsAnswer: false },
  ]),
  getAdapter: vi.fn(),
}));

// schema 启动护栏短路；search-cache 保留真实 isAggregateCacheEntry / makeSearchCacheKey 等纯函数。
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

// rerank 客户端只 mock 网络调用（rerankDocuments/testRerank）；KTD12 校验、isRerankConfigured、
// RerankError 等保持真实实现参与测试。
vi.mock('@/lib/aggregate/rerank-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/aggregate/rerank-client')>()),
  rerankDocuments: vi.fn(),
  testRerank: vi.fn(),
}));

// Lane F（KTD3 Phase 3）：engine 成员扇出测试需要模拟 registry 漂移。getEngineExtractor 包一层
// 可按引擎禁用的转调——eligibility（extractorCapableEngineIds，调用时即时求值）与 gateway 扇出
// 校验都从它派生，置 disabled 即同时反映到两处（单一派生源口径的测试侧验证）。
const engineMemberState = vi.hoisted(() => ({ extractorDisabled: new Set<string>() }));

vi.mock('@/lib/engines/extractors/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/extractors/registry')>();
  const overridden = (engineId: Parameters<typeof actual.getEngineExtractor>[0]) =>
    engineMemberState.extractorDisabled.has(engineId) ? null : actual.getEngineExtractor(engineId);
  return { ...actual, getEngineExtractor: overridden as typeof actual.getEngineExtractor };
});

import {
  handleAggregateSearch,
  handleCreateAggregateInstance,
  handleDeleteAggregateInstance,
  handleSetRerankConfig,
  handleTestRerank,
  handleUpdateAggregateInstance,
} from '@/lib/gateway';
import {
  createAggregateInstance,
  deleteAggregateCacheEntries,
  deleteAggregateInstance,
  getAggregateInstances,
  getCachedSearch,
  getConfiguredProviderIds,
  getKey,
  getProviderInstances,
  getRerankConfig,
  saveCachedAggregateSearch,
  saveCachedSearch,
  setRerankConfig,
  updateAggregateInstance,
} from '@/lib/storage';
import { getAdapter } from '@/lib/providers/registry';
import { rerankDocuments, testRerank } from '@/lib/aggregate/rerank-client';
import { t, MSG } from '@/lib/i18n';

const AGG_ID: AggregateInstanceId = 'agg:inst-1';
const INSTANCE: AggregateInstance = { id: AGG_ID, name: '全家桶', members: ['tavily', 'exa'], topN: 20 };
const RERANK_CONFIG = { endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge-reranker-base' };

const mockedGetAggregateInstances = vi.mocked(getAggregateInstances);
const mockedGetRerankConfig = vi.mocked(getRerankConfig);
const mockedSetRerankConfig = vi.mocked(setRerankConfig);
const mockedDeleteAggregateCacheEntries = vi.mocked(deleteAggregateCacheEntries);
const mockedGetCachedSearch = vi.mocked(getCachedSearch);
const mockedGetConfigured = vi.mocked(getConfiguredProviderIds);
const mockedGetKey = vi.mocked(getKey);
const mockedGetProviderInstances = vi.mocked(getProviderInstances);
const mockedSaveCachedSearch = vi.mocked(saveCachedSearch);
const mockedSaveCachedAggregateSearch = vi.mocked(saveCachedAggregateSearch);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedRerankDocuments = vi.mocked(rerankDocuments);
const mockedTestRerank = vi.mocked(testRerank);
const mockedCreateAggregateInstance = vi.mocked(createAggregateInstance);
const mockedUpdateAggregateInstance = vi.mocked(updateAggregateInstance);
const mockedDeleteAggregateInstance = vi.mocked(deleteAggregateInstance);

function fakeAdapter(id: ProviderId, result: Partial<NormalizedResult> = {}, answer?: { text: string }): ProviderAdapter {
  const results: NormalizedResult[] = [{ title: `${id}-T0`, url: `https://${id}.test/0`, snippet: `${id}-s0`, ...result }];
  return {
    id,
    label: `provider_${id}`,
    supportsAnswer: true,
    favicon: '/icons/x.svg',
    search: vi.fn().mockResolvedValue({ query: 'q', provider: id, results, ...(answer ? { answer: { text: answer.text, citations: [] } } : {}) } satisfies NormalizedSearchResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAggregateInstances.mockResolvedValue([INSTANCE]);
  mockedGetRerankConfig.mockResolvedValue({ ...RERANK_CONFIG });
  mockedGetCachedSearch.mockResolvedValue(null);
  mockedGetConfigured.mockResolvedValue(['tavily', 'exa']);
  mockedGetKey.mockResolvedValue('k');
  mockedGetProviderInstances.mockResolvedValue([]);
  mockedSaveCachedSearch.mockImplementation(async (response, id) => ({
    id: 'sub-cache-1',
    cacheKey: `${id ?? response.provider}:${response.query}`,
    query: response.query,
    normalizedQuery: response.query,
    providerId: response.provider,
    createdAt: 1000,
    lastAccessedAt: 1000,
    response,
  }));
  mockedSaveCachedAggregateSearch.mockImplementation(async (response) => ({
    id: 'agg-cache-1',
    cacheKey: `${response.instanceId}:${response.query}`,
    query: response.query,
    normalizedQuery: response.query,
    providerId: 'aggregate',
    instanceId: response.instanceId,
    createdAt: 1000,
    lastAccessedAt: 1000,
    response: response as never,
  } as unknown as SearchCacheEntry));
  mockedRerankDocuments.mockResolvedValue([{ index: 1, relevance_score: 0.95 }, { index: 0, relevance_score: 0.1 }]);
  const adapters = new Map<ProviderId, ProviderAdapter>();
  mockedGetAdapter.mockImplementation((id) => {
    if (!adapters.has(id)) adapters.set(id, fakeAdapter(id));
    return adapters.get(id)!;
  });
});

function aggregateReply(response: AggregateSearchResponse): SearchCacheEntry {
  return {
    id: 'agg-hit',
    cacheKey: `${response.instanceId}:${response.query}`,
    query: response.query,
    normalizedQuery: response.query,
    providerId: 'aggregate' as unknown as ProviderId,
    instanceId: response.instanceId,
    createdAt: 555,
    lastAccessedAt: 555,
    response: response as unknown as NormalizedSearchResponse,
  };
}

describe('handleAggregateSearch (KTD3)', () => {
  it('fans out to provider members, merges, reranks, writes scores, and saves the aggregate entry', async () => {
    const tavily = fakeAdapter('tavily', { url: 'https://shared.test/x' }, { text: 'tavily answer' });
    const exa = fakeAdapter('exa', { url: 'https://shared.test/x' }, { text: 'exa answer' });
    mockedGetAdapter.mockImplementation((id) => (id === 'tavily' ? tavily : id === 'exa' ? exa : fakeAdapter(id)));
    mockedRerankDocuments.mockResolvedValue([{ index: 0, relevance_score: 0.95 }]);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.response.kind).toBe('aggregate');
    expect(reply.response.instanceId).toBe(AGG_ID);
    // R4：答案成员序全部保留。
    expect(reply.response.answers.map((a) => a.answer.text)).toEqual(['tavily answer', 'exa answer']);
    // R5：URL 归一去重 + provenance 合并；rerank 按 relevance_score 降序写 score。
    expect(reply.response.results).toHaveLength(1);
    expect(reply.response.results[0].sources).toEqual(['tavily', 'exa']);
    expect(reply.response.results[0].score).toBeCloseTo(0.95);
    // R13 meta 条数据源：去重计数随响应直传（merge 输出）。
    expect(reply.response.dedupedCount).toBe(1);
    // R6：member 状态（cache.hit=false → 无 cached 标记）。
    expect(reply.response.members).toEqual([
      { sourceId: 'tavily', ok: true, resultCount: 1 },
      { sourceId: 'exa', ok: true, resultCount: 1 },
    ]);
    // rerank 输入 = 合并候选池文档（title\nsnippet），top_n = 实例 topN。
    expect(mockedRerankDocuments).toHaveBeenCalledWith(
      RERANK_CONFIG,
      { query: 'q', documents: ['tavily-T0\ntavily-s0'], top_n: 20 },
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
    expect(mockedSaveCachedAggregateSearch).toHaveBeenCalledTimes(1);
    expect(mockedSaveCachedAggregateSearch.mock.calls[0][0].instanceId).toBe(AGG_ID);
    expect(reply.cache).toMatchObject({ hit: false, entryId: 'agg-cache-1' });
  });

  it('skips duplicate and out-of-range rerank indexes so a malformed response cannot project a candidate twice (Oracle #6)', async () => {
    // 两名成员各贡献一条不同 URL 候选（index 0/1）；畸形响应重复 index 1、越界 index 7。
    mockedRerankDocuments.mockResolvedValue([
      { index: 1, relevance_score: 0.95 },
      { index: 0, relevance_score: 0.9 },
      { index: 1, relevance_score: 0.5 },
      { index: 7, relevance_score: 0.99 },
    ]);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    // 重复下标按首现有效（index 1 → 0.95，0.5 项被跳过）、越界下标丢弃：仅两条候选、无重复投影。
    expect(reply.response.results.map((r) => r.url)).toEqual(['https://exa.test/0', 'https://tavily.test/0']);
    expect(reply.response.results.map((r) => r.score)).toEqual([0.95, 0.9]);
  });

  it('marks member.cached on a member sub-cache hit and keeps live members uncached (R6/AE2 前半)', async () => {
    mockedGetCachedSearch.mockImplementation(async (id) => {
      if (id !== 'tavily') return null;
      return {
        id: 'sub-hit',
        cacheKey: 'tavily:q',
        query: 'q',
        normalizedQuery: 'q',
        providerId: 'tavily',
        createdAt: 1,
        lastAccessedAt: 1,
        response: { query: 'q', provider: 'tavily', results: [{ title: 'TC', url: 'https://t.test/cached', snippet: 'tc' }] },
      };
    });
    const tavily = fakeAdapter('tavily');
    const exa = fakeAdapter('exa', { url: 'https://e.test/only' });
    mockedGetAdapter.mockImplementation((id) => (id === 'tavily' ? tavily : id === 'exa' ? exa : fakeAdapter(id)));

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.response.members.find((m) => m.sourceId === 'tavily')).toMatchObject({ ok: true, cached: true, resultCount: 1 });
    expect(reply.response.members.find((m) => m.sourceId === 'exa')).toMatchObject({ ok: true, resultCount: 1 });
    // 子缓存命中：tavily adapter 不实查。
    expect(tavily.search).not.toHaveBeenCalled();
    expect(exa.search).toHaveBeenCalled();
  });

  it('keeps per-member error taxonomy on partial failure and still returns ok (R6)', async () => {
    const exa = fakeAdapter('exa');
    (exa.search as ReturnType<typeof vi.fn>).mockRejectedValue(new ProviderError('unauthorized', 'bad key', 401));
    mockedGetAdapter.mockImplementation((id) => (id === 'exa' ? exa : fakeAdapter(id, {}, { text: 'tavily answer' })));

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const exaMember = reply.response.members.find((m) => m.sourceId === 'exa');
    expect(exaMember).toEqual({ sourceId: 'exa', ok: false, errorKind: 'unauthorized', errorMessage: 'bad key' });
    const tavilyMember = reply.response.members.find((m) => m.sourceId === 'tavily');
    expect(tavilyMember?.ok).toBe(true);
    // 只合并成功成员的结果与答案。
    expect(reply.response.results.every((r) => r.sources.includes('tavily'))).toBe(true);
    expect(reply.response.answers.map((a) => a.sourceId)).toEqual(['tavily']);
  });

  it('returns a providerError summary when every member fails, without caching or reranking', async () => {
    const failing = () => {
      const adapter = fakeAdapter('tavily');
      (adapter.search as ReturnType<typeof vi.fn>).mockRejectedValue(new ProviderError('rateLimit', 'slow down', 429));
      return adapter;
    };
    mockedGetAdapter.mockReturnValue(failing());

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.kind).toBe('providerError');
    // Lane D 落 i18n 后 t() 解析为真实文案（此前为占位键名回退）。
    expect(reply.error.message).toBe(t(MSG.error_aggregate_all_members_failed));
    expect(mockedRerankDocuments).not.toHaveBeenCalled();
    expect(mockedSaveCachedAggregateSearch).not.toHaveBeenCalled();
  });

  it('fails with a dedicated providerError when rerank fails and never degrades to unranked results (AE3)', async () => {
    mockedRerankDocuments.mockRejectedValue(new RerankError('network', 'connection refused'));

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.kind).toBe('providerError');
    expect(reply.error.message).toBe(t(MSG.error_aggregate_rerank_failed, 'connection refused'));
    expect(reply.error.providerErrorKind).toBe('network');
    expect(mockedSaveCachedAggregateSearch).not.toHaveBeenCalled();
  });

  it('serves a whole-entry aggregate cache hit with zero fan-out (AE7)', async () => {
    const cachedResponse: AggregateSearchResponse = {
      instanceId: AGG_ID,
      query: 'q',
      kind: 'aggregate',
      answers: [],
      results: [{ title: 'Cached', url: 'https://cached.test/', snippet: 'c', sources: ['tavily'], score: 1 }],
      members: [{ sourceId: 'tavily', ok: true, resultCount: 1 }],
      dedupedCount: 0,
      rerank: { rerankedAt: 42 },
    };
    mockedGetCachedSearch.mockResolvedValue(aggregateReply(cachedResponse));
    const tavily = fakeAdapter('tavily');
    mockedGetAdapter.mockReturnValue(tavily);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.cache).toEqual({ hit: true, entryId: 'agg-hit', createdAt: 555 });
      expect(reply.response).toEqual(cachedResponse);
    }
    expect(tavily.search).not.toHaveBeenCalled();
    expect(mockedRerankDocuments).not.toHaveBeenCalled();
    expect(mockedSaveCachedAggregateSearch).not.toHaveBeenCalled();
    // 聚合级读键 = agg 实例 id（KTD7 同源审计的读侧）。
    expect(mockedGetCachedSearch).toHaveBeenCalledWith(AGG_ID, 'q');
  });

  it('propagates forceRefresh: skips the aggregate read, all member sub-caches, and refetches everyone (AE2/R8)', async () => {
    const tavily = fakeAdapter('tavily', { url: 'https://t.test/fresh' });
    const exa = fakeAdapter('exa', { url: 'https://e.test/fresh' });
    mockedGetAdapter.mockImplementation((id) => (id === 'tavily' ? tavily : exa));
    mockedGetCachedSearch.mockResolvedValue(aggregateReply({
      instanceId: AGG_ID, query: 'q', kind: 'aggregate', answers: [], results: [], members: [], dedupedCount: 0, rerank: { rerankedAt: 0 },
    }));

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q', forceRefresh: true });

    expect(reply.ok).toBe(true);
    if (reply.ok) expect(reply.cache.hit).toBe(false);
    // 聚合级 + 成员级读取全部绕过（同一 flag 贯穿）。
    expect(mockedGetCachedSearch).not.toHaveBeenCalled();
    expect(tavily.search).toHaveBeenCalled();
    expect(exa.search).toHaveBeenCalled();
    expect(mockedRerankDocuments).toHaveBeenCalled();
    // 成员子缓存回写 + 聚合条目回写。
    expect(mockedSaveCachedSearch).toHaveBeenCalledTimes(2);
    expect(mockedSaveCachedAggregateSearch).toHaveBeenCalledTimes(1);
  });

  it('keeps member sub-cache keys identical to the solo/agent IU6 keys (same-source audit)', async () => {
    // 裸 provider 成员有实例 → 默认实例路由，cacheKeyId = 实例 id（与 solo search 同键）。
    mockedGetProviderInstances.mockResolvedValue([
      { id: 'inst:exa:first', baseProviderId: 'exa', name: 'First', options: { category: 'news' } },
    ]);
    const exa = fakeAdapter('exa');
    mockedGetAdapter.mockImplementation((id) => (id === 'exa' ? exa : fakeAdapter(id)));

    await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    // 成员子缓存写键 = 默认实例 id（与 solo search / agent search-instance 同源，IU6）。
    expect(mockedSaveCachedSearch).toHaveBeenCalledWith(expect.objectContaining({ provider: 'exa' }), 'inst:exa:first');
    // 默认实例 options 注入成员调用（resolveSearchSource 语义）。
    expect(exa.search).toHaveBeenCalledWith('q', { providerSettings: { category: 'news' } }, 'k');
    // 聚合条目写经 saveCachedAggregateSearch，instanceId 即 agg 实例 id（读写同源；读侧断言见缓存命中用例）。
    expect(mockedSaveCachedAggregateSearch).toHaveBeenCalledWith(expect.objectContaining({ instanceId: AGG_ID }));
  });

  it('returns unknown for a non-agg id or an undefined instance', async () => {
    const badForm = await handleAggregateSearch({ instanceId: 'not-agg' as never, query: 'q' });
    expect(badForm.ok).toBe(false);
    if (!badForm.ok) expect(badForm.error.kind).toBe('unknown');

    mockedGetAggregateInstances.mockResolvedValue([]);
    const unknownId = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });
    expect(unknownId.ok).toBe(false);
    if (!unknownId.ok) expect(unknownId.error.kind).toBe('unknown');
  });

  it('returns keyMissing when rerank is not configured, before any fan-out', async () => {
    mockedGetRerankConfig.mockResolvedValue({ endpoint: '' });

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('keyMissing');
      expect(reply.error.message).toBe(t(MSG.error_rerank_not_configured));
    }
    expect(mockedGetAdapter).not.toHaveBeenCalled();
    expect(mockedRerankDocuments).not.toHaveBeenCalled();
  });

  it('returns a providerError summary when the instance has zero valid members', async () => {
    mockedGetConfigured.mockResolvedValue([]); // tavily/exa 均未配置 key

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('providerError');
    expect(mockedRerankDocuments).not.toHaveBeenCalled();
  });
});

describe('handleSetRerankConfig (KTD12/KTD9)', () => {
  it('rewrites localhost to 127.0.0.1, persists, and invalidates all aggregate entries', async () => {
    const reply = await handleSetRerankConfig({ endpoint: 'http://localhost:8000/v1/rerank', model: 'bge' });

    expect(reply).toEqual({ ok: true, endpoint: 'http://127.0.0.1:8000/v1/rerank', rewritten: true });
    expect(mockedSetRerankConfig).toHaveBeenCalledWith({ endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge' });
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledWith('all');
  });

  it('rewrites [::1] and preserves port and path', async () => {
    const reply = await handleSetRerankConfig({ endpoint: 'http://[::1]:9200/v1/rerank' });

    expect(reply).toEqual({ ok: true, endpoint: 'http://127.0.0.1:9200/v1/rerank', rewritten: true });
  });

  it('keeps rewritten=false for a canonical 127.0.0.1 endpoint', async () => {
    const reply = await handleSetRerankConfig({ endpoint: 'http://127.0.0.1:8000/v1/rerank' });

    expect(reply).toEqual({ ok: true, endpoint: 'http://127.0.0.1:8000/v1/rerank', rewritten: false });
  });

  it('rejects https and remote hosts without persisting or invalidating (AE8)', async () => {
    const https = await handleSetRerankConfig({ endpoint: 'https://127.0.0.1:8000/v1/rerank' });
    expect(https.ok).toBe(false);
    if (!https.ok) {
      expect(https.error.kind).toBe('invalid');
      expect(https.error.message).toBe(t(MSG.error_rerank_endpoint_invalid));
    }

    const remote = await handleSetRerankConfig({ endpoint: 'http://192.168.1.10:8000/v1/rerank' });
    expect(remote.ok).toBe(false);

    const garbage = await handleSetRerankConfig({ endpoint: 'not a url' });
    expect(garbage.ok).toBe(false);

    expect(mockedSetRerankConfig).not.toHaveBeenCalled();
    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();
  });
});

describe('handleTestRerank (KTD6)', () => {
  it('returns ok via the real mini request and passes a fetch wrapper', async () => {
    mockedTestRerank.mockResolvedValue([{ index: 0, relevance_score: 0.5 }]);

    const reply = await handleTestRerank();

    expect(reply).toEqual({ ok: true });
    expect(mockedTestRerank).toHaveBeenCalledWith(RERANK_CONFIG, expect.objectContaining({ fetch: expect.any(Function) }));
  });

  it('maps keyMissing to the dedicated not-configured message', async () => {
    mockedTestRerank.mockRejectedValue(new RerankError('keyMissing', 'rerank endpoint is not configured'));

    const reply = await handleTestRerank();

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('keyMissing');
      expect(reply.error.message).toBe(t(MSG.error_rerank_not_configured));
    }
  });

  it('maps rerank failures to providerError with the sanitized detail', async () => {
    mockedTestRerank.mockRejectedValue(new RerankError('provider', 'upstream 500', 500));

    const reply = await handleTestRerank();

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('providerError');
      expect(reply.error.message).toBe('upstream 500');
    }
  });
});

describe('aggregate instance CRUD handlers + precise invalidation (KTD9/AE5)', () => {
  it('delegates create to the store', async () => {
    const created = { id: 'agg:new' as AggregateInstanceId, name: 'New', members: ['tavily'] as AggregateInstance['members'], topN: 10 };
    mockedCreateAggregateInstance.mockResolvedValue(created);

    await expect(handleCreateAggregateInstance({ name: 'New', members: ['tavily'], topN: 10 })).resolves.toEqual(created);
    expect(mockedCreateAggregateInstance).toHaveBeenCalledWith({ name: 'New', members: ['tavily'], topN: 10 });
  });

  it('invalidates only the edited instance when members actually change (instance B and provider history survive)', async () => {
    const instanceB: AggregateInstance = { id: 'agg:inst-2', name: 'B', members: ['brave'], topN: 5 };
    mockedGetAggregateInstances.mockResolvedValue([INSTANCE, instanceB]);
    mockedUpdateAggregateInstance.mockResolvedValue({ ...INSTANCE, members: ['tavily', 'exa', 'brave'] });

    await handleUpdateAggregateInstance({ id: AGG_ID, patch: { members: ['tavily', 'exa', 'brave'] } });

    expect(mockedUpdateAggregateInstance).toHaveBeenCalledWith(AGG_ID, { members: ['tavily', 'exa', 'brave'] });
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledTimes(1);
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledWith(AGG_ID);
  });

  it('invalidates only the edited instance when topN changes', async () => {
    mockedUpdateAggregateInstance.mockResolvedValue({ ...INSTANCE, topN: 10 });

    await handleUpdateAggregateInstance({ id: AGG_ID, patch: { topN: 10 } });

    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledWith(AGG_ID);
  });

  it('does not invalidate on a pure rename or a no-op members/topN patch', async () => {
    mockedUpdateAggregateInstance.mockResolvedValue({ ...INSTANCE, name: 'Renamed' });
    await handleUpdateAggregateInstance({ id: AGG_ID, patch: { name: 'Renamed' } });
    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();

    mockedUpdateAggregateInstance.mockResolvedValue({ ...INSTANCE });
    await handleUpdateAggregateInstance({ id: AGG_ID, patch: { members: ['tavily', 'exa'], topN: 20 } });
    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();
  });

  it('invalidates the deleted instance entries and rejects invalid id forms', async () => {
    await handleDeleteAggregateInstance(AGG_ID);
    expect(mockedDeleteAggregateInstance).toHaveBeenCalledWith(AGG_ID);
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledWith(AGG_ID);

    await expect(handleDeleteAggregateInstance('not-agg' as never)).rejects.toThrow('invalid_aggregate_instance');
    await expect(handleUpdateAggregateInstance({ id: 'not-agg' as never, patch: {} })).rejects.toThrow('invalid_aggregate_instance');
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledTimes(1);
  });
});

// === Lane F（KTD3 Phase 3 / R9 / AE4 / AE10）：聚合 engine 成员扇出 ===
//
// mock tabs 模式沿 tests/engine-search.test.ts：真 runEngineSearch 跑在受控 tabs API 上，
// gateway 经 vi.stubGlobal('browser') 拿到同一 API（deps 注入沿 background.ts 先例）。
// harness 的 sendMessage 返回按 tabId 挂起的 deferred（回显 requestId/engine/query 以通过
// runEngineSearch 的回包校验），可逐个放行——用于观察信号量窗口内的在途 tab 数。

interface EngineOutcomeFixture {
  results?: { title: string; url: string; snippet: string }[];
  error?: string;
}

function engineTabsHarness(outcomeFor: (engineId: string) => EngineOutcomeFixture, options: { hold?: boolean } = {}) {
  const updated = new Set<(tabId: number, change: { status?: string; url?: string }) => void>();
  const removed = new Set<(tabId: number) => void>();
  const pending = new Map<number, (value: unknown) => void>();
  let nextTabId = 1;
  let createdCount = 0;
  let removedCount = 0;
  // hold = true 时 sendMessage 挂起（并发窗口观察用）；默认立即回包（happy path 直读）。
  const hold = options.hold ?? false;
  const buildReply = (message: { requestId: string; engineId: string; query: string }): unknown => {
    const outcome = outcomeFor(message.engineId);
    return outcome.error
      ? { requestId: message.requestId, engine: message.engineId, query: message.query, error: outcome.error }
      : { requestId: message.requestId, engine: message.engineId, query: message.query, results: outcome.results ?? [] };
  };
  const api = {
    create: vi.fn(async ({ url }: { url: string; active: boolean }) => {
      createdCount += 1;
      return { id: nextTabId++, status: 'complete' as const, url };
    }),
    get: vi.fn(async (tabId: number) => ({ id: tabId, status: 'complete' as const, url: 'https://www.google.com/search?q=q' })),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(async (tabId: number) => {
      removedCount += 1;
      void tabId;
    }),
    sendMessage: vi.fn((tabId: number, message: { requestId: string; engineId: string; query: string }) =>
      new Promise((resolve) => {
        if (!hold) {
          resolve(buildReply(message));
          return;
        }
        pending.set(tabId, resolve);
      })),
    onUpdated: {
      addListener: vi.fn((listener: (tabId: number, change: { status?: string; url?: string }) => void) => updated.add(listener)),
      removeListener: vi.fn((listener: (tabId: number, change: { status?: string; url?: string }) => void) => updated.delete(listener)),
    },
    onRemoved: {
      addListener: vi.fn((listener: (tabId: number) => void) => removed.add(listener)),
      removeListener: vi.fn((listener: (tabId: number) => void) => removed.delete(listener)),
    },
    resolveTab(tabId: number) {
      const message = api.sendMessage.mock.calls.find(([candidateTabId]) => candidateTabId === tabId)?.[1];
      if (!message) return;
      pending.get(tabId)?.(buildReply(message));
      pending.delete(tabId);
    },
    resolveAllTabs() {
      for (const tabId of [...pending.keys()]) api.resolveTab(tabId);
    },
    createdCount: () => createdCount,
    inFlightTabs: () => createdCount - removedCount,
  };
  return api;
}

async function flushTasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('aggregate engine members (Lane F / KTD3 Phase 3)', () => {
  const ENGINE_RESULTS = (engineId: string, url: string) => [{ title: `${engineId} T`, url, snippet: `${engineId} s` }];

  let harness: ReturnType<typeof engineTabsHarness>;

  beforeEach(() => {
    vi.stubGlobal('browser', { tabs: harness = engineTabsHarness((engineId) => ({ results: ENGINE_RESULTS(engineId, `https://${engineId}.example.com/r`) })) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    engineMemberState.extractorDisabled.clear();
  });

  it('runs a single engine member end-to-end (AE10): results merge, cached stays absent, BYOK untouched', async () => {
    mockedGetAggregateInstances.mockResolvedValue([{ id: AGG_ID, name: '单引擎', members: ['google'], topN: 20 }]);
    mockedRerankDocuments.mockResolvedValue([{ index: 0, relevance_score: 0.9 }]);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    // 成员状态：ok + resultCount；cached 恒缺省（恒实时抽取，R6/R7）。
    expect(reply.response.members).toEqual([{ sourceId: 'google', ok: true, resultCount: 1 }]);
    expect('cached' in reply.response.members[0]).toBe(false);
    // 引擎结果沿 NormalizedResult 形状进 merge（answers 无则空贡献）。
    expect(reply.response.answers).toEqual([]);
    expect(reply.response.results).toHaveLength(1);
    expect(reply.response.results[0]).toMatchObject({ title: 'google T', url: 'https://google.example.com/r', sources: ['google'], score: 0.9 });
    expect(reply.response.dedupedCount).toBe(0);
    // engine 成员不触 provider 适配器/key，也不写子缓存（engine 不缓存）。
    expect(mockedGetAdapter).not.toHaveBeenCalled();
    expect(mockedGetKey).not.toHaveBeenCalled();
    expect(mockedSaveCachedSearch).not.toHaveBeenCalled();
    expect(mockedSaveCachedAggregateSearch).toHaveBeenCalledTimes(1);
    // deps 注入沿 background 先例：completeTimeoutMs = 20_000（KTD3）。
    expect(harness.createdCount()).toBe(1);
  });

  it('fans out multiple engine members, dedupes shared URLs, and keeps meta counts right', async () => {
    mockedGetAggregateInstances.mockResolvedValue([{ id: AGG_ID, name: '双引擎', members: ['google', 'bing'], topN: 20 }]);
    // harness 默认 resultsFor 用引擎专属 URL；这里让两引擎命中同一 URL 验证去重/provenance。
    vi.stubGlobal('browser', { tabs: harness = engineTabsHarness((engineId) => ({ results: ENGINE_RESULTS(engineId, 'https://shared.example.com/x') })) });
    mockedRerankDocuments.mockResolvedValue([{ index: 0, relevance_score: 0.5 }]);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.response.members).toEqual([
      { sourceId: 'google', ok: true, resultCount: 1 },
      { sourceId: 'bing', ok: true, resultCount: 1 },
    ]);
    expect(reply.response.results).toHaveLength(1);
    expect(reply.response.results[0].sources).toEqual(['google', 'bing']);
    expect(reply.response.dedupedCount).toBe(1);
    // rerank 输入 = 合并候选池（去重后 1 条）。
    expect(mockedRerankDocuments).toHaveBeenCalledWith(
      RERANK_CONFIG,
      { query: 'q', documents: ['google T\ngoogle s'], top_n: 20 },
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
  });

  it('passes engine failure taxonomy through per member and never blocks the rest (R6/AE4)', async () => {
    mockedGetAggregateInstances.mockResolvedValue([{ id: AGG_ID, name: '反爬混编', members: ['google', 'bing', 'baidu'], topN: 20 }]);
    // google = page-state 分型（反爬拦截，AE4）；bing = orchestration 分型（超时）；baidu 成功。
    // 分型保留不折叠（engine-search-orchestration 教训）。
    vi.stubGlobal('browser', {
      tabs: harness = engineTabsHarness((engineId) => {
        if (engineId === 'google') return { error: 'challenge' };
        if (engineId === 'bing') return { error: 'timeout' };
        return { results: ENGINE_RESULTS(engineId, `https://${engineId}.example.com/r`) };
      }),
    });

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.response.members).toEqual([
      { sourceId: 'google', ok: false, errorKind: 'challenge', errorMessage: 'challenge' },
      { sourceId: 'bing', ok: false, errorKind: 'timeout', errorMessage: 'timeout' },
      { sourceId: 'baidu', ok: true, resultCount: 1 },
    ]);
    // 失败成员不贡献结果/答案，其余成员照常合并 + rerank（部分失败聚合整体 ok）。
    expect(reply.response.results).toHaveLength(1);
    expect(reply.response.results[0].sources).toEqual(['baidu']);
    expect(reply.response.answers).toEqual([]);
    expect(mockedSaveCachedAggregateSearch).toHaveBeenCalledTimes(1);
  });

  it('caps concurrent engine tabs at 3 while 4 members are in flight (KTD3 semaphore)', async () => {
    mockedGetAggregateInstances.mockResolvedValue([{ id: AGG_ID, name: '四引擎', members: ['google', 'bing', 'baidu', 'duckduckgo'], topN: 20 }]);
    mockedRerankDocuments.mockResolvedValue([{ index: 0, relevance_score: 0.5 }]);
    // hold 模式：sendMessage 挂起，tab 停在在途，便于观察信号量窗口。
    vi.stubGlobal('browser', { tabs: harness = engineTabsHarness((engineId) => ({ results: ENGINE_RESULTS(engineId, `https://${engineId}.example.com/r`) }), { hold: true }) });

    const replyPromise = handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });
    await flushTasks();

    // 4 个 engine 成员只有 3 个获得 tab 窗口：第 4 个在信号量外排队。
    expect(harness.createdCount()).toBe(3);
    expect(harness.inFlightTabs()).toBe(3);

    // 放行一个成员 → 其 tab 清理 → 队首成员入场：在途数仍 ≤3。
    harness.resolveTab(1);
    await flushTasks();
    expect(harness.createdCount()).toBe(4);
    expect(harness.inFlightTabs()).toBeLessThanOrEqual(3);

    harness.resolveAllTabs();
    const reply = await replyPromise;
    await flushTasks();
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.response.members.filter((m) => m.ok)).toHaveLength(4);
    }
    expect(harness.inFlightTabs()).toBe(0);
  });

  it('marks a registry-drifted engine member as failed without throwing the aggregate (R9 single-derivation check)', async () => {
    // 模拟 registry 漂移：weixin 的 extractor 消失（eligibility 与扇出校验同时失去该引擎）。
    engineMemberState.extractorDisabled.add('weixin');
    mockedGetAggregateInstances.mockResolvedValue([{ id: AGG_ID, name: '含漂移成员', members: ['tavily', 'weixin'], topN: 20 }]);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const weixinMember = reply.response.members.find((m) => m.sourceId === 'weixin');
    expect(weixinMember).toEqual({ sourceId: 'weixin', ok: false, errorKind: 'unsupported-engine', errorMessage: 'unsupported-engine' });
    // 未漂移的 provider 成员照常执行（不 throw 整体）。
    expect(reply.response.members.find((m) => m.sourceId === 'tavily')?.ok).toBe(true);
    expect(reply.response.results.every((r) => r.sources.includes('tavily'))).toBe(true);
  });

  it('mixes provider and engine members in one aggregate run (provenance merge, provider-only answers)', async () => {
    mockedGetAggregateInstances.mockResolvedValue([{ id: AGG_ID, name: '混合', members: ['tavily', 'google'], topN: 20 }]);
    const tavily = fakeAdapter('tavily', { url: 'https://shared.example.com/x' }, { text: 'tavily answer' });
    mockedGetAdapter.mockImplementation((id) => (id === 'tavily' ? tavily : fakeAdapter(id)));
    // google 命中与 tavily 相同的 URL（归一后 provenance 合并）。
    vi.stubGlobal('browser', { tabs: harness = engineTabsHarness(() => ({ results: ENGINE_RESULTS('google', 'https://shared.example.com/x') })) });
    mockedRerankDocuments.mockResolvedValue([{ index: 0, relevance_score: 0.7 }]);

    const reply = await handleAggregateSearch({ instanceId: AGG_ID, query: 'q' });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    // 全链路：provider（缓存→key→adapter）+ engine（tab 抽取）结果合并去重，双徽标。
    expect(reply.response.results).toHaveLength(1);
    expect(reply.response.results[0].sources).toEqual(['tavily', 'google']);
    expect(reply.response.dedupedCount).toBe(1);
    // R4：答案仅来自支持答案的 provider 成员（engine 无综合答案 → 空贡献）。
    expect(reply.response.answers).toEqual([{ sourceId: 'tavily', answer: { text: 'tavily answer', citations: [] } }]);
    expect(reply.response.members).toEqual([
      { sourceId: 'tavily', ok: true, resultCount: 1 },
      { sourceId: 'google', ok: true, resultCount: 1 },
    ]);
    expect('cached' in (reply.response.members.find((m) => m.sourceId === 'google') ?? {})).toBe(false);
    // rerank 文档 = 合并候选池：同 URL 已折叠进 tavily 首现条目 → 仅 1 个文档（首现形状）。
    expect(mockedRerankDocuments).toHaveBeenCalledWith(
      RERANK_CONFIG,
      { query: 'q', documents: ['tavily-T0\ntavily-s0'], top_n: 20 },
      expect.objectContaining({ fetch: expect.any(Function) }),
    );
  });
});
