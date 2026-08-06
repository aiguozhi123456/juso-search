import { describe, it, expect } from 'vitest';
import type { SearchSource, SourceId } from '@/lib/sources';
import {
  AI_SEARCH_GROUP,
  AI_ENGINES_GROUP,
  ENGINES_GROUP,
  SITES_GROUP,
  DEFAULT_GROUPS,
  defaultGroupForSourceId,
  defaultGroupConfig,
  groupOrderOf,
  isBuiltinGroupId,
  normalizeGroupConfig,
  pinnedSourceIds,
  projectLayout,
  resolveGroupId,
  resolveEffectiveLayout,
  type GroupConfig,
  type SourceGroup,
  type SwitcherItem,
  type ProjectedItem,
  type PinnedItem,
} from '@/lib/source-groups';

// ── 测试数据 ──
const SOURCES: SearchSource[] = [
  // AI providers
  makeSource('tavily', 'provider', true),
  makeSource('exa', 'provider', true),
  makeSource('stepfun', 'provider', false),
  // engines
  makeSource('google', 'engine', false),
  makeSource('bing', 'engine', false),
  makeSource('baidu', 'engine', false),
  // site-engine
  makeSource('site:docs', 'site-engine', false),
];

function makeSource(id: string, kind: 'provider' | 'engine' | 'site-engine', supportsAnswer: boolean): SearchSource {
  return { id, kind, label: `msg_${id}`, supportsAnswer, favicon: `/icons/${id}.svg` } as SearchSource;
}

/** 类型守卫：收窄 ProjectedItem → PinnedItem（kind === 'source'），便于在 every 断言后安全访问 .source。 */
function isPinnedItem(it: ProjectedItem): it is PinnedItem {
  return it.kind === 'source';
}

describe('defaultGroupForSourceId', () => {
  it('provider → ai-search, engine → engines, site → sites', () => {
    expect(defaultGroupForSourceId('tavily')).toBe(AI_SEARCH_GROUP);
    expect(defaultGroupForSourceId('google')).toBe(ENGINES_GROUP);
    expect(defaultGroupForSourceId('site:docs')).toBe(SITES_GROUP);
  });

  it('provider instance → ai-search', () => {
    expect(defaultGroupForSourceId('inst:exa:ai-research')).toBe(AI_SEARCH_GROUP);
    expect(defaultGroupForSourceId('inst:exa:startup-news')).toBe(AI_SEARCH_GROUP);
  });
});

describe('resolveGroupId', () => {
  it('uses explicit assignment when present', () => {
    expect(resolveGroupId('tavily', { tavily: 'custom' })).toBe('custom');
  });
  it('falls back to default group when no assignment', () => {
    expect(resolveGroupId('tavily', {})).toBe(AI_SEARCH_GROUP);
    expect(resolveGroupId('google', {})).toBe(ENGINES_GROUP);
  });
});

describe('isBuiltinGroupId', () => {
  it('recognizes the five built-in groups', () => {
    expect(isBuiltinGroupId(AI_SEARCH_GROUP)).toBe(true);
    expect(isBuiltinGroupId(AI_ENGINES_GROUP)).toBe(true);
    expect(isBuiltinGroupId(ENGINES_GROUP)).toBe(true);
    expect(isBuiltinGroupId(SITES_GROUP)).toBe(true);
    expect(isBuiltinGroupId('custom')).toBe(true);
    expect(isBuiltinGroupId('user-group')).toBe(false);
  });
});

describe('defaultGroupConfig', () => {
  it('returns five builtin groups in layout, empty assignments', () => {
    const cfg = defaultGroupConfig(['tavily', 'google']);
    expect(cfg.groups).toHaveLength(5);
    expect(cfg.layout).toEqual([
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
      { kind: 'group', groupId: AI_ENGINES_GROUP },
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: 'custom' },
    ]);
    expect(cfg.assignments).toEqual({});
  });
});

