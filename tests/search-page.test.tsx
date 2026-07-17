import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import App from '@/entrypoints/search/App';
import { sendMessage } from '@/lib/messaging';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
// 主题/locale 逻辑由 useTheme/useLocale 单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));
// i18n 用真实查表（import.meta.glob 打包，默认 zh_CN），不再 mock —— 断言直接用真实中文文案。
const openOptionsPage = vi.fn();
const storageListeners = new Set<(changes: Record<string, unknown>) => void>();
vi.stubGlobal('browser', {
  runtime: { openOptionsPage },
  storage: {
    onChanged: {
      addListener: (listener: (changes: Record<string, unknown>) => void) => storageListeners.add(listener),
      removeListener: (listener: (changes: Record<string, unknown>) => void) => storageListeners.delete(listener),
    },
  },
});

const mockedSend = vi.mocked(sendMessage);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
    }
    if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
    return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] }, cache: { hit: false } });
  }) as never);
});

async function doSearch(reply: unknown) {
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
    }
    if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
    return Promise.resolve(reply);
  }) as never);
  render(<App />);
  fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', { query: 'hello', forceRefresh: undefined, providerId: 'tavily' }));
}

describe('search page', () => {
  it('hides sources marked hidden in sourceHidden from the quick-switch bar', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['tavily', 'exa'],
          activeProviderId: 'tavily',
          activeSourceId: 'tavily',
          sourceHidden: ['google'],
        });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    const switcher = await screen.findByRole('group', { name: '切换搜索来源' });
    expect(within(switcher).queryByText('Google')).not.toBeInTheDocument();
    expect(within(switcher).getByText('Tavily')).toBeInTheDocument();
    expect(within(switcher).getByText('Bing')).toBeInTheDocument();
  });

  it('renders the answer card when the reply has an answer', async () => {
    await doSearch({
      ok: true,
      cache: { hit: false },
      response: {
        query: 'hello',
        provider: 'tavily',
        answer: { text: 'It is 42.', citations: [{ url: 'https://a.com', title: 'A' }] },
        results: [{ title: 'R', url: 'https://r.com', snippet: 'snippet R' }],
      },
    });
    expect(await screen.findByText('It is 42.')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('hides the answer card when the provider returns no answer (R5 degradation)', async () => {
    await doSearch({
      ok: true,
      cache: { hit: false },
      response: {
        query: 'q',
        provider: 'stepfun',
        results: [{ title: 'R', url: 'https://r.com', snippet: 'snippet R' }],
      },
    });
    expect(await screen.findByText('R')).toBeInTheDocument();
    expect(screen.queryByText('AI 回答')).not.toBeInTheDocument();
  });

  it('switching provider writes active source id', async () => {
    render(<App />);
    const exaBtn = await screen.findByRole('button', { name: /Exa/ });
    fireEvent.click(exaBtn);
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
  });

  it('switching provider searches with the current input value', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', { query: 'hello', forceRefresh: undefined, providerId: 'tavily' }));

    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'world' } });
    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', { query: 'world', forceRefresh: undefined, providerId: 'exa' }));
  });

  it('switching provider with an empty input does not search', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
    expect(mockedSend).not.toHaveBeenCalledWith('search', expect.objectContaining({ query: expect.any(String) }));
  });

  it('disables provider switching while search is loading', async () => {
    const pendingSearch = deferred<{ ok: true; response: { query: string; provider: 'tavily'; results: [] }; cache: { hit: false } }>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'search') return pendingSearch.promise;
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);

    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    const exaBtn = await screen.findByRole('button', { name: /Exa/ });
    await waitFor(() => expect(exaBtn).toBeDisabled());
    fireEvent.click(exaBtn);

    expect(mockedSend).not.toHaveBeenCalledWith('setActiveSource', 'exa');
    await act(async () => {
      pendingSearch.resolve({ ok: true, response: { query: 'hello', provider: 'tavily', results: [] }, cache: { hit: false } });
      await pendingSearch.promise;
    });
  });

  it('interrupting a search drops the stale response and re-enables provider switching', async () => {
    const pendingSearch = deferred<{ ok: true; response: { query: string; provider: 'tavily'; results: [{ title: string; url: string; snippet: string }] }; cache: { hit: false } }>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'search') return pendingSearch.promise;
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);

    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const interrupt = await screen.findByRole('button', { name: '打断' });
    fireEvent.click(interrupt);

    const exaBtn = await screen.findByRole('button', { name: /Exa/ });
    await waitFor(() => expect(exaBtn).not.toBeDisabled());
    await act(async () => {
      pendingSearch.resolve({ ok: true, response: { query: 'hello', provider: 'tavily', results: [{ title: 'Stale', url: 'https://stale.test', snippet: 'stale' }] }, cache: { hit: false } });
      await pendingSearch.promise;
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: '打断' })).not.toBeInTheDocument());
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('disables provider switching while a provider switch is pending', async () => {
    const exaSwitch = deferred<void>();
    mockedSend.mockImplementation(((type: string, data: unknown) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa', 'stepfun'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'setActiveSource' && data === 'exa') return exaSwitch.promise;
      if (type === 'setActiveSource') return Promise.resolve(undefined);
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: (data as { query: string }).query, provider: (data as { query: string }).query === 'hello' ? 'stepfun' : 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });

    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));
    const stepfunBtn = await screen.findByRole('button', { name: /Stepfun 按量/ });
    await waitFor(() => expect(stepfunBtn).toBeDisabled());
    fireEvent.click(stepfunBtn);

    expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa');
    expect(mockedSend).not.toHaveBeenCalledWith('setActiveSource', 'stepfun');
    await act(async () => {
      exaSwitch.resolve(undefined);
      await exaSwitch.promise;
    });

    await waitFor(() => expect(stepfunBtn).not.toBeDisabled());
    expect(screen.getByRole('button', { name: /Exa/ })).toHaveClass('active');
  });

  it('disables history while a provider switch is pending', async () => {
    const exaSwitch = deferred<void>();
    mockedSend.mockImplementation(((type: string, data: unknown) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'setActiveSource' && data === 'exa') return exaSwitch.promise;
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));
    expect(await screen.findByRole('button', { name: '历史' })).toBeDisabled();

    await act(async () => {
      exaSwitch.resolve(undefined);
      await exaSwitch.promise;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '历史' })).not.toBeDisabled());
  });

  it('clicking the active provider does not switch or search', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(await screen.findByRole('button', { name: /Tavily/ }));

    expect(mockedSend).not.toHaveBeenCalledWith('setActiveSource', expect.any(String));
    expect(mockedSend).not.toHaveBeenCalledWith('search', expect.objectContaining({ query: expect.any(String) }));
  });

  it('hides providers without configured keys', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: 'exa', activeSourceId: 'exa' });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'exa', results: [] }, cache: { hit: false } });
    }) as never);
    render(<App />);
    expect(await screen.findByRole('button', { name: /Exa/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tavily/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stepfun/ })).not.toBeInTheDocument();
  });

  it('shows no provider buttons when no provider is configured', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: [], activeProviderId: null, activeSourceId: 'google' });
      }
      return Promise.resolve({ ok: false, error: { kind: 'keyMissing', message: '需要 key' } });
    }) as never);
    render(<App />);
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('getProviderConfig', undefined));
    expect(screen.queryByRole('button', { name: /Tavily/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  });

  it('shows a no-results message when results array is empty', async () => {
    await doSearch({
      ok: true,
      cache: { hit: false },
      response: {
        query: 'q',
        provider: 'tavily',
        answer: { text: 'Ans', citations: [] },
        results: [],
      },
    });
    expect(await screen.findByText('无结果')).toBeInTheDocument();
  });

  it('shows an open-settings affordance on keyMissing', async () => {
    await doSearch({ ok: false, error: { kind: 'keyMissing', message: '需要 key' } });
    expect(await screen.findByText(/打开设置配置 API key/)).toBeInTheDocument();
    expect(screen.getByText('需要 key')).toBeInTheDocument();
  });

  it('shows cache metadata and refreshes with forceRefresh', async () => {
    await doSearch({
      ok: true,
      cache: { hit: true, entryId: 'cache-1', createdAt: Date.now() - 60_000 },
      response: {
        query: 'hello',
        provider: 'tavily',
        results: [{ title: 'Cached', url: 'https://cached.test', snippet: 'cached' }],
      },
    });

    expect(await screen.findByText(/来自 Tavily 本地缓存/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新搜索' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', { query: 'hello', forceRefresh: true, providerId: 'tavily' }));
  });

  it('selecting a history entry displays the cached response without searching', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'cache-1', cacheKey: 'exa:cached query', query: 'cached query', normalizedQuery: 'cached query', providerId: 'exa', createdAt: 1, lastAccessedAt: 1, answerPreview: 'cached answer', resultPreviews: [{ title: 'Cached result', url: 'https://cached.test' }], resultCount: 1 },
        ]);
      }
      if (type === 'getCachedSearchEntry') {
        return Promise.resolve({
          id: 'cache-1',
          cacheKey: 'exa:cached query',
          query: 'cached query',
          normalizedQuery: 'cached query',
          providerId: 'exa',
          createdAt: 1,
          lastAccessedAt: 1,
          response: { query: 'cached query', provider: 'exa', results: [{ title: 'Cached result', url: 'https://cached.test', snippet: 'cached snippet' }] },
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '历史' }));
    fireEvent.click((await screen.findByText('cached query')).closest('button') as HTMLButtonElement);

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('getCachedSearchEntry', 'cache-1'));
    expect(await screen.findByText('Cached result')).toBeInTheDocument();
    expect(screen.getByLabelText('搜索词')).toHaveValue('cached query');
    expect(mockedSend).not.toHaveBeenCalledWith('search', expect.anything());
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
  });

  it('selecting a history entry drops an in-flight search response', async () => {
    const pendingSearch = deferred<{ ok: true; response: { query: string; provider: 'tavily'; results: [{ title: string; url: string; snippet: string }] }; cache: { hit: false } }>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'search') return pendingSearch.promise;
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'cache-1', cacheKey: 'tavily:cached query', query: 'cached query', normalizedQuery: 'cached query', providerId: 'tavily', createdAt: 1, lastAccessedAt: 1, resultPreviews: [{ title: 'Cached result', url: 'https://cached.test' }], resultCount: 1 },
        ]);
      }
      if (type === 'getCachedSearchEntry') {
        return Promise.resolve({
          id: 'cache-1',
          cacheKey: 'tavily:cached query',
          query: 'cached query',
          normalizedQuery: 'cached query',
          providerId: 'tavily',
          createdAt: 1,
          lastAccessedAt: 1,
          response: { query: 'cached query', provider: 'tavily', results: [{ title: 'Cached result', url: 'https://cached.test', snippet: 'cached snippet' }] },
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);

    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'slow query' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    fireEvent.click(await screen.findByRole('button', { name: '历史' }));
    fireEvent.click((await screen.findByText('cached query')).closest('button') as HTMLButtonElement);

    await act(async () => {
      pendingSearch.resolve({ ok: true, response: { query: 'slow query', provider: 'tavily', results: [{ title: 'Stale result', url: 'https://stale.test', snippet: 'stale' }] }, cache: { hit: false } });
      await pendingSearch.promise;
    });

    expect(await screen.findByText('Cached result')).toBeInTheDocument();
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
  });

  it('disables refresh while a cached entry provider switch is pending', async () => {
    const switchPending = deferred<void>();
    mockedSend.mockImplementation(((type: string, data: unknown) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'getSearchCacheSummaries') {
        return Promise.resolve([
          { id: 'cache-1', cacheKey: 'exa:cached query', query: 'cached query', normalizedQuery: 'cached query', providerId: 'exa', createdAt: 1, lastAccessedAt: 1, resultPreviews: [{ title: 'Cached result', url: 'https://cached.test' }], resultCount: 1 },
        ]);
      }
      if (type === 'getCachedSearchEntry') {
        return Promise.resolve({
          id: 'cache-1',
          cacheKey: 'exa:cached query',
          query: 'cached query',
          normalizedQuery: 'cached query',
          providerId: 'exa',
          createdAt: 1,
          lastAccessedAt: 1,
          response: { query: 'cached query', provider: 'exa', results: [{ title: 'Cached result', url: 'https://cached.test', snippet: 'cached snippet' }] },
        });
      }
      if (type === 'setActiveSource' && data === 'exa') return switchPending.promise;
      return Promise.resolve({ ok: true, response: { query: 'cached query', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '历史' }));
    fireEvent.click((await screen.findByText('cached query')).closest('button') as HTMLButtonElement);

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('getCachedSearchEntry', 'cache-1'));
    expect(await screen.findByText('Cached result')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新搜索' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeDisabled();

    await act(async () => {
      switchPending.resolve(undefined);
      await switchPending.promise;
    });
    expect(await screen.findByRole('button', { name: '重新搜索' })).toBeInTheDocument();
  });

  it('shows the error message without settings affordance on providerError', async () => {
    await doSearch({
      ok: false,
      error: { kind: 'providerError', message: '无效 key', providerErrorKind: 'unauthorized' },
    });
    expect(await screen.findByText('无效 key')).toBeInTheDocument();
    expect(screen.queryByText(/打开设置/)).not.toBeInTheDocument();
  });

  it('clicking the topbar settings button opens the options page', async () => {
    render(<App />);
    const settingsBtn = await screen.findByRole('button', { name: '设置' });
    fireEvent.click(settingsBtn);
    await waitFor(() => expect(openOptionsPage).toHaveBeenCalled());
  });

  it('does not show language switching on the search page', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Tavily/ })).toHaveClass('active'));
    expect(screen.queryByRole('group', { name: '语言' })).not.toBeInTheDocument();
  });

  // ── v2 快切：常规搜索引擎 chip ───────────────────────────────────────────
  // location.assign / location.search 在 jsdom 下不可直接赋值，用 getter 拦截。
  function stubLocation(search = ''): { spy: ReturnType<typeof vi.fn>; restore: () => void } {
    const spy = vi.fn();
    const real = window.location;
    const fake = { ...real, assign: spy, search } as unknown as Location;
    Object.defineProperty(window, 'location', { configurable: true, value: fake, writable: true });
    return { spy, restore: () => Object.defineProperty(window, 'location', { configurable: true, value: real, writable: true }) };
  }

  it('renders engine chips alongside configured providers', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Tavily/ })).toHaveClass('active'));
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
  });

  it('renders chips in the configured non-default source order', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily',
          sourceOrder: ['bing', 'exa', 'google', 'tavily', 'baidu', 'stepfun', 'stepfun-plan'],
        });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    render(<App />);
    await screen.findByRole('button', { name: /Tavily/ });
    expect([...document.querySelectorAll('.source-switcher button')].map((button) => button.textContent))
      .toEqual(['Bing', 'Exa', 'Google', 'Tavily', 'Baidu']);
  });

  it('highlights the active engine chip from provider config', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'google' });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Google/ })).toHaveClass('active'));
  });

  it('manual search with an active engine navigates to Google without worker search', async () => {
    const { spy, restore } = stubLocation();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'google' });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    try {
      render(<App />);
      await screen.findByRole('button', { name: /Google/ });
      fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello world' } });
      fireEvent.click(screen.getByRole('button', { name: '搜索' }));
      expect(spy).toHaveBeenCalledWith('https://www.google.com/search?q=hello%20world');
      expect(mockedSend).not.toHaveBeenCalledWith('search', expect.anything());
    } finally {
      restore();
    }
  });

  it('bare mount with an active engine does not auto-navigate', async () => {
    const { spy, restore } = stubLocation();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'google' });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    try {
      render(<App />);
      await waitFor(() => expect(screen.getByRole('button', { name: /Google/ })).toHaveClass('active'));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('clicking an engine chip navigates the current tab to that SERP with the current query', async () => {
    const { spy, restore } = stubLocation();
    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello world' } });
      fireEvent.click(await screen.findByRole('button', { name: /Google/ }));
      await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'google'));
      expect(spy).toHaveBeenCalledWith('https://www.google.com/search?q=hello%20world');
    } finally {
      restore();
    }
  });

  it('clicking an engine chip with empty query navigates to the engine home', async () => {
    const { spy, restore } = stubLocation();
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Bing/ }));
      await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'bing'));
      expect(spy).toHaveBeenCalledWith('https://www.bing.com/');
    } finally {
      restore();
    }
  });

  it('engine chips remain even when no provider is configured', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: [], activeProviderId: null, activeSourceId: 'google' });
      }
      return Promise.resolve({ ok: false, error: { kind: 'keyMissing', message: '需要 key' } });
    }) as never);
    render(<App />);
    expect(await screen.findByRole('button', { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tavily/ })).not.toBeInTheDocument();
  });

  // ── v2 深链：search.html?provider=X&query=Y ──────────────────────────────
  it('reads provider + query from the URL and auto-searches on mount', async () => {
    const { restore } = stubLocation('?provider=exa&query=deep%20link');
    try {
      render(<App />);
      await waitFor(() =>
        expect(mockedSend).toHaveBeenCalledWith('search', { query: 'deep link', forceRefresh: undefined, providerId: 'exa' }),
      );
      expect(screen.getByLabelText('搜索词')).toHaveValue('deep link');
    } finally {
      restore();
    }
  });

  it('ignores a deep-link provider that is not configured', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      if (type === 'getSearchCacheSummaries') return Promise.resolve([]);
      return Promise.resolve({ ok: true, response: { query: 'x', provider: 'tavily', results: [] }, cache: { hit: false } });
    }) as never);
    const { restore } = stubLocation('?provider=exa&query=x');
    try {
      render(<App />);
      // 未配置 exa → 回退到 active tavily，用 query=x 搜
      await waitFor(() =>
        expect(mockedSend).toHaveBeenCalledWith('search', { query: 'x', forceRefresh: undefined, providerId: 'tavily' }),
      );
    } finally {
      restore();
    }
  });
});
