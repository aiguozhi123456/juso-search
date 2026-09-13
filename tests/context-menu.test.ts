// lib/context-menu.ts 核心逻辑测试。
//
// 通过 vi.mock('@/lib/storage') 控制 getProviderConfigSnapshot 返回的快照（同参投影
// allSources/projectLayout 均为真实实现），stub 全局 browser 提供 contextMenus/tabs/
// storage.local。覆盖：REBUILD_KEYS 判定、菜单树构建（顺序/id 前缀/selection 上下文）、
// 点击跳转（navigate / openSearchPage / 空选词 / 非叶子前缀）、M2 布局偏好路由、
// M3 aiAutoEnter 偏好，以及 S1 快照回退路径（sourceById 未填充时点击仍有效）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProviderId } from '@/lib/providers/types';
import { defaultGroupConfig } from '@/lib/source-groups';
import { allKnownSourceIds } from '@/lib/sources';
import { t } from '@/lib/i18n';

import { getProviderConfigSnapshot } from '@/lib/storage';
import {
  contextMenuNeedsRebuild,
  handleContextMenuClick,
  setupContextMenu,
} from '@/lib/context-menu';

vi.mock('@/lib/storage', () => ({ getProviderConfigSnapshot: vi.fn() }));

const EXT_ORIGIN = 'chrome-extension://fake-id';
const ROOT_ID = 'juso-search-root';

/** getProviderConfigSnapshot 的返回类型（vi.mock 只改运行时，类型仍是真实签名）。 */
type Snapshot = Awaited<ReturnType<typeof getProviderConfigSnapshot>>;

// browser API mocks（beforeEach 注入 global）。storage.local.get 仅被 rebuildMenuOnce
// 的 localePref 读取用到（getProviderConfigSnapshot 已被 mock）。
const menuCreate = vi.fn().mockResolvedValue(undefined);
const menuRemoveAll = vi.fn().mockResolvedValue(undefined);
const tabsCreate = vi.fn().mockResolvedValue({ id: 1 });
const storageLocalGet = vi.fn().mockResolvedValue({ localePref: 'zh_CN' });

/** 默认配置快照：仅 tavily 已配置；全部内置源可见；flatLayout 平铺偏好开启。 */
const baseSnapshot: Snapshot = {
  configuredProviderIds: ['tavily'],
  activeProviderId: 'tavily',
  activeSourceId: 'google',
  sourceOrder: [],
  sourceHidden: [],
  siteInstances: [],
  customEngines: [],
  providerInstances: [],
  providerMaxResults: {},
  groupConfig: defaultGroupConfig(allKnownSourceIds()),
  aggregate: { instances: [], eligibility: {}, rerank: { configured: false, hasApiKey: false } },
  aiAutoEnter: true,
  flatLayoutFewSources: true,
};

