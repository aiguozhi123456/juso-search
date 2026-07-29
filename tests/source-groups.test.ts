import { describe, it, expect } from 'vitest';
import type { SearchSource } from '@/lib/sources';
import {
  AI_SEARCH_GROUP,
  ENGINES_GROUP,
  SITES_GROUP,
  DEFAULT_GROUPS,
  defaultGroupForSourceId,
  defaultGroupConfig,
  isBuiltinGroupId,
  normalizeGroupConfig,
  pinnedSourceIds,
  projectLayout,
  resolveGroupId,
  type GroupConfig,
  type SwitcherItem,
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

describe('defaultGroupForSourceId', () => {
  it('provider → ai-search, engine → engines, site → sites', () => {
    expect(defaultGroupForSourceId('tavily')).toBe(AI_SEARCH_GROUP);
    expect(defaultGroupForSourceId('google')).toBe(ENGINES_GROUP);
    expect(defaultGroupForSourceId('site:docs')).toBe(SITES_GROUP);
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
  it('recognizes the three built-in groups', () => {
    expect(isBuiltinGroupId(AI_SEARCH_GROUP)).toBe(true);
    expect(isBuiltinGroupId(ENGINES_GROUP)).toBe(true);
    expect(isBuiltinGroupId(SITES_GROUP)).toBe(true);
    expect(isBuiltinGroupId('custom')).toBe(false);
  });
});

describe('defaultGroupConfig', () => {
  it('returns three builtin groups in layout, empty assignments', () => {
    const cfg = defaultGroupConfig(['tavily', 'google']);
    expect(cfg.groups).toHaveLength(3);
    expect(cfg.layout).toEqual([
      { kind: 'group', groupId: AI_SEARCH_GROUP },
      { kind: 'group', groupId: ENGINES_GROUP },
      { kind: 'group', groupId: SITES_GROUP },
    ]);
    expect(cfg.assignments).toEqual({});
  });
});

describe('normalizeGroupConfig', () => {
  it('returns default config for null/undefined/invalid raw', () => {
    const cfg = normalizeGroupConfig(undefined, ['tavily']);
    expect(cfg.layout).toHaveLength(3); // three builtin groups
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
    expect(cfg.layout).toEqual([
      { kind: 'source', sourceId: 'tavily' },
      { kind: 'group', groupId: ENGINES_GROUP },
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
    expect(cfg.groups.map((g) => g.id)).toEqual([AI_SEARCH_GROUP, ENGINES_GROUP, SITES_GROUP, 'custom']);
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
    };
    // tavily is pinned but excluded from sources (e.g. key removed)
    const layout = projectLayout(SOURCES.slice(1), cfg, null);
    expect(layout.items.find((i) => i.kind === 'source')).toBeUndefined();
  });
});
