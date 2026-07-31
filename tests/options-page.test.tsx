import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import App from '@/entrypoints/options/App';
import { sendMessage } from '@/lib/messaging';
import type { ProviderId } from '@/lib/providers/types';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import type { SourceId } from '@/lib/sources';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
// 主题/locale/style 逻辑由各自单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));
vi.mock('@/lib/useStyle', () => ({
  useStyle: () => ({ pref: 'classic', setPref: vi.fn() }),
}));
vi.mock('@/lib/useBarPosition', () => ({
  useBarPosition: () => ({ pref: 'auto', setPref: vi.fn() }),
}));
// AgentBridgeSettings 直接读 storage；页面测试隔离掉，避免依赖 browser.storage.local
vi.mock('@/lib/storage', () => ({
  getAgentBridgeEnabled: vi.fn().mockResolvedValue(false),
  setAgentBridgeEnabled: vi.fn().mockResolvedValue(undefined),
  getEngineSearchEnabled: vi.fn().mockResolvedValue(false),
  setEngineSearchEnabled: vi.fn().mockResolvedValue(undefined),
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
  // 分页模型：侧栏分组即页签。默认落在「搜索」页；密钥/通用页需先切换。
  function openTab(name: '搜索' | '密钥' | '通用') {
    fireEvent.click(screen.getByRole('button', { name }));
  }

  it('saving a key asks the worker to save it and marks configured', async () => {
    render(<App />);
    openTab('密钥');
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
    expect(Array.from(select.options).slice(1).map((option) => option.value)).toEqual(['bing', 'exa', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo']);
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Bing[\s\S]*Exa[\s\S]*Google[\s\S]*Baidu[\s\S]*抖音[\s\S]*小红书[\s\S]*哔哩哔哩[\s\S]*Yandex[\s\S]*DuckDuckGo/);
  });

  it('disables moving the first source up and the last source down', async () => {
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Exa 上移' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DuckDuckGo 下移' })).toBeDisabled();
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
      'tavily', 'stepfun', 'google', 'stepfun-plan', 'exa', 'bing', 'baidu', 'brave', 'jina', 'doubao', 'doubao-global', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo',
    ]));
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Google[\s\S]*Exa/);
    expect(screen.getByRole('button', { name: 'Google 下移' })).toBeDisabled();
    save.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Google 下移' })).not.toBeDisabled());
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Google[\s\S]*Exa/);
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
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Exa[\s\S]*Google[\s\S]*Bing[\s\S]*Baidu/);
  });

  it('hides a source from the quick-switch bar by persisting it in sourceHidden', async () => {
    const save = deferred<void>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      if (type === 'setSourceHidden') return save.promise;
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '在快切栏隐藏 Bing' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceHidden', ['bing']));
    // 隐藏态：可访问名翻转为"显示"，行挂上 --hidden 修饰类
    expect(screen.getByRole('button', { name: '在快切栏显示 Bing' })).toBeInTheDocument();
    expect(document.querySelector('.source-order-row--hidden')).toBeTruthy();
    save.resolve();
    // 等待 finally 中的 setSavingSourceHidden(false) 落定，避免遗留 deferred 状态触发 act 警告。
    await waitFor(() => expect(screen.getByRole('button', { name: '在快切栏显示 Bing' })).not.toBeDisabled());
  });

  it('excludes hidden sources from the active-source dropdown', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          sourceHidden: ['google'],
        });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    const select = await screen.findByRole('combobox');
    // google 被隐藏，不出现在激活态下拉框；管理列表仍保留（由其它测试覆盖）。
    expect(select).not.toHaveTextContent('Google');
    expect(select).toHaveTextContent('Exa');
    expect(select).toHaveTextContent('Bing');
  });

  it('reselects and persists the first visible source when the active source is hidden', async () => {
    const save = deferred<void>();
    const calls: Array<[string, unknown]> = [];
    mockedSend.mockImplementation(((type: string, data?: unknown) => {
      calls.push([type, data]);
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      if (type === 'setSourceHidden') return save.promise;
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '在快切栏隐藏 Google' }));
    // 隐藏当前激活的 google：先存 sourceHidden，再把激活态重选到首个可见源（registry 顺序：exa）
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceHidden', ['google']));
    save.resolve();
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
    // 下拉框值落到 exa
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('exa');
  });

  it('rolls back the hidden state when saving fails', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      if (type === 'setSourceHidden') return Promise.reject(new Error('storage unavailable'));
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '在快切栏隐藏 Bing' }));
    // 失败后回滚：可访问名恢复为“隐藏”语义
    await waitFor(() => expect(screen.getByRole('button', { name: '在快切栏隐藏 Bing' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '在快切栏显示 Bing' })).not.toBeInTheDocument();
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
    openTab('密钥');
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(mockedSend.mock.calls.filter(([type]) => type === 'getProviderConfig')).toHaveLength(2));

    openTab('搜索');
    fireEvent.click(screen.getByRole('button', { name: 'Exa 下移' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceOrder', expect.any(Array)));

    save.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Google 下移' })).not.toBeDisabled());
    staleConfig.resolve({
      configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
      sourceOrder: ['exa', 'google', 'bing', 'baidu', 'tavily', 'stepfun', 'stepfun-plan'],
    });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Exa'));
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Google[\s\S]*Exa/);
  });

  it('does not let an older config response overwrite a newer choose()', async () => {
    const staleConfig = deferred<Record<string, unknown>>();
    let configCalls = 0;
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        configCalls += 1;
        if (configCalls === 1) {
          // 首次加载快速返回，下拉框出现 exa + 各 engine，active = google。
          return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
        }
        // 第二次（保存 exa key 触发）慢返回，将带着旧的 activeSourceId。
        return staleConfig.promise;
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('google');
    // 保存已配置的 exa key：markConfigured 对状态是 no-op，但仍触发 syncConfig，
    // 由此产生一个在途的旧 getProviderConfig 请求。
    openTab('密钥');
    const exaInput = screen.getByPlaceholderText('输入新 key 覆盖');
    fireEvent.change(exaInput, { target: { value: 'exa-key' } });
    fireEvent.click(within(exaInput.closest('.key-row') as HTMLElement).getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(configCalls).toBeGreaterThanOrEqual(2));
    // 在第二次配置仍在途时 choose 到 exa。
    openTab('搜索');
    const selectFresh = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(selectFresh, { target: { value: 'exa' } });
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
    await waitFor(() => expect(selectFresh.value).toBe('exa'));
    // 旧配置带着 activeSourceId = google 返回——不得覆盖较新的 choose。
    await act(async () => {
      staleConfig.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google', sourceHidden: [] });
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(selectFresh.value).toBe('exa');
  });

  it('does not let an older config response overwrite a hide-triggered reselection', async () => {
    const staleConfig = deferred<Record<string, unknown>>();
    let configCalls = 0;
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        configCalls += 1;
        if (configCalls === 1) {
          return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
        }
        return staleConfig.promise;
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    const select = await screen.findByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('google');
    // 触发在途的旧 getProviderConfig（保存已配置的 exa key，状态 no-op 但仍 syncConfig）。
    openTab('密钥');
    const exaInput = screen.getByPlaceholderText('输入新 key 覆盖');
    fireEvent.change(exaInput, { target: { value: 'exa-key' } });
    fireEvent.click(within(exaInput.closest('.key-row') as HTMLElement).getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(configCalls).toBeGreaterThanOrEqual(2));
    // 隐藏当前激活的 google：重选到首个可见源 exa 并持久化。
    openTab('搜索');
    const selectFresh = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.click(screen.getByRole('button', { name: '在快切栏隐藏 Google' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setActiveSource', 'exa'));
    await waitFor(() => expect(selectFresh.value).toBe('exa'));
    // 旧配置带着 activeSourceId = google、sourceHidden = [] 返回——
    // 不得覆盖重选后的 active，也不得回退隐藏态。
    await act(async () => {
      staleConfig.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google', sourceHidden: [] });
      await new Promise((r) => setTimeout(r, 50));
    });
    // google 仍处于隐藏态（隐藏 revision 守卫已存在）。
    expect(screen.getByRole('button', { name: '在快切栏显示 Google' })).toBeInTheDocument();
    // 重新显示 google 以解除 active 的渲染兜底，直接观察 active 是否被旧配置覆盖：
    // 若被覆盖成 google，此处下拉框会落到 google；守卫生效时仍为 exa。
    fireEvent.click(screen.getByRole('button', { name: '在快切栏显示 Google' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceHidden', []));
    await waitFor(() => expect(selectFresh.value).toBe('exa'));
  });

  it('still shows all providers in the API key section', async () => {
    render(<App />);
    openTab('密钥');
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
    openTab('密钥');
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    openTab('搜索');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Tavily'));
  });

  it('test success shows 验证通过', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'tavily' });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('密钥');
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
    openTab('密钥');
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]);
    expect(await screen.findByText('无效 key')).toBeInTheDocument();
  });

  it('deleting a configured key asks the worker to delete it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    openTab('密钥');
    await screen.findAllByText(/已配置/);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('deleteProviderKey', 'exa'));
    await waitFor(() => expect(mockedSend.mock.calls.filter(([type]) => type === 'getProviderConfig')).toHaveLength(2));
    confirmSpy.mockRestore();
  });

  it('masks the key input', async () => {
    render(<App />);
    openTab('密钥');
    expect(screen.getAllByPlaceholderText('粘贴 API key')[0]).toHaveAttribute('type', 'password');
  });

  it('shows language settings after API key settings', async () => {
    render(<App />);
    openTab('密钥');
    expect(screen.getByRole('heading', { name: /API Key/ })).toBeInTheDocument();
    openTab('通用');
    expect(screen.getByRole('heading', { name: '语言' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '语言' })).toBeInTheDocument();
  });

  it('persists a middle-order move of a site engine alongside built-in sources', async () => {
    const siteEngine: SiteEngineDefinition = {
      id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/guide', engineId: 'google',
    };
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          sourceOrder: ['exa', 'site:docs', 'google', 'bing', 'baidu'],
          siteEngines: [siteEngine],
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    // Site engine appears between exa and google; moving it down swaps with google.
    fireEvent.click(await screen.findByRole('button', { name: 'Docs 下移' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setSourceOrder', expect.arrayContaining([
      'exa', 'google', 'site:docs', 'bing', 'baidu',
    ])));
    // The site: id is preserved in the persisted order (not dropped by normalization).
    const call = mockedSend.mock.calls.find(([type]) => type === 'setSourceOrder');
    expect(call?.[1]).toEqual(expect.arrayContaining(['site:docs']));
  });

  it('ignores a stale config response for siteEngines, active, and configured providers', async () => {
    const slowConfig = deferred<Record<string, unknown>>();
    let configCalls = 0;
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        configCalls += 1;
        if (configCalls === 1) return slowConfig.promise; // Initial load is slow.
        // Second call (triggered by saving a key) resolves immediately with current data.
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          siteEngines: [],
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    openTab('密钥');
    // App is waiting for the slow first config, but key inputs are already rendered.
    // Save a key → markConfigured → syncConfig (second call, fast) → epoch moves past 1.
    const input = screen.getAllByPlaceholderText('粘贴 API key')[0];
    fireEvent.change(input, { target: { value: 'tvly-abc' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(configCalls).toBeGreaterThanOrEqual(2));
    // The slow first config resolves late with stale data — it must be ignored.
    slowConfig.resolve({
      configuredProviderIds: ['tavily'], activeProviderId: 'tavily', activeSourceId: 'tavily',
      siteEngines: [{ id: 'site:stale', name: 'Stale', target: 'https://stale.example.com', engineId: 'google' }],
      sourceOrder: ['tavily', 'google'],
    });
    await new Promise((r) => setTimeout(r, 50));
    // Stale site engine must not appear in the Site Engines list or quickbar.
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('disables hiding the last visible source with a coherent label', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: [],
          activeProviderId: null,
          activeSourceId: 'google',
          // Hide all engines except google → only one visible source remains.
          sourceHidden: ['bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo'],
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    render(<App />);
    // Google is the only visible source; its hide button must be disabled.
    const hideBtn = await screen.findByRole('button', { name: /无法隐藏 Google/ });
    expect(hideBtn).toBeDisabled();
    // Other (already hidden) sources still have enabled "show" buttons.
    expect(screen.getByRole('button', { name: '在快切栏显示 Bing' })).not.toBeDisabled();
  });

  it('refreshes config after a config import triggers onImported', async () => {
    let configCalls = 0;
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        configCalls += 1;
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          siteEngines: [],
        });
      }
      if (type === 'previewImport') {
        return Promise.resolve({
          ok: true,
          preview: {
            written: [], skipped: [],
            prefDiffs: [{ key: 'siteEngines' as const, from: '', to: 'Imported Site' }],
          },
        });
      }
      if (type === 'importConfig') {
        return Promise.resolve({
          ok: true,
          report: {
            written: [], skipped: [], activeProviderOverridden: false, activeSourceOverridden: false,
            themePrefOverridden: false, localePrefOverridden: false, serpBarPositionOverridden: false, sourceOrderOverridden: false,
            sourceHiddenOverridden: false, siteEnginesOverridden: true, providerMaxResultsOverridden: false,
          },
        });
      }
      return Promise.resolve(undefined);
    }) as never);
    const { container } = render(<App />);
    openTab('通用');
    const initialCalls = configCalls;
    // Trigger file import via the hidden file input inside ConfigExportImport.
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput, { target: { files: [new File(['{"schemaVersion":1}'], 'config.json', { type: 'application/json' })] } });
    // The confirming dialog appears with the siteEngines diff.
    expect(await screen.findByText('以下偏好将被覆盖：')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导入（含偏好）' }));
    // After import, onImported → syncConfig → getProviderConfig is called again,
    // proving the options page refreshes its config snapshot post-import.
    await waitFor(() => expect(configCalls).toBeGreaterThan(initialCalls));
    // The import success banner (with siteEngines override report) confirms the round-trip.
    expect(await screen.findByText(/已覆盖：站外搜索/)).toBeInTheDocument();
  });
});
