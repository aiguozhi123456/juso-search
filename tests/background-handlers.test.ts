// buildSafeSearchUrl 是 openSearchPage handler 唯一的入参净化点。
// 这层测试锁死其安全不变量：无论入参是什么，产出永远是扩展内 /search.html 为 base、
// 仅含 provider/query 白名单参数的绝对 URL——路径层防 open-redirect、参数层防注入无关键。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildSafeSearchUrl } from '@/lib/search-page-url';

const EXT_ORIGIN = 'chrome-extension://fake-id';

// background.ts 的 handler 都包在 defineBackground 闭包里（WXT 自动导入，vitest 不可直接 import）。
// 这里 mock messaging/gateway，stub defineBackground 立即执行回调，动态 import 后断言
// setAiAutoEnter 的注册与委托（对齐 agent-bridge-gating.test.ts 的「复制逻辑」模式）。
const mockedHandleSetAiAutoEnter = vi.fn().mockResolvedValue(undefined);
const mockedHandleSetFlatLayoutFewSources = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/messaging', () => ({ onMessage: vi.fn() }));

vi.mock('@/lib/gateway', () => ({
  handleAiInjectAllowed: vi.fn(),
  handleClearSearchCache: vi.fn(),
  handleDeleteCachedSearch: vi.fn(),
  handleDeleteProviderKey: vi.fn(),
  handleDeleteSiteEngine: vi.fn(),
  handleCreateSiteEngine: vi.fn(),
  handleCreateCustomEngine: vi.fn(),
  handleUpdateCustomEngine: vi.fn(),
  handleDeleteCustomEngine: vi.fn(),
  handleCreateProviderInstance: vi.fn(),
  handleUpdateProviderInstance: vi.fn(),
  handleDeleteProviderInstance: vi.fn(),
  handleExportConfig: vi.fn(),
  handleGetCachedSearchEntry: vi.fn(),
  handleGetProviderConfig: vi.fn(),
  handleGetSearchCacheSummaries: vi.fn(),
  handleImportConfig: vi.fn(),
  handleListAgentInstances: vi.fn(),
  handleListAgentProviders: vi.fn(),
  handlePreviewImport: vi.fn(),
  handleSaveProviderKey: vi.fn(),
  handleSearch: vi.fn(),
  handleSearchInstance: vi.fn(),
  handleSetActiveProvider: vi.fn(),
  handleSetActiveSource: vi.fn(),
  handleClearProviderMaxResults: vi.fn(),
  handleSetProviderMaxResults: vi.fn(),
  handleSetSourceHidden: vi.fn(),
  handleSetSourceOrder: vi.fn(),
  handleSetGroupConfig: vi.fn(),
  handleSetAiAutoEnter: mockedHandleSetAiAutoEnter,
  handleSetFlatLayoutFewSources: mockedHandleSetFlatLayoutFewSources,
  handleTestKey: vi.fn(),
  handleUpdateSiteEngine: vi.fn(),
  installDownloadFilenameGuard: vi.fn(),
  getSchemaReady: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.stubGlobal('browser', {
    runtime: {
      getURL: (p: string) => `${EXT_ORIGIN}/${p.replace(/^\//, '')}`,
    },
  });
});

describe('buildSafeSearchUrl — 白名单参数转发', () => {
  it('保留 provider + query 参数', () => {
    expect(buildSafeSearchUrl('search.html?provider=tavily&query=hi')).toBe(
      `${EXT_ORIGIN}/search.html?provider=tavily&query=hi`,
    );
  });

  it('容忍前导斜杠的入参形状', () => {
    expect(buildSafeSearchUrl('/search.html?provider=exa&query=hello+world')).toBe(
      `${EXT_ORIGIN}/search.html?provider=exa&query=hello+world`,
    );
  });

  it('仅保留白名单参数；丢弃非白名单 key', () => {
    const got = buildSafeSearchUrl('search.html?provider=tavily&evil=1&query=x&tab=settings')!;
    expect(got).toContain('provider=tavily');
    expect(got).toContain('query=x');
    expect(got).not.toContain('evil');
    expect(got).not.toContain('tab');
  });

  it('只给 provider 也合法', () => {
    expect(buildSafeSearchUrl('search.html?provider=stepfun')).toBe(
      `${EXT_ORIGIN}/search.html?provider=stepfun`,
    );
  });

  it('空查询分支落 /search.html（无 query）', () => {
    expect(buildSafeSearchUrl('/search.html')).toBe(`${EXT_ORIGIN}/search.html`);
  });
});

describe('buildSafeSearchUrl — 路径层防 open-redirect（#2=B 核心）', () => {
  // 关键不变量：base 永远是 /search.html——入参的路径信息被完全丢弃。
  // 误用 caller 传 options.html 不会把当前 tab 导航到 options.html。
  it('把 options.html 入参收敛到 /search.html', () => {
    const got = buildSafeSearchUrl('options.html')!;
    expect(got.startsWith(`${EXT_ORIGIN}/search.html`)).toBe(true);
    expect(got).not.toContain('options');
  });

  it('把 options.html?x=1 入参收敛到 /search.html（参数也被丢弃）', () => {
    const got = buildSafeSearchUrl('options.html?x=1')!;
    expect(got.startsWith(`${EXT_ORIGIN}/search.html`)).toBe(true);
    expect(got).not.toContain('options');
    expect(got).not.toContain('x=1');
  });

  it('纯乱串（无 ?）仍落 /search.html', () => {
    expect(buildSafeSearchUrl('garbage')).toBe(`${EXT_ORIGIN}/search.html`);
  });

  it('带恶意路径 + 白名单参数的混合形态：路径丢弃，参数保留', () => {
    const got = buildSafeSearchUrl('//evil.com/options.html?provider=tavily&query=x')!;
    expect(got.startsWith(`${EXT_ORIGIN}/search.html`)).toBe(true);
    expect(got).toContain('provider=tavily');
    expect(got).toContain('query=x');
    expect(got).not.toContain('evil.com');
  });
});

describe('buildSafeSearchUrl — 非法入参返回 null', () => {
  it('拒绝空字符串', () => {
    expect(buildSafeSearchUrl('')).toBeNull();
  });

  it('拒绝 undefined', () => {
    expect(buildSafeSearchUrl(undefined)).toBeNull();
  });
});

describe('background handler registration — setAiAutoEnter', () => {
  it('registers setAiAutoEnter and delegates to handleSetAiAutoEnter', async () => {
    const onMessage = vi.mocked((await import('@/lib/messaging')).onMessage);
    onMessage.mockClear();
    mockedHandleSetAiAutoEnter.mockClear();

    // WXT 的 defineBackground 在运行时立即执行回调；这里 stub 为同步执行以触发注册。
    vi.stubGlobal('defineBackground', (cb: () => void) => {
      cb();
    });
    vi.stubGlobal('browser', {
      runtime: {
        id: 'fake-id',
        getURL: (p: string) => `${EXT_ORIGIN}/${p.replace(/^\//, '')}`,
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onInstalled: { addListener: vi.fn() },
      },
      action: { onClicked: { addListener: vi.fn() } },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}) },
        onChanged: { addListener: vi.fn() },
      },
      tabs: { create: vi.fn(), update: vi.fn() },
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
      contextMenus: {
        onClicked: { addListener: vi.fn() },
        create: vi.fn(),
        removeAll: vi.fn().mockResolvedValue(undefined),
      },
    });

    await import('@/entrypoints/background');

    const registration = onMessage.mock.calls.find(([type]) => type === 'setAiAutoEnter');
    expect(registration).toBeDefined();
    const handler = registration![1] as (ctx: { data: boolean }) => Promise<void>;
    await handler({ data: false });
    expect(mockedHandleSetAiAutoEnter).toHaveBeenCalledWith(false);
  });
});

