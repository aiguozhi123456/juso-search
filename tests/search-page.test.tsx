import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '@/entrypoints/search/App';
import { sendMessage } from '@/lib/messaging';
import { getActiveProviderId, setActiveProviderId } from '@/lib/storage';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  getActiveProviderId: vi.fn(),
  setActiveProviderId: vi.fn(),
}));
// 主题逻辑由 useTheme 单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
// i18n：返回中文文案，保持现有断言不变（key→value 与 _locales/zh_CN 一致）
vi.mock('@/lib/i18n', () => {
  const zh: Record<string, string> = {
    search_page_title: 'AI Search',
    search_placeholder: '输入搜索词…',
    search_aria: '搜索词',
    btn_search: '搜索',
    btn_searching: '搜索中…',
    state_loading: '搜索中…',
    no_results: '无结果',
    open_settings_cta: '打开设置配置 API key',
    search_failed_retry: '搜索失败，请稍后重试',
    provider_tavily: 'Tavily',
    provider_exa: 'Exa',
    provider_stepfun: 'Stepfun 按量',
    provider_stepfun_plan: 'Stepfun Step Plan',
  };
  return {
    t: (name: string) => zh[name] ?? name,
    getUILanguage: () => 'zh_CN',
    MSG: new Proxy({}, { get: (_t, prop) => prop }),
  };
});
vi.stubGlobal('browser', { runtime: { openOptionsPage: vi.fn() } });

const mockedSend = vi.mocked(sendMessage);
const mockedGetActive = vi.mocked(getActiveProviderId);
const mockedSetActive = vi.mocked(setActiveProviderId);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetActive.mockResolvedValue('tavily');
  mockedSetActive.mockResolvedValue(undefined);
});

async function doSearch(reply: unknown) {
  mockedSend.mockResolvedValue(reply as never);
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
});
