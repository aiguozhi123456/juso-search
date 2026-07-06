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
// 主题/locale 逻辑由 useTheme/useLocale 单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));

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

  it('shows language settings after API key settings', () => {
    render(<App />);
    const apiKeyHeading = screen.getByRole('heading', { name: /API Key/ });
    const languageHeading = screen.getByRole('heading', { name: '语言' });
    expect(screen.getByRole('group', { name: '语言' })).toBeInTheDocument();
    expect(apiKeyHeading.compareDocumentPosition(languageHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
