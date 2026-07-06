import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '@/entrypoints/search/App';
import { sendMessage } from '@/lib/messaging';
import { setActiveProviderId } from '@/lib/storage';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  setActiveProviderId: vi.fn(),
}));
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
const mockedSetActive = vi.mocked(setActiveProviderId);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily' });
    }
    return Promise.resolve({ ok: true, response: { query: 'q', provider: 'tavily', results: [] } });
  }) as never);
  mockedSetActive.mockResolvedValue(undefined);
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
    await waitFor(() => expect(mockedSetActive).toHaveBeenCalledWith('exa'));
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
