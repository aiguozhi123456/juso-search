import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '@/entrypoints/options/App';
import { sendMessage } from '@/lib/messaging';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
// 主题/locale 逻辑由 useTheme/useLocale 单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));

const mockedSend = vi.mocked(sendMessage);

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockImplementation(((type: string) => {
    if (type === 'getProviderConfig') {
      return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
    }
    return Promise.resolve({ ok: true });
  }) as never);
});

describe('options page', () => {
  it('saving a key asks the worker to save it and marks configured', async () => {
    render(<App />);
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('saveProviderKey', { providerId: 'tavily', key: 'tvly-abc' }));
    expect(await screen.findByText('已保存')).toBeInTheDocument();
  });

  it('selecting active provider writes active source id', async () => {
    render(<App />);
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'exa' } });
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
  });

  it('selecting an engine writes active source id', async () => {
    render(<App />);
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'google' } });
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'google'));
  });

  it('shows configured providers and engines in the active-source select', async () => {
    render(<App />);
    const select = await screen.findByRole('combobox');
    expect(select).toHaveTextContent('Exa');
    expect(select).toHaveTextContent('Google');
    expect(select).toHaveTextContent('Bing');
    expect(select).not.toHaveTextContent('Tavily');
    expect(select).not.toHaveTextContent('Stepfun');
  });

  it('still shows all providers in the API key section', async () => {
    render(<App />);
    await screen.findByRole('combobox');
    const keySection = screen.getByRole('heading', { name: /API Key/ }).closest('section');
    expect(keySection).not.toBeNull();
    const keyScope = within(keySection as HTMLElement);
    expect(keyScope.getByText('Tavily')).toBeInTheDocument();
    expect(keyScope.getByText('Exa')).toBeInTheDocument();
    expect(keyScope.getByText('Stepfun 按量')).toBeInTheDocument();
    expect(keyScope.getByText('Stepfun Step Plan')).toBeInTheDocument();
  });

  it('adds a provider to the active-source select after saving its key', async () => {
    let configCalls = 0;
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        configCalls += 1;
        return Promise.resolve(
          configCalls === 1
            ? { configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' }
            : { configuredProviderIds: ['tavily', 'exa'], activeProviderId: 'tavily', activeSourceId: 'tavily' },
        );
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    const select = await screen.findByRole('combobox');
    expect(select).not.toHaveTextContent('Tavily');
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(select).toHaveTextContent('Tavily'));
  });

  it('test success shows 验证通过', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]);
    expect(await screen.findByText('验证通过')).toBeInTheDocument();
  });

  it('test failure shows the error message', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      return Promise.resolve({ ok: false, error: { kind: 'providerError', message: '无效 key' } });
    }) as never);
    render(<App />);
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]);
    expect(await screen.findByText('无效 key')).toBeInTheDocument();
  });

  it('deleting a configured key asks the worker to delete it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('deleteProviderKey', 'exa'));
    await waitFor(() => expect(mockedSend.mock.calls.filter(([type]) => type === 'getProviderConfig')).toHaveLength(2));
    confirmSpy.mockRestore();
  });

  it('masks the key input', async () => {
    render(<App />);
    await screen.findByRole('combobox');
    expect(screen.getAllByPlaceholderText('粘贴 API key')[0]).toHaveAttribute('type', 'password');
  });

  it('shows language settings after API key settings', async () => {
    render(<App />);
    await screen.findByRole('combobox');
    const apiKeyHeading = screen.getByRole('heading', { name: /API Key/ });
    const languageHeading = screen.getByRole('heading', { name: '语言' });
    expect(screen.getByRole('group', { name: '语言' })).toBeInTheDocument();
    expect(apiKeyHeading.compareDocumentPosition(languageHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