describe('normalizeGroupConfig', () => {
  it('returns default config for null/undefined/invalid raw', () => {
    const cfg = normalizeGroupConfig(undefined, ['tavily']);
    expect(cfg.layout).toHaveLength(5); // five builtin groups
    expect(cfg.groups).toEqual(DEFAULT_GROUPS);
  });

  it('strips unknown source ids and groups from layout', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'tavily' },
        { kind: 'source', sourceId: 'unknown-source' }, // 剔除
        { kind: 'group', groupId: 'unknown-group' }, // 剔除
        { kind: 'group', groupId: ENGINES_GROUP },
      ],
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'google']);
    // 清洗后剩 [tavily, engines]；缺失的内置组（sites/ai-engines/ai-search/custom）按 DEFAULT_GROUPS 顺序追加到末尾。
    expect(cfg.layout).toEqual([
      { kind: 'source', sourceId: 'tavily' },
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
      { kind: 'group', groupId: AI_ENGINES_GROUP },
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: 'custom' },
    ]);
  });

  it('dedupes layout entries keeping first occurrence', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'group', groupId: AI_SEARCH_GROUP },
        { kind: 'group', groupId: AI_SEARCH_GROUP }, // 重复，剔除
      ],
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, ['tavily']);
    expect(cfg.layout.filter((i) => i.kind === 'group' && i.groupId === AI_SEARCH_GROUP)).toHaveLength(1);
  });

  it('removes assignments for pinned sources', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'source', sourceId: 'tavily' }], // tavily pinned
      assignments: { tavily: AI_SEARCH_GROUP, exa: AI_SEARCH_GROUP }, // tavily 赋值应被清除（已置顶）
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'exa']);
    expect(cfg.assignments).toEqual({ exa: AI_SEARCH_GROUP });
  });

  it('removes assignments pointing to unknown groups', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [],
      assignments: { tavily: AI_SEARCH_GROUP, exa: 'deleted-group' },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'exa']);
    expect(cfg.assignments).toEqual({ tavily: AI_SEARCH_GROUP });
  });

  it('fills missing builtin groups into groups array', () => {
    const raw = {
      groups: [{ id: 'custom', label: { kind: 'literal', value: 'Custom' } }],
      layout: [],
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, []);
    // builtin groups prepended
    expect(cfg.groups.map((g) => g.id)).toEqual([ENGINES_GROUP, SITES_GROUP, AI_ENGINES_GROUP, AI_SEARCH_GROUP, 'custom']);
  });

  // 回归：持久化里只有「部分」内置组时，仍须按 DEFAULT_GROUPS 顺序把内置组排在前。
  // 旧实现只 unshift 缺失项，会把内置组排成偏离 DEFAULT_GROUPS 的顺序，顺序错乱。
  it('keeps builtin groups in DEFAULT_GROUPS order even when only some are persisted', () => {
    const raw = {
      // 只有 engines 一个内置组 + 一个自定义组
      groups: [
        { id: ENGINES_GROUP, label: { kind: 'i18n', key: 'group_engines' } },
        { id: 'custom', label: { kind: 'literal', value: 'Custom' } },
      ],
      layout: [],
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, []);
    // 内置组按 DEFAULT_GROUPS 顺序在前，自定义组随后
    expect(cfg.groups.map((g) => g.id)).toEqual([ENGINES_GROUP, SITES_GROUP, AI_ENGINES_GROUP, AI_SEARCH_GROUP, 'custom']);
  });

  // 回归（L4）：升级新增内置组（custom）后，老用户已有非空 layout（如 [ai-search, engines, sites]）
  // 不含该组。normalize 须把缺失的内置组追加到 layout 末尾，否则 custom 组只能靠 projectLayout 的
  // 兜底扫描渲染（位置不可控、不持久化）。
  it('appends missing builtin groups to the end of a non-empty layout, preserving order', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'group', groupId: AI_SEARCH_GROUP },
        { kind: 'group', groupId: ENGINES_GROUP },
        { kind: 'group', groupId: SITES_GROUP },
      ], // 缺 ai-engines/custom（升级前的持久化布局）
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'google']);
    expect(cfg.layout).toEqual([
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
      { kind: 'group', groupId: AI_ENGINES_GROUP }, // 按 DEFAULT_GROUPS 顺序追加到末尾，恰好一次
      { kind: 'group', groupId: 'custom' },
    ]);
    expect(cfg.layout.filter((i) => i.kind === 'group' && i.groupId === 'custom')).toHaveLength(1);
    expect(cfg.layout.filter((i) => i.kind === 'group' && i.groupId === AI_ENGINES_GROUP)).toHaveLength(1);
  });

  it('does not duplicate a builtin group already present in layout', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'group', groupId: ENGINES_GROUP },
        { kind: 'group', groupId: AI_SEARCH_GROUP },
      ],
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'google']);
    // 已存在的 engines/ai-search 保持原位不重复；缺失的 sites/ai-engines/custom 按 DEFAULT_GROUPS 顺序追加到末尾。
    expect(cfg.layout).toEqual([
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
      { kind: 'group', groupId: AI_ENGINES_GROUP },
      { kind: 'group', groupId: 'custom' },
    ]);
    expect(cfg.layout.filter((i) => i.kind === 'group' && i.groupId === ENGINES_GROUP)).toHaveLength(1);
    expect(cfg.layout.filter((i) => i.kind === 'group' && i.groupId === AI_SEARCH_GROUP)).toHaveLength(1);
  });

  it('does not auto-add user-defined groups to layout (only builtins)', () => {
    const raw = {
      groups: [
        ...DEFAULT_GROUPS,
        { id: 'my-group', label: { kind: 'literal', value: 'My Group' } },
      ],
      layout: [
        { kind: 'group', groupId: AI_SEARCH_GROUP },
        { kind: 'group', groupId: ENGINES_GROUP },
        { kind: 'group', groupId: SITES_GROUP },
        { kind: 'group', groupId: 'custom' },
      ], // 四个旧内置组均已在 layout；ai-engines 缺失（追加到末尾），my-group 是用户自建组
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, ['tavily']);
    // 用户自建组不自动进 layout（须由用户显式添加）；缺失的 ai-engines 追加到末尾，已存在的内置组不重复。
    expect(cfg.layout).toEqual([
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
      { kind: 'group', groupId: 'custom' },
      { kind: 'group', groupId: AI_ENGINES_GROUP },
    ]);
    expect(cfg.layout.some((i) => i.kind === 'group' && i.groupId === 'my-group')).toBe(false);
    // my-group 仍保留在 groups 定义里（只是不进 layout）
    expect(cfg.groups.map((g) => g.id)).toContain('my-group');
  });

  it('strips groups with invalid labels', () => {
    const raw = {
      groups: [
        { id: 'bad', label: { kind: 'wrong' } }, // invalid label kind
        { id: AI_SEARCH_GROUP, label: { kind: 'i18n', key: 'group_ai_search' } },
      ],
      layout: [],
      assignments: {},
    };
    const cfg = normalizeGroupConfig(raw, []);
    expect(cfg.groups.find((g) => g.id === 'bad')).toBeUndefined();
  });

  it('defaults groupOrders to an empty map', () => {
    const cfg = defaultGroupConfig(['tavily', 'google']);
    expect(cfg.groupOrders).toEqual({});
  });

  it('keeps valid explicit group orders, dropping cross-group residues', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'group', groupId: AI_SEARCH_GROUP }, { kind: 'group', groupId: ENGINES_GROUP }],
      assignments: {},
      groupOrders: {
        // google 归属 engines，混进 ai-search 的显式顺序 → 剔除（assignment 变更残留防护）
        'ai-search': ['tavily', 'google', 'exa'],
        'engines': ['baidu', 'bing'],
      },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'exa', 'google', 'bing', 'baidu']);
    expect(cfg.groupOrders['ai-search']).toEqual(['tavily', 'exa']);
    expect(cfg.groupOrders['engines']).toEqual(['baidu', 'bing']);
  });

  it('drops pinned ids from groupOrders', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'source', sourceId: 'tavily' }], // tavily pinned
      assignments: {},
      groupOrders: { 'ai-search': ['tavily', 'exa'] },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'exa']);
    // tavily 已置顶 → 从显式顺序剔除
    expect(cfg.groupOrders['ai-search']).toEqual(['exa']);
  });

  it('dedupes ids in groupOrders keeping first occurrence', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [],
      assignments: {},
      groupOrders: { 'ai-search': ['tavily', 'exa', 'tavily'] },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'exa']);
    expect(cfg.groupOrders['ai-search']).toEqual(['tavily', 'exa']);
  });

  it('drops unknown sources and unknown groups from groupOrders', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [],
      assignments: {},
      groupOrders: {
        'ai-search': ['tavily', 'ghost'], // ghost 未知 → 剔除
        'deleted-group': ['tavily'], // 未知组 → 整条丢弃
      },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily']);
    expect(cfg.groupOrders).toEqual({ 'ai-search': ['tavily'] });
  });

  it('drops empty explicit orders (fallback semantics, equivalent to absent)', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [],
      assignments: {},
      groupOrders: { 'ai-search': [] },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily']);
    expect(cfg.groupOrders).toEqual({});
  });

  it('recognizes provider instance ids in layout, assignments and groupOrders', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'inst:exa:ai-research' }, // 置顶实例
        { kind: 'group', groupId: AI_SEARCH_GROUP },
      ],
      assignments: { 'inst:exa:startup-news': AI_SEARCH_GROUP },
      groupOrders: { 'ai-search': ['inst:exa:startup-news'] },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily', 'inst:exa:ai-research', 'inst:exa:startup-news']);
    // 实例 id 已知 → 不被当作未知 source 剔除
    expect(cfg.layout.some((i) => i.kind === 'source' && i.sourceId === 'inst:exa:ai-research')).toBe(true);
    expect(cfg.assignments).toEqual({ 'inst:exa:startup-news': AI_SEARCH_GROUP });
    expect(cfg.groupOrders['ai-search']).toEqual(['inst:exa:startup-news']);
  });

  it('drops unknown provider instance ids', () => {
    const raw = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'source', sourceId: 'inst:exa:ghost' }, { kind: 'group', groupId: AI_SEARCH_GROUP }],
      assignments: { 'inst:exa:ghost': AI_SEARCH_GROUP },
      groupOrders: { 'ai-search': ['inst:exa:ghost'] },
    };
    const cfg = normalizeGroupConfig(raw, ['tavily']);
    expect(cfg.layout.some((i) => i.kind === 'source' && i.sourceId === 'inst:exa:ghost')).toBe(false);
    expect(cfg.assignments).toEqual({});
    expect(cfg.groupOrders['ai-search']).toBeUndefined();
  });
});