describe('background handler registration — setFlatLayoutFewSources', () => {
  it('registers setFlatLayoutFewSources and delegates to handleSetFlatLayoutFewSources', async () => {
    const onMessage = vi.mocked((await import('@/lib/messaging')).onMessage);
    onMessage.mockClear();
    mockedHandleSetFlatLayoutFewSources.mockClear();

    // WXT 的 defineBackground 在运行时立即执行回调；这里 stub 为同步执行以触发注册。
    vi.stubGlobal('defineBackground', (cb: () => void) => {
      cb();
    });
    vi.stubGlobal('browser', {
      runtime: {
        id: 'fake-id',
        getURL: (p: string) => `${EXT_ORIGIN}/${p.replace(/^\//, '')}`,
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onInstalled: { addListener: vi.fn() },
      },
      action: { onClicked: { addListener: vi.fn() } },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}) },
        onChanged: { addListener: vi.fn() },
      },
      tabs: { create: vi.fn(), update: vi.fn() },
      downloads: { onDeterminingFilename: { addListener: vi.fn() } },
      contextMenus: {
        onClicked: { addListener: vi.fn() },
        create: vi.fn(),
        removeAll: vi.fn().mockResolvedValue(undefined),
      },
    });

    // 上一个用例已加载过 background 模块（vitest 缓存），必须重置模块再注册。
    vi.resetModules();
    await import('@/entrypoints/background');

    const registration = onMessage.mock.calls.find(([type]) => type === 'setFlatLayoutFewSources');
    expect(registration).toBeDefined();
    const handler = registration![1] as (ctx: { data: boolean }) => Promise<void>;
    await handler({ data: false });
    expect(mockedHandleSetFlatLayoutFewSources).toHaveBeenCalledWith(false);
  });
});
