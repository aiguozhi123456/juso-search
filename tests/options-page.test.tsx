import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '@/entrypoints/options/App';
import { sendMessage } from '@/lib/messaging';
import { getActiveProviderId, setActiveProviderId, setKey, hasKey } from '@/lib/storage';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  getActiveProviderId: vi.fn(),
  setActiveProviderId: vi.fn(),
  setKey: vi.fn(),
  hasKey: vi.fn(),
}));
// 主题逻辑由 useTheme 单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
// i18n：返回中文文案，保持现有断言不变（key→value 与 _locales/zh_CN 一致）
vi.mock('@/lib/i18n', () => {
  const zh: Record<string, string> = {
    opts_title: 'AI Search · 设置',
    opts_active_engine: '激活的搜索引擎',
    opts_choose_placeholder: '选择…',
    opts_no_ai_answer: '（无 AI 答案）',
    opts_apikey_heading: 'API Key（BYOK，仅存本地）',
    opts_apikey_hint: 'key 只保存在本机 chrome.storage.local，仅由后台脚本发往所选 provider，不会上传第三方。',
    status_saved: '已保存',
    status_save_failed: '保存失败',
    status_validated: '验证通过',
    status_test_failed: '测试失败，请稍后重试',
    status_saving: '保存中…',
    status_testing: '测试中…',
    configured_badge: ' · 已配置',
    placeholder_new_key: '输入新 key 覆盖',
    placeholder_paste_key: '粘贴 API key',
    btn_save: '保存',
    btn_test: '测试',
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

const mockedSend = vi.mocked(sendMessage);
const mockedGetActive = vi.mocked(getActiveProviderId);
const mockedSetActive = vi.mocked(setActiveProviderId);
const mockedSetKey = vi.mocked(setKey);
const mockedHasKey = vi.mocked(hasKey);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetActive.mockResolvedValue(null);
  mockedSetActive.mockResolvedValue(undefined);
  mockedSetKey.mockResolvedValue(undefined);
  mockedHasKey.mockResolvedValue(false);
  mockedSend.mockResolvedValue({ ok: true } as never);
});

describe('options page', () => {
  it('saving a key calls setKey and marks configured', async () => {
    render(<App />);
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(mockedSetKey).toHaveBeenCalledWith('tavily', 'tvly-abc'));
    expect(await screen.findByText('已保存')).toBeInTheDocument();
  });

  it('selecting active provider writes active id', async () => {
    render(<App />);
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'exa' } });
    await waitFor(() => expect(mockedSetActive).toHaveBeenCalledWith('exa'));
  });

  it('test success shows 验证通过', async () => {
    mockedHasKey.mockResolvedValue(true); // 已配置才能测试
    mockedSend.mockResolvedValue({ ok: true } as never);
    render(<App />);
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]);
    expect(await screen.findByText('验证通过')).toBeInTheDocument();
  });

  it('test failure shows the error message', async () => {
    mockedHasKey.mockResolvedValue(true);
    mockedSend.mockResolvedValue({ ok: false, error: { kind: 'providerError', message: '无效 key' } } as never);
    render(<App />);
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]);
    expect(await screen.findByText('无效 key')).toBeInTheDocument();
  });

  it('masks the key input', async () => {
    render(<App />);
    expect(screen.getAllByPlaceholderText('粘贴 API key')[0]).toHaveAttribute('type', 'password');
  });
});