describe('pinnedSourceIds', () => {
  it('collects source ids that appear as pinned items', () => {
    const layout: SwitcherItem[] = [
      { kind: 'source', sourceId: 'tavily' },
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'source', sourceId: 'google' },
    ];
    expect(pinnedSourceIds(layout)).toEqual(new Set(['tavily', 'google']));
  });
});

describe('projectLayout', () => {
  it('default config: all sources grouped by type, empty groups skipped', () => {
    const cfg = defaultGroupConfig(SOURCES.map((s) => s.id));
    const layout = projectLayout(SOURCES, cfg, 'tavily');
    // 三个分组项（AI/engines/sites），无置顶项
    expect(layout.items.every((i) => i.kind === 'group')).toBe(true);
    const ai = layout.items.find((i) => i.kind === 'group' && i.group.id === AI_SEARCH_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(ai.items.map((s) => s.id)).toEqual(['tavily', 'exa', 'stepfun']);
    expect(ai.containsActive).toBe(true); // tavily active
  });

  it('pinned source appears as flat item and excluded from group', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'google' }, // pinned
        { kind: 'group', groupId: AI_SEARCH_GROUP },
        { kind: 'group', groupId: ENGINES_GROUP },
      ],
      assignments: {},
      groupOrders: {},
    };
    const layout = projectLayout(SOURCES, cfg, null);
    // google is a flat (pinned) item
    const flat = layout.items.find((i) => i.kind === 'source');
    expect(flat).toBeDefined();
    expect(flat!.kind === 'source' && flat!.source.id).toBe('google');
    // engines group should NOT contain google (it's pinned)
    const engines = layout.items.find((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(engines.items.map((s) => s.id)).toEqual(['bing', 'baidu']);
  });

  it('empty group is skipped (no matching sources)', () => {
    // layout 只有 SITES_GROUP，但 sources 里没有 site-engine → 该组空，应被跳过。
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'group', groupId: SITES_GROUP }],
      assignments: {},
      groupOrders: {},
    };
    const noSites = SOURCES.filter((s) => s.kind !== 'site-engine');
    const layout = projectLayout(noSites, cfg, null);
    // SITES_GROUP 是空的被跳过；fallback 会把 providers/engines 补进各自默认组。
    expect(layout.items.find((i) => i.kind === 'group' && i.group.id === SITES_GROUP)).toBeUndefined();
    // providers/engines 经 fallback 进了各自默认分组
    expect(layout.items.some((i) => i.kind === 'group' && i.group.id === AI_SEARCH_GROUP)).toBe(true);
    expect(layout.items.some((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP)).toBe(true);
  });

  it('containsActive true when active source is inside a group', () => {
    const cfg = defaultGroupConfig(SOURCES.map((s) => s.id));
    const layout = projectLayout(SOURCES, cfg, 'google');
    const engines = layout.items.find((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(engines.containsActive).toBe(true);
    const ai = layout.items.find((i) => i.kind === 'group' && i.group.id === AI_SEARCH_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(ai.containsActive).toBe(false);
  });

  it('custom assignment overrides default type-based grouping', () => {
    const cfg: GroupConfig = {
      groups: [
        ...DEFAULT_GROUPS,
        { id: 'custom', label: { kind: 'literal', value: 'Custom' } },
      ],
      layout: [
        { kind: 'group', groupId: 'custom' },
        { kind: 'group', groupId: AI_SEARCH_GROUP },
      ],
      assignments: { google: 'custom' }, // engine moved into custom group
      groupOrders: {},
    };
    const layout = projectLayout(SOURCES, cfg, null);
    const custom = layout.items.find((i) => i.kind === 'group' && i.group.id === 'custom') as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(custom.items.map((s) => s.id)).toContain('google');
    const ai = layout.items.find((i) => i.kind === 'group' && i.group.id === AI_SEARCH_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(ai.items.map((s) => s.id)).not.toContain('google');
  });

  it('each source appears at most once across the layout', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'tavily' },
        { kind: 'group', groupId: AI_SEARCH_GROUP },
        { kind: 'group', groupId: ENGINES_GROUP },
      ],
      assignments: {},
      groupOrders: {},
    };
    const layout = projectLayout(SOURCES, cfg, null);
    const seen = new Set<string>();
    for (const item of layout.items) {
      if (item.kind === 'source') {
        expect(seen.has(item.source.id)).toBe(false);
        seen.add(item.source.id);
      } else {
        for (const s of item.items) {
          expect(seen.has(s.id)).toBe(false);
          seen.add(s.id);
        }
      }
    }
  });

  it('hidden source (not in sources array) is not rendered even if pinned', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'tavily' },
        { kind: 'group', groupId: AI_SEARCH_GROUP },
      ],
      assignments: {},
      groupOrders: {},
    };
    // tavily is pinned but excluded from sources (e.g. key removed)
    const layout = projectLayout(SOURCES.slice(1), cfg, null);
    expect(layout.items.find((i) => i.kind === 'source')).toBeUndefined();
  });

  it('uses explicit groupOrders for within-group order', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'group', groupId: AI_SEARCH_GROUP },
        { kind: 'group', groupId: ENGINES_GROUP },
      ],
      assignments: {},
      groupOrders: {
        'ai-search': ['stepfun', 'exa', 'tavily'],
        'engines': ['baidu', 'google', 'bing'],
      },
    };
    const layout = projectLayout(SOURCES, cfg, null);
    const ai = layout.items.find((i) => i.kind === 'group' && i.group.id === AI_SEARCH_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(ai.items.map((s) => s.id)).toEqual(['stepfun', 'exa', 'tavily']);
    const engines = layout.items.find((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(engines.items.map((s) => s.id)).toEqual(['baidu', 'google', 'bing']);
  });

  it('falls back to sources order when groupOrders is empty/absent', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'group', groupId: ENGINES_GROUP }],
      assignments: {},
      // 空/缺省 groupOrders：回退 sources 数组顺序（google, bing, baidu）
      groupOrders: {},
    };
    const layout = projectLayout(SOURCES, cfg, null);
    const engines = layout.items.find((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(engines.items.map((s) => s.id)).toEqual(['google', 'bing', 'baidu']);
  });

  it('skips ids in explicit order that are not visible (hidden/unconfigured)', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'group', groupId: ENGINES_GROUP }],
      assignments: {},
      groupOrders: { 'engines': ['google', 'ghost', 'bing'] as SourceId[] }, // ghost 不在 sources
    };
    const layout = projectLayout(SOURCES, cfg, null);
    const engines = layout.items.find((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    // ghost 跳过；剩余成员（baidu）按 sources 顺序补尾
    expect(engines.items.map((s) => s.id)).toEqual(['google', 'bing', 'baidu']);
  });

  it('appends remaining members after the explicit order', () => {
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'group', groupId: ENGINES_GROUP }],
      assignments: {},
      groupOrders: { 'engines': ['baidu'] }, // 只显式排了一个
    };
    const layout = projectLayout(SOURCES, cfg, null);
    const engines = layout.items.find((i) => i.kind === 'group' && i.group.id === ENGINES_GROUP) as Extract<typeof layout.items[number], { kind: 'group' }>;
    expect(engines.items.map((s) => s.id)).toEqual(['baidu', 'google', 'bing']);
  });
});

