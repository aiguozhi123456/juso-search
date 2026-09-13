import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '@/entrypoints/search/App';
import { sendMessage } from '@/lib/messaging';
import type { AggregateInstanceId, AggregateSearchResponse } from '@/lib/aggregate/types';

// Lane D（KTD16/R4/R5/R13/R11）搜索页聚合 UI 组件测试：
// mock @/lib/messaging + @/lib/storage，沿 tests/search-page.test.tsx 既有模式。

const AGG: AggregateInstanceId = 'agg:test1';
const INSTANCE = { id: AGG, name: '全家桶', members: ['tavily', 'inst:exa:r1', 'google'] as never[], topN: 20 };
const EXA_INSTANCE = { id: 'inst:exa:r1', baseProviderId: 'exa', name: 'AI 研究', options: {} };

function aggregateSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instances: [INSTANCE],
    eligibility: { [AGG]: { eligible: true, validMembers: 3 } },
    rerank: { configured: true, hasApiKey: false, endpoint: 'http://127.0.0.1:8000/v1/rerank' },
    ...overrides,
  };
}

/** 构造完整的 getProviderConfig 响应（聚合快照 + 全部置顶平铺 groupConfig，复刻 search-page.test 模式）。 */
function configReply(partial: Record<string, unknown>): Record<string, unknown> {
  const configuredProviderIds = (partial.configuredProviderIds as string[] | undefined) ?? [];
  const aggregate = partial.aggregate as { instances: { id: string }[] } | undefined;
  const providerInstances = (partial.providerInstances as { id: string }[] | undefined) ?? [EXA_INSTANCE];
  const allSourceIds = [
    ...configuredProviderIds,
    ...providerInstances.map((instance) => instance.id),
    ...(aggregate?.instances ?? []).map((instance) => instance.id),
    'google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', 'weixin',
    ...((partial.siteInstances as { id: string }[] | undefined) ?? []).map((s) => s.id),
  ];
  return {
    configuredProviderIds: [],
    activeProviderId: null,
    activeSourceId: 'google',
    sourceOrder: [],
    sourceHidden: [],
    siteInstances: [],
    providerMaxResults: {},
    providerInstances,
    ...partial,
    groupConfig: partial.groupConfig ?? {
      groups: [
        { id: 'ai-search', label: { kind: 'i18n', key: 'group_ai_search' } },
        { id: 'engines', label: { kind: 'i18n', key: 'group_engines' } },
        { id: 'sites', label: { kind: 'i18n', key: 'group_sites' } },
      ],
      layout: allSourceIds.map((id) => ({ kind: 'source', sourceId: id })),
      assignments: {},
    },
  };
}

function aggregateResponse(overrides: Partial<AggregateSearchResponse> = {}): AggregateSearchResponse {
  return {
    instanceId: AGG,
    query: 'hello',
    kind: 'aggregate',
    answers: [
      { sourceId: 'tavily', answer: { text: 'tavily answer', citations: [{ url: 'https://a.test/1', title: 'Cite A' }] } },
      { sourceId: 'inst:exa:r1', answer: { text: 'exa instance answer', citations: [] } },
    ],
    results: [
      { title: 'Dedup', url: 'https://x.test/a', snippet: 'shared snippet', sources: ['tavily', 'inst:exa:r1'], score: 0.95 },
      { title: 'Solo', url: 'https://y.test/b', snippet: 'solo snippet', sources: ['google'], score: 0.5 },
    ],
    members: [
      { sourceId: 'tavily', ok: true, cached: true, resultCount: 2 },
      { sourceId: 'inst:exa:r1', ok: true, resultCount: 1 },
      { sourceId: 'google', ok: false, errorKind: 'extract-failed', errorMessage: 'blocked by anti-bot' },
    ],
    dedupedCount: 1,
    rerank: { model: 'bge-reranker-base', rerankedAt: 123 },
    ...overrides,
  };
}

