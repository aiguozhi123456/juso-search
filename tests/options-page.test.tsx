import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '@/entrypoints/options/App';
import { sendMessage } from '@/lib/messaging';
import type { ProviderId } from '@/lib/providers/types';
import type { SourceId } from '@/lib/sources';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
// 主题/locale 逻辑由 useTheme/useLocale 单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));

const mockedSend = vi.mocked(sendMessage);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
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

  it('uses the saved non-default source order for the select and quick-switch list', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          sourceOrder: ['bing', 'exa', 'google', 'tavily', 'stepfun', 'stepfun-plan', 'baidu'],
        });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).slice(1).map((option) => option.value)).toEqual(['bing', 'exa', 'google', 'baidu']);
    expect(screen.getByRole('heading', { name: '快切栏顺序' }).parentElement).toHaveTextContent(/Bing[\s\S]*Exa[\s\S]*Google[\s\S]*Baidu/);
  });

  it('disables moving the first source up and the last source down', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Exa 上移' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Baidu 下移' })).toBeDisabled();
  });

  it('moves adjacent visible sources in the complete stored order', async () => {
    const save = deferred<void>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          sourceOrder: ['tavily', 'stepfun', 'exa', 'stepfun-plan', 'google', 'bing', 'baidu'],
        });
      }
      if (type === 'setSourceOrder') return save.promise;
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Exa 下移' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceOrder', [
      'tavily', 'stepfun', 'google', 'stepfun-plan', 'exa', 'bing', 'baidu',
    ]));
    expect(screen.getByRole('heading', { name: '快切栏顺序' }).parentElement).toHaveTextContent(/Google[\s\S]*Exa/);
    expect(screen.getByRole('button', { name: 'Google 下移' })).toBeDisabled();
    save.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Google 下移' })).not.toBeDisabled());
    expect(screen.getByRole('heading', { name: '快切栏顺序' }).parentElement).toHaveTextContent(/Google[\s\S]*Exa/);
  });

  it('rolls back the order and shows an error when saving fails', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      if (type === 'setSourceOrder') return Promise.reject(new Error('storage unavailable'));
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Exa 下移' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('顺序保存失败，已回滚');
    expect(screen.getByRole('heading', { name: '快切栏顺序' }).parentElement).toHaveTextContent(/Exa[\s\S]*Google[\s\S]*Bing[\s\S]*Baidu/);
  });

  it('does not let an older config response undo a successful source order move', async () => {
    const staleConfig = deferred<{ configuredProviderIds: ProviderId[]; activeProviderId: null; activeSourceId: SourceId; sourceOrder: SourceId[] }>();
    const save = deferred<void>();
    let configCalls = 0;
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        configCalls += 1;
        if (configCalls === 1) {
          return Promise.resolve({
            configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
            sourceOrder: ['exa', 'google', 'bing', 'baidu', 'tavily', 'stepfun', 'stepfun-plan'],
          });
        }
        return staleConfig.promise;
      }
      if (type === 'setSourceOrder') return save.promise;
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);

    await screen.findByRole('button', { name: 'Exa 下移' });
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(mockedSend.mock.calls.filter(([type]) => type === 'getProviderConfig')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Exa 下移' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceOrder', expect.any(Array)));

    save.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Google 下移' })).not.toBeDisabled());
    staleConfig.resolve({
      configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
      sourceOrder: ['exa', 'google', 'bing', 'baidu', 'tavily', 'stepfun', 'stepfun-plan'],
    });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Exa'));
    expect(screen.getByRole('heading', { name: '快切栏顺序' }).parentElement).toHaveTextContent(/Google[\s\S]*Exa/);
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