describe('groupOrderOf vs projectLayout — 对拍一致性', () => {
  // 同一配置下：编辑器端 groupOrderOf（管理视图，含隐藏项）过滤到可见子集后，
  // 必须与投影层 projectLayout 的组内顺序严格一致（防止双份实现静默漂移）。
  const ALL_IDS = SOURCES.map((s) => s.id);

  // 覆盖：置顶项、跨组残留 id、重复 id、部分显式序、隐藏成员穿插。
  const cfg: GroupConfig = {
    groups: DEFAULT_GROUPS,
    layout: [
      { kind: 'source', sourceId: 'tavily' }, // 置顶
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
    ],
    assignments: {},
    groupOrders: {
      // ai-search：显式序含跨组残留（site:docs）、置顶 id（tavily）、重复 id（stepfun）
      [AI_SEARCH_GROUP]: ['site:docs', 'stepfun', 'exa', 'stepfun', 'tavily'],
      [ENGINES_GROUP]: ['baidu'], // 部分显式序：google/bing 按序补尾
    },
  };

  it.each([
    ['全部可见', SOURCES],
    ['baidu 与 site:docs 隐藏', SOURCES.slice(0, 5)],
    ['仅置顶 + 单引擎可见', [SOURCES[0], SOURCES[3], SOURCES[6]]],
  ])('%s：groupOrderOf 过滤可见后 === projectLayout 组内序', (_label, visible) => {
    const visibleIds = new Set(visible.map((s) => s.id));
    const layout = projectLayout(visible, cfg, null);
    for (const item of layout.items) {
      if (item.kind !== 'group') continue;
      const expected = groupOrderOf(ALL_IDS, cfg, item.group.id).filter((id) => visibleIds.has(id));
      expect(item.items.map((s) => s.id)).toEqual(expected);
    }
  });
});