function aggregateOk(response: AggregateSearchResponse, cache: { hit: boolean; entryId?: string; createdAt?: number } = { hit: false }) {
  return { ok: true, response, cache };
}

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));
vi.mock('@/lib/useStyle', () => ({
  useStyle: () => ({ pref: 'classic', setPref: vi.fn() }),
}));
// i18n 用真实查表（默认 zh_CN），断言直接用真实中文文案。
const openOptionsPage = vi.fn();
vi.stubGlobal('browser', {
  runtime: { openOptionsPage },
  storage: {
    onChanged: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  },
});

const mockedSend = vi.mocked(sendMessage);

function installConfig(partial: Record<string, unknown> = {}) {
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve(configReply({
        configuredProviderIds: ['tavily', 'exa'],
        activeProviderId: 'tavily',
        activeSourceId: AGG,
        aggregate: aggregateSnapshot(),
        ...partial,
      }));
    }
    if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
    return Promise.resolve(aggregateOk(aggregateResponse()));
  }) as never);
}

async function doAggregateSearch(reply: unknown, partial: Record<string, unknown> = {}) {
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve(configReply({
        configuredProviderIds: ['tavily', 'exa'],
        activeProviderId: 'tavily',
        activeSourceId: AGG,
        aggregate: aggregateSnapshot(),
        ...partial,
      }));
    }
    if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
    return Promise.resolve(reply);
  }) as never);
  render(<App />);
  fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'hello', forceRefresh: undefined }));
}

