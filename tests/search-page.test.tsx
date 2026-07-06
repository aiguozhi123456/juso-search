import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
vi.stubGlobal('browser', { runtime: { openOptionsPage } });

const mockedSend = vi.mocked(sendMessage);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily' });
    }
    return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] } });
  }) as never);
});

async function doSearch(reply: unknown) {
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily' });
    }
    return Promise.resolve(reply);
  }) as never);
  render(<App />);
  fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', 'hello'));
}

describe('search page', () => {
  it('renders the answer card when the reply has an answer', async () => {
    await doSearch({
      ok: true,
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
      response: {
        query: 'q',
        provider: 'stepfun',
        results: [{ title: 'R', url: 'https://r.com', snippet: 'snippet R' }],
      },
    });
    expect(await screen.findByText('R')).toBeInTheDocument();
    expect(screen.queryByText('AI 回答')).not.toBeInTheDocument();
  });

  it('switching provider writes active provider id', async () => {
    render(<App />);
    const exaBtn = await screen.findByRole('button', { name: /Exa/ });
    fireEvent.click(exaBtn);
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveProvider', 'exa'));
  });

  it('switching provider searches with the current input value', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', 'hello'));

    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'world' } });
    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveProvider', 'exa'));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('search', 'world'));
  });

  it('switching provider with an empty input does not search', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveProvider', 'exa'));
    expect(mockedSend).not.toHaveBeenCalledWith('search', expect.any(String));
  });

  it('disables provider switching while search is loading', async () => {
    const pendingSearch = deferred<{ ok: true; response: { query: string; provider: 'tavily'; results: [] } }>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily' });
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

    expect(mockedSend).not.toHaveBeenCalledWith('setActiveProvider', 'exa');
    await act(async () => {
      pendingSearch.resolve({ ok: true, response: { query: 'hello', provider: 'tavily', results: [] } });
      await pendingSearch.promise;
    });
  });

  it('interrupting a search drops the stale response and re-enables provider switching', async () => {
    const pendingSearch = deferred<{ ok: true; response: { query: string; provider: 'tavily'; results: [{ title: string; url: string; snippet: string }] } }>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily' });
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
      pendingSearch.resolve({ ok: true, response: { query: 'hello', provider: 'tavily', results: [{ title: 'Stale', url: 'https://stale.test', snippet: 'stale' }] } });
      await pendingSearch.promise;
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: '打断' })).not.toBeInTheDocument());
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('disables provider switching while a provider switch is pending', async () => {
    const exaSwitch = deferred<void>();
    mockedSend.mockImplementation(((type: string, data: unknown) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa', 'stepfun'], activeProviderId: 'tavily' });
      }
      if (type === 'setActiveProvider' && data === 'exa') return exaSwitch.promise;
      if (type === 'setActiveProvider') return Promise.resolve(undefined);
      return Promise.resolve({ ok: true, response: { query: data, provider: data === 'hello' ? 'stepfun' : 'tavily', results: [] } });
    }) as never);
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });

    fireEvent.click(await screen.findByRole('button', { name: /Exa/ }));
    const stepfunBtn = await screen.findByRole('button', { name: /Stepfun 按量/ });
    await waitFor(() => expect(stepfunBtn).toBeDisabled());
    fireEvent.click(stepfunBtn);

    expect(mockedSend).toHaveBeenCalledWith('setActiveProvider', 'exa');
    expect(mockedSend).not.toHaveBeenCalledWith('setActiveProvider', 'stepfun');
    await act(async () => {
      exaSwitch.resolve(undefined);
      await exaSwitch.promise;
    });

    await waitFor(() => expect(stepfunBtn).not.toBeDisabled());
    expect(screen.getByRole('button', { name: /Exa/ })).toHaveClass('active');
  });

  it('clicking the active provider does not switch or search', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('搜索词'), { target: { value: 'hello' } });
    fireEvent.click(await screen.findByRole('button', { name: /Tavily/ }));

    expect(mockedSend).not.toHaveBeenCalledWith('setActiveProvider', expect.any(String));
    expect(mockedSend).not.toHaveBeenCalledWith('search', expect.any(String));
  });

  it('hides providers without configured keys', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: 'exa' });
      }
      return Promise.resolve({ ok: true, response: { query: 'q', provider: 'exa', results: [] } });
    }) as never);
    render(<App />);
    expect(await screen.findByRole('button', { name: /Exa/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tavily/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stepfun/ })).not.toBeInTheDocument();
  });

  it('shows no provider buttons when no provider is configured', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: [], activeProviderId: null });
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
});