describe('resolveEffectiveLayout', () => {
  const s = (id: string, kind: 'provider' | 'engine' | 'site-engine' = 'engine'): SearchSource =>
    makeSource(id, kind, kind === 'provider');

  /** 所有源显式归入单个组（layout 只含该组）的配置。 */
  function singleGroupConfig(ids: readonly string[]): GroupConfig {
    return {
      groups: DEFAULT_GROUPS,
      layout: [{ kind: 'group', groupId: ENGINES_GROUP }],
      assignments: Object.fromEntries(ids.map((id) => [id, ENGINES_GROUP])),
      groupOrders: {},
    };
  }

  /** 多个自定义分组、每个组均分指定源。 */
  function multiGroupConfig(idsByGroup: Record<string, string[]>): GroupConfig {
    const groups: SourceGroup[] = [
      ...DEFAULT_GROUPS,
      ...Object.keys(idsByGroup).map((gid): SourceGroup => ({ id: gid, label: { kind: 'literal', value: gid } })),
    ];
    return {
      groups,
      layout: Object.keys(idsByGroup).map((gid) => ({ kind: 'group', groupId: gid })),
      assignments: Object.fromEntries(
        Object.entries(idsByGroup).flatMap(([gid, ids]) => ids.map((id) => [id, gid])),
      ),
      groupOrders: {},
    };
  }

  it('flattens 3 sources regardless of structure (≤ FEW_SOURCES_FLAT_THRESHOLD)', () => {
    // 默认类型分组会渲染 ≥2 组（ai-search / engines / sites），但源总数 ≤4 → 仍平铺。
    const sources = [s('a', 'provider'), s('b', 'engine'), s('c', 'site-engine')];
    const layout = resolveEffectiveLayout(sources, defaultGroupConfig(sources.map((x) => x.id)), null);
    expect(layout.items.every((it) => it.kind === 'source')).toBe(true);
    expect(layout.items.filter(isPinnedItem).map((it) => it.source.id)).toEqual(sources.map((x) => x.id));
  });

  it('flattens 5 sources all in one group (renderedGroupCount == 1, < SINGLE_GROUP_FLAT_THRESHOLD)', () => {
    const sources = [s('a'), s('b'), s('c'), s('d'), s('e')];
    const layout = resolveEffectiveLayout(sources, singleGroupConfig(sources.map((x) => x.id)), null);
    expect(layout.items.every((it) => it.kind === 'source')).toBe(true);
    expect(layout.items.filter(isPinnedItem).map((it) => it.source.id)).toEqual(sources.map((x) => x.id));
  });

  it('flattens 6 sources all in one group (boundary: renderedGroupCount == 1, == SINGLE_GROUP_FLAT_THRESHOLD)', () => {
    const sources = [s('a'), s('b'), s('c'), s('d'), s('e'), s('f')];
    const layout = resolveEffectiveLayout(sources, singleGroupConfig(sources.map((x) => x.id)), null);
    expect(layout.items.every((it) => it.kind === 'source')).toBe(true);
    expect(layout.items.filter(isPinnedItem).map((it) => it.source.id)).toEqual(sources.map((x) => x.id));
  });

  it('keeps grouping for 7 sources all in one group (single group too large to flatten)', () => {
    const sources = [s('a'), s('b'), s('c'), s('d'), s('e'), s('f'), s('g')];
    const layout = resolveEffectiveLayout(sources, singleGroupConfig(sources.map((x) => x.id)), null);
    expect(layout.items.some((it) => it.kind === 'group')).toBe(true);
  });

  it('keeps grouping for 6 sources across 3 groups (multi-group structure has separation value)', () => {
    const sources = [s('a'), s('b'), s('c'), s('d'), s('e'), s('f')];
    const cfg = multiGroupConfig({
      g1: ['a', 'b'],
      g2: ['c', 'd'],
      g3: ['e', 'f'],
    });
    const layout = resolveEffectiveLayout(sources, cfg, null);
    expect(layout.items.some((it) => it.kind === 'group')).toBe(true);
  });

  it('flattens 4 sources across 2 groups (≤ FEW_SOURCES_FLAT_THRESHOLD)', () => {
    const sources = [s('a'), s('b'), s('c'), s('d')];
    const cfg = multiGroupConfig({ g1: ['a', 'b'], g2: ['c', 'd'] });
    const layout = resolveEffectiveLayout(sources, cfg, null);
    expect(layout.items.every((it) => it.kind === 'source')).toBe(true);
  });
});
