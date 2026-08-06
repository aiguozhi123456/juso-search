import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import App from '@/entrypoints/options/App';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import type { SiteEngineDefinition } from '@/lib/site-engines';

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

  it('uses the saved source order for the select and pinyin-sorts the quick-switch list', async () => {
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
    // 激活态下拉框仍按 sourceOrder（visibleSources 未排序）。
    expect(Array.from(select.options).slice(1).map((option) => option.value)).toEqual(['bing', 'exa', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', 'ai:grok', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao', 'ai:gemini']);
    // 快切栏管理列表按拼音排序展示（中文与拉丁文按拼写交错，不随 sourceOrder）。
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Baidu[\s\S]*哔哩哔哩[\s\S]*Bing[\s\S]*ChatGPT[\s\S]*DeepSeek[\s\S]*豆包[\s\S]*抖音[\s\S]*DuckDuckGo[\s\S]*Exa[\s\S]*Gemini[\s\S]*Google[\s\S]*Grok[\s\S]*小红书[\s\S]*Yandex/);
  });

  it('quickbar list has no reorder buttons (ordering moved to the source layout editor)', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '在快切栏隐藏 Exa' });
    const quickbar = screen.getByRole('heading', { name: '快切栏' }).parentElement as HTMLElement;
    expect(within(quickbar).queryByRole('button', { name: /上移|下移/ })).toBeNull();
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
    // App 挂载(1) + ProviderInstanceManager 挂载(2) + 删除后刷新(3)
    await waitFor(() => expect(mockedSend.mock.calls.filter(([type]) => type === 'getProviderConfig')).toHaveLength(3));
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

  it('renders a site engine in its pinyin-sorted position in the quickbar list', async () => {
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
    // Site engine appears in its pinyin-sorted position (Docs → "docs" 排在 Exa 之前、Google 之前)，
    // 不再随 sourceOrder；列表无移动按钮（排序集中在「来源布局」编辑器）。
    await screen.findByRole('button', { name: '在快切栏隐藏 Docs' });
    expect(screen.getByRole('heading', { name: '快切栏' }).parentElement).toHaveTextContent(/Docs[\s\S]*Exa[\s\S]*Google/);
    // 排序集中在「来源布局」编辑器：快切栏列表不应出现任何移动按钮。
    const quickbar = screen.getByRole('heading', { name: '快切栏' }).parentElement as HTMLElement;
    expect(within(quickbar).queryByRole('button', { name: /上移|下移/ })).toBeNull();
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
          // AI engines default hidden (schema v6→v7)，测试未跑迁移，需显式加入 sourceHidden。
          sourceHidden: ['bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', 'ai:grok', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao', 'ai:gemini'],
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

  it('renders the provider instance manager in the keys tab with an empty state', async () => {
    render(<App />);
    openTab('密钥');
    expect(screen.getByRole('heading', { name: 'Provider 实例' })).toBeInTheDocument();
    expect(screen.getByText('还没有实例。新增一个即可为 provider 创建调好参数的预设。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增实例' })).toBeInTheDocument();
  });

  it('creates a provider instance via the createProviderInstance message', async () => {
    render(<App />);
    openTab('密钥');
    const addBtn = await screen.findByRole('button', { name: '新增实例' });
    await waitFor(() => expect(addBtn).not.toBeDisabled());
    fireEvent.click(addBtn);
    // 默认 base provider 取已配置的 exa，Exa 参数表单随之出现
    expect(screen.getByLabelText('底层 Provider')).toHaveValue('exa');
    expect(screen.getByText('搜索类型')).toBeInTheDocument();
    expect(screen.getByText('内容类别')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('如「AI 研究」'), { target: { value: 'AI 研究' } });
    const section = screen.getByRole('heading', { name: 'Provider 实例' }).closest('section') as HTMLElement;
    fireEvent.click(within(section).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('createProviderInstance', {
        baseProviderId: 'exa',
        name: 'AI 研究',
        options: expect.objectContaining({ searchType: 'auto', category: '', includeDomains: [], excludeDomains: [] }),
      }),
    );
  });

  it('disables add-instance and hints when no configured provider supports instance options', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        // Tavily is configured but has no per-instance options form (Phase 1: only Exa).
        return Promise.resolve({ configuredProviderIds: ['tavily'], activeProviderId: null, activeSourceId: 'google' });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('密钥');
    const addBtn = await screen.findByRole('button', { name: '新增实例' });
    // No instanceable provider → button stays disabled and a dedicated hint shows.
    expect(addBtn).toBeDisabled();
    expect(screen.getByText('暂无已配置的 provider 支持自定义实例。')).toBeInTheDocument();
    // The create form (and its base-provider dropdown) never opens.
    expect(screen.queryByLabelText('底层 Provider')).not.toBeInTheDocument();
  });

  it('lists only instance-option-supporting providers in the base-provider dropdown', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        // Both Tavily and Exa configured; only Exa supports per-instance options.
        return Promise.resolve({ configuredProviderIds: ['tavily', 'exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('密钥');
    const addBtn = await screen.findByRole('button', { name: '新增实例' });
    await waitFor(() => expect(addBtn).not.toBeDisabled());
    fireEvent.click(addBtn);
    const baseSelect = screen.getByLabelText('底层 Provider') as HTMLSelectElement;
    // Exa is offered; Tavily (no options form) is filtered out.
    expect(Array.from(baseSelect.options).map((o) => o.value)).toEqual(['exa']);
    expect(baseSelect).toHaveValue('exa');
    // Exa options form appears for the only instanceable provider.
    expect(screen.getByText('搜索类型')).toBeInTheDocument();
  });

  it('edits a provider instance via the updateProviderInstance message', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          providerInstances: [{
            id: 'inst:exa:abc123', baseProviderId: 'exa', name: 'AI 研究',
            options: { searchType: 'auto', category: 'publication', numResults: 5, includeDomains: [], excludeDomains: [], textMaxCharacters: null, highlightsMaxCharacters: null },
          }],
        });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('密钥');
    await screen.findByText('AI 研究');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    // 编辑时预填名称与 Exa 参数（category 从实例 options 恢复）
    expect((screen.getByPlaceholderText('如「AI 研究」') as HTMLInputElement).value).toBe('AI 研究');
    expect(screen.getByText('学术文献')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('如「AI 研究」'), { target: { value: '创业资讯' } });
    const section = screen.getByRole('heading', { name: 'Provider 实例' }).closest('section') as HTMLElement;
    fireEvent.click(within(section).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('updateProviderInstance', {
        id: 'inst:exa:abc123',
        patch: {
          name: '创业资讯',
          options: expect.objectContaining({ searchType: 'auto', category: 'publication' }),
        },
      }),
    );
  });

  it('deletes a provider instance after inline confirmation', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          providerInstances: [
            { id: 'inst:exa:abc123', baseProviderId: 'exa', name: 'AI 研究', options: {} },
            // 第二个实例使删除不命中「独苗保护」（否则删除按钮会被禁用）。
            { id: 'inst:exa:def456', baseProviderId: 'exa', name: 'AI 研究 2', options: {} },
          ],
        });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('密钥');
    await screen.findByText('AI 研究');
    const row = screen.getByText('AI 研究').closest('.provider-instance-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    // 行内确认：出现确认文案，再点一次「删除」真正提交
    expect(await screen.findByText('确定删除实例「AI 研究」吗？')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('deleteProviderInstance', 'inst:exa:abc123'));
  });

  it('disables the delete button for the sole instance of a provider', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({
          configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google',
          providerInstances: [{
            id: 'inst:exa:abc123', baseProviderId: 'exa', name: 'AI 研究', options: {},
          }],
        });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('密钥');
    await screen.findByText('AI 研究');
    const row = screen.getByText('AI 研究').closest('.provider-instance-row') as HTMLElement;
    // 独苗实例不可删：删除按钮禁用，且带解释 tooltip。
    const deleteBtn = within(row).getByRole('button', { name: '删除' });
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute('title', t(MSG.opts_instance_cannot_delete_default));
    // 点击被禁用按钮不会进入行内确认态。
    fireEvent.click(deleteBtn);
    expect(screen.queryByText(t(MSG.opts_instance_delete_confirm, 'AI 研究'))).not.toBeInTheDocument();
    // 编辑仍可用。
    expect(within(row).getByRole('button', { name: '编辑' })).not.toBeDisabled();
  });

  it('renders the companion Agent Skill download button in the agent-bridge section', async () => {
    render(<App />);
    openTab('通用');
    expect(screen.getByRole('heading', { name: '配套 Agent Skill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载 Agent Skill' })).toBeInTheDocument();
  });

  it('downloads the Agent Skill via packageAgentSkill and shows success status', async () => {
    render(<App />);
    openTab('通用');
    fireEvent.click(screen.getByRole('button', { name: '下载 Agent Skill' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('packageAgentSkill', undefined));
    expect(await screen.findByText('已开始下载')).toBeInTheDocument();
  });

  it('shows the failure status with the worker error when packaging fails', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      if (type === 'packageAgentSkill') {
        return Promise.resolve({ ok: false, error: 'boom' });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('通用');
    fireEvent.click(screen.getByRole('button', { name: '下载 Agent Skill' }));
    expect(await screen.findByText('下载失败：boom')).toBeInTheDocument();
  });

  it('disables the download button while packaging is in flight', async () => {
    const pending = deferred<void>();
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'getProviderConfig') {
        return Promise.resolve({ configuredProviderIds: ['exa'], activeProviderId: null, activeSourceId: 'google' });
      }
      if (type === 'packageAgentSkill') return pending.promise.then(() => ({ ok: true }));
      return Promise.resolve({ ok: true });
    }) as never);
    render(<App />);
    openTab('通用');
    fireEvent.click(screen.getByRole('button', { name: '下载 Agent Skill' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('packageAgentSkill', undefined));
    // 在途：按钮禁用，状态行显示下载中文案。
    expect(screen.getByRole('button', { name: '下载 Agent Skill' })).toBeDisabled();
    expect(screen.getByText('正在下载…')).toBeInTheDocument();
    // 完成：按钮恢复，成功文案出现。等待 pending 收尾避免遗留 deferred 触发 act 警告。
    await act(async () => {
      pending.resolve();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText('已开始下载')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载 Agent Skill' })).not.toBeDisabled();
  });
});