/** google 置顶 + engines 分组（含用户自定义组），flatLayout 关闭 → projectLayout 分支。 */
const snapshotWithPin: Snapshot = {
  ...baseSnapshot,
  flatLayoutFewSources: false,
  groupConfig: {
    groups: [
      { id: 'engines', label: { kind: 'i18n', key: 'group_engines' } },
      { id: 'custom', label: { kind: 'i18n', key: 'group_custom' } },
    ],
    layout: [
      { kind: 'source', sourceId: 'google' },
      { kind: 'group', groupId: 'engines' },
    ],
    assignments: {},
    groupOrders: {},
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProviderConfigSnapshot).mockResolvedValue(baseSnapshot);
  vi.stubGlobal('browser', {
    runtime: { getURL: (p: string) => `${EXT_ORIGIN}/${p.replace(/^\//, '')}` },
    storage: { local: { get: storageLocalGet } },
    contextMenus: {
      create: menuCreate,
      removeAll: menuRemoveAll,
      onClicked: { addListener: vi.fn() },
    },
    tabs: { create: tabsCreate },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('contextMenuNeedsRebuild', () => {
  it('REBUILD_KEYS 内的 key 触发重建', () => {
    expect(contextMenuNeedsRebuild({ sourceOrder: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ sourceHidden: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ siteInstances: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ customEngines: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ providerInstances: {} })).toBe(true);
    // 聚合（KTD16）：实例集合变更菜单结构；rerankConfig 变更 eligibility（隐式可见轴）。
    expect(contextMenuNeedsRebuild({ aggregateInstances: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ rerankConfig: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ groupConfig: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ providerKeys: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ localePref: {} })).toBe(true);
    expect(contextMenuNeedsRebuild({ flatLayoutFewSources: {} })).toBe(true);
  });

  it('无关 key 不触发重建', () => {
    expect(contextMenuNeedsRebuild({ themePref: {} })).toBe(false);
    expect(contextMenuNeedsRebuild({ serpBarPosition: {} })).toBe(false);
    expect(contextMenuNeedsRebuild({})).toBe(false);
  });
});

describe('setupContextMenu — 菜单树构建', () => {
  it('构建根菜单 + 分组及成员，全部 selection 上下文', async () => {
    await setupContextMenu();

    expect(menuRemoveAll).toHaveBeenCalledTimes(1);
    const calls = menuCreate.mock.calls.map(([props]) => props);

    expect(calls[0]).toMatchObject({ id: ROOT_ID, contexts: ['selection'] });
    expect(calls[0].title).toBe(t('context_menu_root'));

    // 全部菜单项都是 selection 上下文
    for (const c of calls) expect(c.contexts).toEqual(['selection']);

    // 源叶子项覆盖全部投影源（引擎 + 已配置 provider）
    const sourceIds = calls
      .filter((c) => c.id.startsWith('juso-src:'))
      .map((c) => c.id.slice('juso-src:'.length));
    expect(sourceIds).toContain('google');
    expect(sourceIds).toContain('tavily');

    // 内置分组出现
    const groupIds = calls.filter((c) => c.id.startsWith('juso-group:')).map((c) => c.id);
    expect(groupIds).toContain('juso-group:engines');
    expect(groupIds).toContain('juso-group:ai-search');

    // ai-search 组仅含 tavily（唯一已配置 provider）
    const aiSearchChildren = calls
      .filter((c) => c.parentId === 'juso-group:ai-search')
      .map((c) => c.id);
    expect(aiSearchChildren).toEqual(['juso-src:tavily']);

    // 除根菜单外都有父项
    for (const c of calls) {
      if (c.id !== ROOT_ID) expect(c.parentId).toBeDefined();
    }
  });

  it('置顶源平铺、分组作子菜单、组内源作子项，顺序与 projectLayout 一致', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(snapshotWithPin);
    await setupContextMenu();

    const ids = menuCreate.mock.calls.map(([props]) => props.id);
    expect(ids).toEqual([
      ROOT_ID,
      'juso-src:google',
      'juso-group:engines',
      'juso-src:bing',
      'juso-src:baidu',
      'juso-src:douyin',
      'juso-src:xiaohongshu',
      'juso-src:bilibili',
      'juso-src:yandex',
      'juso-src:duckduckgo',
      'juso-src:weixin',
      'juso-group:ai-search',
      'juso-src:tavily',
      'juso-group:ai-engines',
      'juso-src:ai:grok',
      'juso-src:ai:chatgpt',
      'juso-src:ai:deepseek',
      'juso-src:ai:doubao',
      'juso-src:ai:gemini',
    ]);
  });

  it('无可用源时仅清空旧菜单，不创建任何项', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue({
      ...baseSnapshot,
      configuredProviderIds: [],
      sourceHidden: allKnownSourceIds(),
    });
    await setupContextMenu();

    expect(menuRemoveAll).toHaveBeenCalledTimes(1);
    expect(menuCreate).not.toHaveBeenCalled();
  });
});

describe('handleContextMenuClick — 跳转', () => {
  // 先构建菜单（sourceById 已填充，走 map 命中路径），再清掉构建期调用记录。
  beforeEach(async () => {
    await setupContextMenu();
    vi.clearAllMocks();
  });

  it('engine（google）→ navigate → tabs.create 打开 SERP', async () => {
    await handleContextMenuClick({ menuItemId: 'juso-src:google', selectionText: 'hello world' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://www.google.com/search?q=hello%20world' });
  });

  it('provider（tavily）→ openSearchPage → buildSafeSearchUrl 后 tabs.create', async () => {
    await handleContextMenuClick({ menuItemId: 'juso-src:tavily', selectionText: 'hello' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: `${EXT_ORIGIN}/search.html?provider=tavily&query=hello` });
  });

  it('空/纯空白选中文本 → 不跳转', async () => {
    await handleContextMenuClick({ menuItemId: 'juso-src:google', selectionText: '   ' });
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('非 juso-src: 前缀（分组/根）→ 不处理', async () => {
    await handleContextMenuClick({ menuItemId: 'juso-group:engines', selectionText: 'x' });
    await handleContextMenuClick({ menuItemId: ROOT_ID, selectionText: 'x' });
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('aiAutoEnter=false 时注入型 AI 引擎不带 enter 参数', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue({ ...baseSnapshot, aiAutoEnter: false });
    await handleContextMenuClick({ menuItemId: 'juso-src:ai:chatgpt', selectionText: 'q' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://chatgpt.com/?q=q' });
  });
});

describe('S1 回退路径：内存 map 未命中时从快照自解析', () => {
  it('sourceById 为空（未调 setupContextMenu）时点击仍能打开标签', async () => {
    vi.resetModules();
    const storage = await import('@/lib/storage');
    vi.mocked(storage.getProviderConfigSnapshot).mockResolvedValue(baseSnapshot);
    const cm = await import('@/lib/context-menu');

    await cm.handleContextMenuClick({ menuItemId: 'juso-src:google', selectionText: 'fallback' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://www.google.com/search?q=fallback' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 聚合 chip 场景（Lane G 回归锁 / KTD16）：聚合实例增删、改成员（eligibility 变化）、
// rerank 配置变化 → 菜单重建后 chip 集同步。REBUILD_KEYS 登记已在上文锁定；
// 这里锁「重建后的菜单内容与快照投影一致」——菜单与快切栏无漂移（plan Verification 3）。
// ────────────────────────────────────────────────────────────────────────────
describe('聚合 chip 场景：实例增删/改成员/rerank 变化 → 菜单重建 + chip 集同步', () => {
  const AGG = 'agg:menu1';
  const RERANK = { configured: true, hasApiKey: false, endpoint: 'http://127.0.0.1:8000/v1/rerank' };

  /** 基础快照 + 一个聚合实例（members 只含 tavily → tavily 已配置时 eligible）。 */
  function aggSnapshot(overrides: { aggregate?: Snapshot['aggregate']; configuredProviderIds?: ProviderId[] } = {}): Snapshot {
    return {
      ...baseSnapshot,
      ...(overrides.configuredProviderIds ? { configuredProviderIds: overrides.configuredProviderIds } : {}),
      aggregate: overrides.aggregate ?? {
        instances: [{ id: AGG, name: '全家桶', members: ['tavily'], topN: 20 }],
        eligibility: { [AGG]: { eligible: true, validMembers: 1 } },
        rerank: RERANK,
      },
    };
  }

  function menuSourceIds(): string[] {
    return menuCreate.mock.calls
      .map(([props]) => props.id as string)
      .filter((id) => id.startsWith('juso-src:'))
      .map((id) => id.slice('juso-src:'.length));
  }

  /** 模拟一次 storage 变更触发的菜单重建：换快照 → 重跑 setupContextMenu。 */
  async function rebuildWith(snapshot: Snapshot): Promise<void> {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(snapshot);
    menuCreate.mockClear();
    menuRemoveAll.mockClear();
    await setupContextMenu();
  }

  it('eligible 聚合实例投影为 juso-src:agg: 叶子项', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(aggSnapshot());
    await setupContextMenu();
    expect(menuSourceIds()).toContain(AGG);
  });

  it('新增实例 → 重建后 chip 集包含新实例（增）', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(aggSnapshot());
    await setupContextMenu();
    expect(menuSourceIds()).not.toContain('agg:menu2');

    await rebuildWith(aggSnapshot({
      aggregate: {
        instances: [
          { id: AGG, name: '全家桶', members: ['tavily'], topN: 20 },
          { id: 'agg:menu2', name: '技术区', members: ['tavily', 'exa'], topN: 10 },
        ],
        eligibility: {
          [AGG]: { eligible: true, validMembers: 1 },
          'agg:menu2': { eligible: true, validMembers: 2 },
        },
        rerank: RERANK,
      },
    }));
    expect(menuSourceIds()).toContain(AGG);
    expect(menuSourceIds()).toContain('agg:menu2');
  });

  it('删除实例 → 重建后该 chip 消失、其余 chip 不受影响（删）', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(aggSnapshot({
      aggregate: {
        instances: [
          { id: AGG, name: '全家桶', members: ['tavily'], topN: 20 },
          { id: 'agg:menu2', name: '技术区', members: ['tavily'], topN: 10 },
        ],
        eligibility: {
          [AGG]: { eligible: true, validMembers: 1 },
          'agg:menu2': { eligible: true, validMembers: 1 },
        },
        rerank: RERANK,
      },
    }));
    await setupContextMenu();
    expect(menuSourceIds()).toEqual(expect.arrayContaining([AGG, 'agg:menu2', 'google']));

    // 删除 agg:menu2（定义集去掉）→ 重建后仅该 chip 消失
    await rebuildWith(aggSnapshot({
      aggregate: {
        instances: [{ id: AGG, name: '全家桶', members: ['tavily'], topN: 20 }],
        eligibility: { [AGG]: { eligible: true, validMembers: 1 } },
        rerank: RERANK,
      },
    }));
    const ids = menuSourceIds();
    expect(ids).not.toContain('agg:menu2');
    expect(ids).toContain(AGG);
    expect(ids).toContain('google');
  });

  it('改成员致 0 有效成员（eligibility 翻 false）→ 重建后 chip 消失；成员恢复 → chip 复活', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(aggSnapshot());
    await setupContextMenu();
    expect(menuSourceIds()).toContain(AGG);

    // 成员失效（如 tavily key 清除 → eligibility 单点重算为 false）→ chip 消失
    await rebuildWith(aggSnapshot({
      aggregate: {
        instances: [{ id: AGG, name: '全家桶', members: ['tavily'], topN: 20 }],
        eligibility: { [AGG]: { eligible: false, validMembers: 0 } },
        rerank: RERANK,
      },
    }));
    expect(menuSourceIds()).not.toContain(AGG);
    expect(menuSourceIds()).toContain('google'); // 其余 chip 不受影响

    // 成员恢复（eligibility 复活）→ chip 复活
    await rebuildWith(aggSnapshot());
    expect(menuSourceIds()).toContain(AGG);
  });

  it('rerank 配置清除（隐式可见轴失效）→ 全部聚合 chip 消失；重新配置 → 复活', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(aggSnapshot({
      aggregate: {
        instances: [
          { id: AGG, name: '全家桶', members: ['tavily'], topN: 20 },
          { id: 'agg:menu2', name: '技术区', members: ['tavily'], topN: 10 },
        ],
        eligibility: {
          [AGG]: { eligible: true, validMembers: 1 },
          'agg:menu2': { eligible: true, validMembers: 1 },
        },
        rerank: RERANK,
      },
    }));
    await setupContextMenu();
    expect(menuSourceIds()).toEqual(expect.arrayContaining([AGG, 'agg:menu2']));

    await rebuildWith(aggSnapshot({
      aggregate: {
        instances: [
          { id: AGG, name: '全家桶', members: ['tavily'], topN: 20 },
          { id: 'agg:menu2', name: '技术区', members: ['tavily'], topN: 10 },
        ],
        eligibility: {
          [AGG]: { eligible: false, validMembers: 1 },
          'agg:menu2': { eligible: false, validMembers: 1 },
        },
        rerank: { configured: false, hasApiKey: false },
      },
    }));
    const ids = menuSourceIds();
    expect(ids).not.toContain(AGG);
    expect(ids).not.toContain('agg:menu2');

    await rebuildWith(aggSnapshot());
    expect(menuSourceIds()).toContain(AGG);
  });

  it('点击聚合 chip → openSearchPage 深链 provider=agg:（与 provider 实例同语义）', async () => {
    vi.mocked(getProviderConfigSnapshot).mockResolvedValue(aggSnapshot());
    await setupContextMenu();
    vi.clearAllMocks();

    await handleContextMenuClick({ menuItemId: `juso-src:${AGG}`, selectionText: 'hello' });
    expect(tabsCreate).toHaveBeenCalledWith({ url: `${EXT_ORIGIN}/search.html?provider=${encodeURIComponent(AGG)}&query=hello` });
  });
});