describe('search page: aggregate view (Lane D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installConfig();
  });

  it('renders the aggregate chip from the snapshot projection (KTD4 第 7 参 / AE1)', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: /全家桶/ })).toBeInTheDocument();
  });

  it('renders answers with member badges, the R13 meta bar, per-result badges and scores (AE1/R4/R5)', async () => {
    await doAggregateSearch(aggregateOk(aggregateResponse()));

    // 视图标题 = 实例名（R13）。用 heading role 定位（避免与快切栏 chip 文本撞匹配）。
    expect(await screen.findByRole('heading', { level: 2, name: '全家桶' })).toBeInTheDocument();
    // R4：answers 区在结果列表前，每条带来源徽标（favicon + label），成员序全展示。
    expect(screen.getByText('tavily answer')).toBeInTheDocument();
    expect(screen.getByText('exa instance answer')).toBeInTheDocument();
    // 成员徽标：provider 实例成员显示实例名（快照 providerInstances）。按卡片定位避免与结果徽标撞匹配。
    const exaAnswerCard = screen.getByText('exa instance answer').closest('section.aggregate-answer') as HTMLElement;
    expect(within(exaAnswerCard).getByText('AI 研究')).toBeInTheDocument();
    // R13 meta 条：N 源 · M 成功（K 缓存）/ X 失败 · 去重 D 条 · 重排 top Y。
    const meta = screen.getByText((_, element) => element?.classList.contains('aggregate-meta-summary') === true);
    expect(meta.textContent).toContain('3 源');
    expect(meta.textContent).toContain('2 成功（1 缓存）');
    expect(meta.textContent).toContain('1 失败');
    expect(meta.textContent).toContain('去重 1 条');
    expect(meta.textContent).toContain('重排 top 2');
    // R5：per-result 多源多徽标（去重条目带 Tavily + AI 研究两枚徽标）。
    const dedupCard = screen.getByText('Dedup').closest('article') as HTMLElement;
    expect(within(dedupCard).getByText('Tavily')).toBeInTheDocument();
    expect(within(dedupCard).getByText('AI 研究')).toBeInTheDocument();
    // R5：score 百分比展示。
    expect(within(dedupCard).getByText('相关度 95%')).toBeInTheDocument();
    const soloCard = screen.getByText('Solo').closest('article') as HTMLElement;
    expect(within(soloCard).getByText('Google')).toBeInTheDocument();
  });

  it('expands per-member details with taxonomy-preserving failure reasons (R6/R13)', async () => {
    await doAggregateSearch(aggregateOk(aggregateResponse()));

    fireEvent.click(await screen.findByRole('button', { name: '明细' }));
    const details = screen.getByTestId('aggregate-details');
    // 缓存成员显示缓存命中 + 条数；失败成员保留错误分型与原因（不折叠）。
    expect(within(details).getByText('缓存命中')).toBeInTheDocument();
    expect(within(details).getByText('2 条结果')).toBeInTheDocument();
    expect(within(details).getByText('失败（extract-failed） · blocked by anti-bot')).toBeInTheDocument();
    // 实时成员（非缓存）。
    expect(within(details).getByText('实时')).toBeInTheDocument();
  });

  it('shows the aggregate cache hit notice on a whole-entry hit and forces a fresh search (R13/R8/AE2/AE7 前半)', async () => {
    await doAggregateSearch(aggregateOk(aggregateResponse(), { hit: true, entryId: 'agg-cache-1', createdAt: Date.now() - 60_000 }));

    expect(await screen.findByText(/聚合缓存命中/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '强制全新搜索' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'hello', forceRefresh: true }));
  });

  it('keeps the details toggle hygienic and the member rows faithful on a whole-entry cache hit (Lane G, R6/R13/AE7)', async () => {
    await doAggregateSearch(aggregateOk(aggregateResponse(), { hit: true, entryId: 'agg-cache-1', createdAt: Date.now() - 60_000 }));

    expect(await screen.findByText(/聚合缓存命中/)).toBeInTheDocument();
    // 默认收起；aria-expanded 卫生。
    const toggle = screen.getByRole('button', { name: '明细' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('aggregate-details')).toBeNull();

    // 展开：整条命中回放的明细成员行与命中内容一致（tavily 缓存命中 + 条数 / exa 实时 /
    // google 失败分型原样保留），不因整条缓存命中改写成员状态。
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const details = screen.getByTestId('aggregate-details');
    expect(within(details).getByText('缓存命中')).toBeInTheDocument();
    expect(within(details).getByText('2 条结果')).toBeInTheDocument();
    expect(within(details).getByText('实时')).toBeInTheDocument();
    expect(within(details).getByText('失败（extract-failed） · blocked by anti-bot')).toBeInTheDocument();

    // 收起：面板消失。
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('aggregate-details')).toBeNull();
  });

  it('confirms with the member count before a forced refresh when the instance has ≥4 valid members (账单提示, plan Phase 4)', async () => {
    const fourMembers = aggregateResponse({
      members: [
        { sourceId: 'tavily', ok: true, resultCount: 2 },
        { sourceId: 'inst:exa:r1', ok: true, resultCount: 1 },
        { sourceId: 'brave', ok: true, resultCount: 1 },
        { sourceId: 'google', ok: false, errorKind: 'extract-failed', errorMessage: 'blocked by anti-bot' },
      ],
    });
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve(configReply({
          configuredProviderIds: ['tavily', 'exa'],
          activeProviderId: 'tavily',
          activeSourceId: AGG,
          // 快照 eligibility（KTD5）= 有效成员数：4 → 触发两步确认。
          aggregate: aggregateSnapshot({ eligibility: { [AGG]: { eligible: true, validMembers: 4 } } }),
        }));
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve(aggregateOk(fourMembers));
    }) as never);
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'hello', forceRefresh: undefined }));
    expect(await screen.findByRole('heading', { level: 2, name: '全家桶' })).toBeInTheDocument();
    mockedSend.mockClear();

    // 点击不直接执行：先弹两步确认，文案带有效成员数（$1=N）。
    fireEvent.click(screen.getByRole('button', { name: '强制全新搜索' }));
    expect(screen.getByRole('alert')).toHaveTextContent('将重新查询 4 个成员');
    expect(screen.getByRole('button', { name: '确认重查' })).toBeInTheDocument();
    expect(mockedSend).not.toHaveBeenCalledWith('aggregateSearch', expect.objectContaining({ forceRefresh: true }));

    // 确认 → 才发起 forceRefresh。
    fireEvent.click(screen.getByRole('button', { name: '确认重查' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'hello', forceRefresh: true }));
  });

  it('cancels the forced-refresh confirmation without searching (账单提示取消路径)', async () => {
    const fourMembers = aggregateResponse({
      members: [
        { sourceId: 'tavily', ok: true, resultCount: 2 },
        { sourceId: 'inst:exa:r1', ok: true, resultCount: 1 },
        { sourceId: 'brave', ok: true, resultCount: 1 },
        { sourceId: 'jina', ok: true, resultCount: 1 },
      ],
    });
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve(configReply({
          configuredProviderIds: ['tavily', 'exa'],
          activeProviderId: 'tavily',
          activeSourceId: AGG,
          aggregate: aggregateSnapshot({ eligibility: { [AGG]: { eligible: true, validMembers: 4 } } }),
        }));
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve(aggregateOk(fourMembers));
    }) as never);
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'hello', forceRefresh: undefined }));
    mockedSend.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '强制全新搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    // 取消：确认收回（回到「强制全新搜索」按钮），不发任何请求。
    expect(screen.queryByRole('button', { name: '确认重查' })).toBeNull();
    expect(screen.getByRole('button', { name: '强制全新搜索' })).toBeInTheDocument();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('renders ErrorState with the rerank-specific CTA on keyMissing (R3), without any results', async () => {
    await doAggregateSearch({ ok: false, error: { kind: 'keyMissing', message: '尚未配置重排服务（rerank endpoint），聚合搜索不可用' } });

    expect(await screen.findByText('尚未配置重排服务（rerank endpoint），聚合搜索不可用')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: '打开设置配置重排服务' });
    fireEvent.click(cta);
    await waitFor(() => expect(openOptionsPage).toHaveBeenCalled());
    // 不降级渲染：无聚合视图内容（heading 定位避免与快切栏 chip 撞匹配）。
    expect(screen.queryByRole('heading', { level: 2, name: '全家桶' })).not.toBeInTheDocument();
  });

  it('renders ErrorState without a settings CTA on rerank providerError and never degrades (AE3)', async () => {
    await doAggregateSearch({ ok: false, error: { kind: 'providerError', message: '重排服务调用失败：connection refused', providerErrorKind: 'network' } });

    expect(await screen.findByText('重排服务调用失败：connection refused')).toBeInTheDocument();
    expect(screen.queryByText(/打开设置/)).not.toBeInTheDocument();
    expect(screen.queryByText('tavily answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Dedup')).not.toBeInTheDocument();
  });

  it('writes activeSource before searching with the current input when the aggregate chip is clicked (provider-switch-current-query)', async () => {
    installConfig({ activeSourceId: 'tavily' });
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'world' } });
    fireEvent.click(await screen.findByRole('button', { name: /全家桶/ }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', AGG));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'world', forceRefresh: undefined }));
    // 写序在搜序之前（教训：先写 activeSource 再搜当前词）。
    const calls = mockedSend.mock.calls.map(([type]) => type);
    expect(calls.indexOf('setActiveSource')).toBeLessThan(calls.indexOf('aggregateSearch'));
  });

  it('accepts a deep link to an eligible aggregate instance and auto-searches it (KTD16)', async () => {
    const spy = vi.fn();
    const real = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, assign: spy, search: `?provider=${encodeURIComponent(AGG)}&query=deep` }, writable: true });
    try {
      render(<App />);
      await waitFor(() =>
        expect(mockedSend).toHaveBeenCalledWith('aggregateSearch', { instanceId: AGG, query: 'deep', forceRefresh: undefined }),
      );
      expect(screen.getByLabelText('搜索词')).toHaveValue('deep');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: real, writable: true });
    }
  });

  it('ignores a deep-linked aggregate instance that is no longer defined and falls back to the active source (AE10 后半 stillDefined)', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve(configReply({
          configuredProviderIds: ['tavily', 'exa'],
          activeProviderId: 'tavily',
          activeSourceId: 'tavily',
          // 实例已被删除（快照定义集为空）→ 深链不受理。
          aggregate: aggregateSnapshot({ instances: [], eligibility: {} }),
        }));
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'x', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    const spy = vi.fn();
    const real = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, assign: spy, search: '?provider=agg%3Adeleted&query=x' }, writable: true });
    try {
      render(<App />);
      await waitFor(() =>
        expect(mockedSend).toHaveBeenCalledWith('search', { query: 'x', forceRefresh: undefined, providerId: 'tavily' }),
      );
      expect(mockedSend).not.toHaveBeenCalledWith('aggregateSearch', expect.anything());
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: real, writable: true });
    }
  });

  it('replays an aggregate history entry with the full response and restores the agg id as active (AE7 后半/R11/Oracle F4)', async () => {
    const entryResponse = aggregateResponse({ query: 'cached query' });
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve(configReply({
          configuredProviderIds: ['tavily', 'exa'],
          activeProviderId: 'tavily',
          activeSourceId: 'tavily',
          aggregate: aggregateSnapshot(),
        }));
      }
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'agg-cache-1', cacheKey: `${AGG}:cached query`, query: 'cached query', normalizedQuery: 'cached query', providerId: 'aggregate', instanceId: AGG, createdAt: 1, lastAccessedAt: 1, answerPreview: 'tavily answer', resultPreviews: [{ title: 'Dedup', url: 'https://x.test/a' }], resultCount: 2 },
        ]);
      }
      if (type === 'getCachedSearchEntry') {
        return Promise.resolve({
          id: 'agg-cache-1',
          cacheKey: `${AGG}:cached query`,
          query: 'cached query',
          normalizedQuery: 'cached query',
          providerId: 'aggregate',
          instanceId: AGG,
          createdAt: 1,
          lastAccessedAt: 1,
          response: entryResponse,
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);

    // 历史列表 label（Oracle F4）：'aggregate' 哨兵 → i18n「聚合 · 实例名」
    // （label 与相对时间同 span 拆分多文本节点 → 按 class + includes 匹配）。
    fireEvent.click(await screen.findByRole('button', { name: '历史' }));
    expect(await screen.findByText((_, element) => element?.classList.contains('history-meta') === true
      && (element.textContent ?? '').includes('聚合 · 全家桶'))).toBeInTheDocument();
    fireEvent.click((await screen.findByText('cached query')).closest('button') as HTMLButtonElement);

    // 回放保真：完整聚合响应渲染（标题/answers/多源徽标/meta 条）。
    expect(await screen.findByRole('heading', { level: 2, name: '全家桶' })).toBeInTheDocument();
    expect(screen.getByText('tavily answer')).toBeInTheDocument();
    expect(screen.getByText('exa instance answer')).toBeInTheDocument();
    expect(screen.getByText('Dedup')).toBeInTheDocument();
    // 绕过 configured gate：active 回写 agg 实例 id。
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', AGG));
    // 回放不触发任何搜索。
    expect(mockedSend).not.toHaveBeenCalledWith('aggregateSearch', expect.anything());
    expect(mockedSend).not.toHaveBeenCalledWith('search', expect.anything());
  });

  it('clears the aggregate view and runs a solo search when switching to a provider chip (切源卫生)', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve(configReply({
          configuredProviderIds: ['tavily', 'exa'],
          activeProviderId: 'tavily',
          activeSourceId: AGG,
          aggregate: aggregateSnapshot(),
        }));
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      if (type === 'aggregateSearch') return Promise.resolve(aggregateOk(aggregateResponse()));
      return Promise.resolve({ ok: true, response: { query: 'hello', provider: 'exa', results: [{ title: 'Solo result', url: 'https://solo.test', snippet: 's' }] }, cache: { hit: false } });
    }) as never);
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('heading', { level: 2, name: '全家桶' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /AI 研究/ }));
    // exa 有实例 → chip 为实例 pill，搜索透传实例 id（与 provider chip 同路径）。
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'inst:exa:r1'));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', { query: 'hello', forceRefresh: undefined, providerId: 'inst:exa:r1' }));
    expect(await screen.findByText('Solo result')).toBeInTheDocument();
    // 聚合视图已清空（无残留标题/answers）。
    expect(screen.queryByRole('heading', { level: 2, name: '全家桶' })).not.toBeInTheDocument();
    expect(screen.queryByText('tavily answer')).not.toBeInTheDocument();
  });
});
