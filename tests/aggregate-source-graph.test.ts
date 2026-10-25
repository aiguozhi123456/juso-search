import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SearchSource, SourceId } from '@/lib/sources';
import {
  aggregateSourcesOf,
  allKnownSourceIds,
  allSources,
  normalizeSourceHidden,
  normalizeSourceOrder,
  resolveEffectiveActiveSource,
  visibleUsableSource,
} from '@/lib/sources';
import type { AggregateInstance } from '@/lib/aggregate-instances';
import type { ProviderInstance } from '@/lib/provider-instances';
import type { CustomEngineDefinition } from '@/lib/custom-engines';
import type { SiteInstanceDefinition } from '@/lib/site-instances';
import {
  AGGREGATE_GROUP,
  AI_SEARCH_GROUP,
  AI_ENGINES_GROUP,
  CUSTOM_GROUP,
  ENGINES_GROUP,
  DEFAULT_GROUPS,
  defaultGroupConfig,
  defaultGroupForSourceId,
  isBuiltinGroupId,
  normalizeGroupConfig,
  resolveEffectiveLayout,
} from '@/lib/source-groups';
import {
  ACTIVE_KEY,
  ACTIVE_SOURCE_KEY,
  AGGREGATE_INSTANCES_KEY,
  getActiveSourceId,
  getCachedSearch,
  getGroupConfig,
  getProviderConfigSnapshot,
  getRerankConfig,
  getSourceHidden,
  getSourceOrder,
  clearKey,
  RERANK_CONFIG_KEY,
  SOURCE_HIDDEN_KEY,
  SOURCE_ORDER_KEY,
  selectActiveSourceId,
  setAggregateInstances,
  setKey,
  setRerankConfig,
  setSourceHidden,
  setSourceOrder,
  createAggregateInstance,
  createCustomEngineDefinition,
  createProviderInstance,
  createSiteInstanceDefinition,
} from '@/lib/storage';
import type { AggregateConfigSnapshot } from '@/lib/aggregate/types';
import { handleAggregateSearch, handleDeleteAggregateInstance } from '@/lib/gateway';
import { isAggregateCacheEntry } from '@/lib/search-cache';
import { mergeImport } from '@/lib/config-io';
import { CURRENT_SCHEMA_VERSION } from '@/lib/schema';
import { res } from './helpers';

// gateway 经 lib/skill-variant 引用构建期 define（__SKILL_VARIANT__），vitest 下需显式钉住
// （沿 tests/aggregate-gateway.test.ts 先例）。其余 gateway 依赖（storage/schema/search-cache/
// config-io）保持真实实现——AE9 全链路的意义就在跨真实层串联。
vi.mock('@/lib/skill-variant', () => ({ SKILL_VARIANT: 'prod' }));

// Lane C（KTD4/KTD5/KTD11）source 图 kernel 回归：
//  - allSources 第 7 参投影（eligible 过滤 / literal label / 缺省无 agg pill）；
//  - L4 三形态（老非空 layout 末尾追加 / 空 layout / 新装全序）；
//  - 四类共存矩阵（agg × site × custom × provider-instance，红线硬性要求）；
//  - F2 分层锁（eligibility 抖动期间 order/hidden 重写不剥落 agg id）；
//  - selectActiveSourceId 受理 agg + 清单外 throw + 派生回退不持久化；
//  - snapshot 脱敏 aggregate 字段（无 apiKey）+ fallback 一致；
//  - 平铺阈值矩阵。
// Lane G 追加：AE9 全链路（删光 → 组消失/order/hidden/activeSource 剥落回退 → 重建 →
// 经 gateway handleAggregateSearch 再搜成功——跨 store/gateway/投影的串联场景）。

const ENDPOINT = 'http://127.0.0.1:8000/v1/rerank';

function aggInstance(id: string, overrides: Partial<AggregateInstance> = {}): AggregateInstance {
  return { id: `agg:${id}`, name: `Name-${id}`, members: ['tavily'], topN: 10, ...overrides };
}

interface StorageMock {
  store: Map<string, unknown>;
}

function installStorage(seed: Record<string, unknown> = {}): StorageMock {
  const store = new Map<string, unknown>(Object.entries(seed));
  vi.stubGlobal('browser', {
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (store.has(k)) out[k] = store.get(k);
            return out;
          }
          return {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
      },
    },
  });
  return { store };
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ────────────────────────────────────────────────────────────────────────────
// allSources 投影（KTD4 第 7 参）
// ────────────────────────────────────────────────────────────────────────────

describe('allSources: aggregate projection (KTD4)', () => {
  const eligible: AggregateInstance[] = [
    { id: 'agg:family', name: '全家桶', members: ['tavily'], topN: 10 },
    { id: 'agg:tech', name: '技术区', members: ['exa'], topN: 20 },
  ];
  const projection = eligible.map((instance) => ({ id: instance.id, name: instance.name, eligible: true }));

  it('projects one pill per eligible instance with a literal instance-name label', () => {
    const sources = allSources([], undefined, undefined, [], [], [], projection);
    const agg = sources.filter((s) => s.kind === 'aggregate-instance');
    expect(agg.map((s) => s.id)).toEqual(['agg:family', 'agg:tech']);
    const family = sources.find((s) => s.id === 'agg:family');
    expect(family).toMatchObject({
      kind: 'aggregate-instance',
      label: '全家桶',
      labelDescriptor: { kind: 'literal', value: '全家桶' },
      supportsAnswer: false,
      favicon: '/icons/aggregate.svg',
    });
  });

  it('never projects ineligible instances (implicit visibility axis)', () => {
    const sources = allSources([], undefined, undefined, [], [], [], [
      { id: 'agg:family', name: '全家桶', eligible: false },
      { id: 'agg:tech', name: '技术区', eligible: true },
    ]);
    const ids = sources.map((s) => s.id);
    expect(ids).not.toContain('agg:family');
    expect(ids).toContain('agg:tech');
  });

  it('projects no agg pills without the 7th argument', () => {
    expect(allSources([]).some((s) => s.kind === 'aggregate-instance')).toBe(false);
    expect(allSources([], undefined, undefined, [], [], []).some((s) => s.kind === 'aggregate-instance')).toBe(false);
  });

  it('follows sourceOrder position and drops hidden agg ids', () => {
    const ordered = allSources([], ['agg:tech', 'google'], undefined, [], [], [], projection);
    expect(ordered.map((s) => s.id).slice(0, 2)).toEqual(['agg:tech', 'google']);
    const hidden = allSources([], undefined, ['agg:family'], [], [], [], projection);
    const hiddenIds = hidden.map((s) => s.id);
    expect(hiddenIds).not.toContain('agg:family');
    expect(hiddenIds).toContain('agg:tech');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// normalize / 已知集定义集穿透（F2：定义集与 eligibility 无关）
// ────────────────────────────────────────────────────────────────────────────

describe('normalize + known ids threading (KTD4/F2)', () => {
  const instances = [aggInstance('a1'), aggInstance('a2')];

  it('normalizeSourceOrder keeps known agg ids and backfills missing ones after provider instances', () => {
    const providerInstances: ProviderInstance[] = [
      { id: 'inst:tavily:p1', baseProviderId: 'tavily', name: 'P1', options: {} },
    ];
    const order = normalizeSourceOrder(['agg:a1', 'google', 'inst:tavily:p1'], [], [], providerInstances, instances);
    expect(order.indexOf('agg:a1')).toBeLessThan(order.indexOf('google'));
    expect(order).toContain('agg:a2'); // 缺失实例按定义顺序补尾，且位于 provider 实例之后
    expect(order.indexOf('inst:tavily:p1')).toBeLessThan(order.indexOf('agg:a2'));
    expect(order).not.toContain('agg:ghost');
  });

  it('normalizeSourceOrder drops agg ids outside the definition set (still eligibility-agnostic)', () => {
    // 定义集只含 a1：a2 被剥落——即使 a1 因 rerank 未配置而 ineligible（F2 与 eligibility 无关）。
    expect(normalizeSourceOrder(['agg:a1', 'agg:a2', 'google'], [], [], [], [aggInstance('a1')])).toContain('agg:a1');
    expect(normalizeSourceOrder(['agg:a1', 'agg:a2', 'google'], [], [], [], [aggInstance('a1')])).not.toContain('agg:a2');
  });

  it('normalizeSourceHidden recognizes known agg ids', () => {
    expect(normalizeSourceHidden(['agg:a1', 'agg:ghost', 'google'], [], [], [], instances)).toEqual(['agg:a1', 'google']);
  });

  it('allKnownSourceIds includes aggregate instance ids', () => {
    const known = allKnownSourceIds([], [], [], instances);
    expect(known).toContain('agg:a1');
    expect(known).toContain('agg:a2');
  });

  it('resolveEffectiveActiveSource / visibleUsableSource honor the eligible flag', () => {
    const sources = [{ id: 'agg:a1' as const, name: 'A1', eligible: false }];
    // ineligible 的存量 agg 不被受理 → 落到 keyless 免费层回退（tavily），而非 undefined。
    expect(resolveEffectiveActiveSource('agg:a1', {}, [], [], [], sources)).toBe('tavily');
    expect(visibleUsableSource(['agg:a1'], [], {}, [], [], [], sources)).toBeUndefined();
    const eligibleSources = [{ id: 'agg:a1' as const, name: 'A1', eligible: true }];
    expect(resolveEffectiveActiveSource('agg:a1', {}, [], [], [], eligibleSources)).toBe('agg:a1');
    expect(visibleUsableSource(['agg:a1'], [], {}, [], [], [], eligibleSources)).toBe('agg:a1');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// source-groups：新内置组 aggregate（KTD11）+ L4 三形态 + 平铺阈值
// ────────────────────────────────────────────────────────────────────────────

describe('source-groups: aggregate builtin group (KTD11)', () => {
  it('places aggregate between ai-search and custom in DEFAULT_GROUPS', () => {
    const ids = DEFAULT_GROUPS.map((g) => g.id);
    expect(ids).toEqual([ENGINES_GROUP, 'sites', AI_ENGINES_GROUP, AI_SEARCH_GROUP, AGGREGATE_GROUP, CUSTOM_GROUP]);
  });

  it('routes agg ids to the aggregate group explicitly (no silent sites fallback)', () => {
    expect(defaultGroupForSourceId('agg:family')).toBe(AGGREGATE_GROUP);
    expect(isBuiltinGroupId(AGGREGATE_GROUP)).toBe(true);
  });

  // L4 形态 1：老存量非空 layout（含全部五个旧内置组 + 自建组）→ 新组 aggregate 追加至末尾
  //（custom 与自建组之后，用户裁决——既有顺序完全不动）。
  it('L4 form 1: legacy non-empty layout gets the aggregate group appended at the end', () => {
    const legacy = normalizeGroupConfig(
      {
        groups: [...DEFAULT_GROUPS.filter((g) => g.id !== AGGREGATE_GROUP), { id: 'user-x', label: { kind: 'literal', value: '自建' } }],
        layout: [
          { kind: 'group', groupId: ENGINES_GROUP },
          { kind: 'group', groupId: 'sites' },
          { kind: 'group', groupId: AI_ENGINES_GROUP },
          { kind: 'group', groupId: AI_SEARCH_GROUP },
          { kind: 'group', groupId: CUSTOM_GROUP },
          { kind: 'group', groupId: 'user-x' },
        ],
        assignments: {},
      },
      ['tavily', 'google'],
    );
    expect(legacy.layout.map((item) => item.kind === 'group' ? item.groupId : `s:${item.sourceId}`)).toEqual([
      'engines',
      'sites',
      'ai-engines',
      'ai-search',
      'custom',
      'user-x',
      'aggregate', // 仅在末尾追加，既有顺序不动
    ]);
  });

  // L4 形态 2：空 layout → DEFAULT_GROUPS 全序（aggregate 在 ai-search 后 custom 前）。
  it('L4 form 2: empty layout falls back to the full DEFAULT_GROUPS order', () => {
    const cfg = normalizeGroupConfig({ groups: [], layout: [], assignments: {} }, ['tavily']);
    expect(cfg.layout).toEqual(DEFAULT_GROUPS.map((g) => ({ kind: 'group', groupId: g.id })));
  });

  // L4 形态 3：新装（无 groupConfig）→ 同全序。
  it('L4 form 3: fresh install default config uses the full DEFAULT_GROUPS order', () => {
    expect(defaultGroupConfig(['tavily']).layout).toEqual(DEFAULT_GROUPS.map((g) => ({ kind: 'group', groupId: g.id })));
  });

  it('integration: getGroupConfig backfills the aggregate group for a legacy persisted layout', async () => {
    installStorage({
      groupConfig: {
        groups: [
          { id: ENGINES_GROUP, label: { kind: 'i18n', key: 'group_engines' } },
          { id: CUSTOM_GROUP, label: { kind: 'i18n', key: 'group_custom' } },
        ],
        layout: [{ kind: 'group', groupId: ENGINES_GROUP }],
        assignments: {},
      },
    });
    const cfg = await getGroupConfig();
    const layoutGroups = cfg.layout.filter((item) => item.kind === 'group').map((item) => (item as { groupId: string }).groupId);
    // 既有项保持不动；缺失内置组按 DEFAULT_GROUPS 顺序追加（sites → ai-engines → ai-search → aggregate → custom）。
    expect(layoutGroups).toEqual([ENGINES_GROUP, 'sites', 'ai-engines', 'ai-search', AGGREGATE_GROUP, CUSTOM_GROUP]);
  });

  it('flat-threshold matrix: single aggregate instance + few sources → flat; many sources → grouped', () => {
    const make = (id: string, kind: 'engine' | 'aggregate-instance'): SearchSource =>
      ({ id, kind, label: id, supportsAnswer: false } as SearchSource);
    const aggPill = make('agg:family', 'aggregate-instance');
    // 4 个源（≤ FEW_SOURCES_FLAT_THRESHOLD）→ 平铺（单聚合实例属预期，KTD11）。
    const few: SearchSource[] = [aggPill, make('google', 'engine'), make('bing', 'engine'), make('tavily', 'engine')];
    expect(resolveEffectiveLayout(few, defaultGroupConfig(few.map((s) => s.id)), null).items.every((item) => item.kind === 'source')).toBe(true);
    // 大量源横跨 ≥2 个非空组 → 保留分组。
    const many: SearchSource[] = [aggPill, ...allSources([])];
    const projected = resolveEffectiveLayout(many, defaultGroupConfig(many.map((s) => s.id)), null);
    expect(projected.items.filter((item) => item.kind === 'group').length).toBeGreaterThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// storage：F2 分层锁 + CRUD order 追加
// ────────────────────────────────────────────────────────────────────────────

describe('storage: F2 layering lock (KTD4)', () => {
  it('keeps agg ids in order/hidden while rerank is unconfigured, and they survive in place after restore', async () => {
    await setAggregateInstances([aggInstance('a1', { name: 'A1' }), aggInstance('a2', { name: 'A2', members: ['exa'] })]);
    await setKey('tavily', 'tvly-key');
    // rerank 未配置 → 全部聚合实例 ineligible。此时改 hidden/order：
    await setSourceHidden(['google', 'agg:a1']);
    await setSourceOrder(['agg:a1', 'google', 'bing', 'agg:a2']);
    expect(await getSourceHidden()).toContain('agg:a1');
    expect((await getSourceOrder())[0]).toBe('agg:a1');
    expect(await getSourceOrder()).toContain('agg:a2');
    // 恢复 rerank → eligibility 复活，agg id 原位存活（存储从未剥落）。
    await setRerankConfig({ endpoint: ENDPOINT });
    const order = await getSourceOrder();
    expect(order[0]).toBe('agg:a1');
    expect(await getSourceHidden()).toContain('agg:a1');
    const snapshot = await getProviderConfigSnapshot();
    // a1（tavily 成员已配 key）复活；a2（exa 未配 key）仍 ineligible——eligibility 只作用于投影。
    expect(snapshot.aggregate.eligibility['agg:a1']).toEqual({ eligible: true, validMembers: 1 });
    expect(snapshot.aggregate.eligibility['agg:a2']).toEqual({ eligible: false, validMembers: 0 });
    // 去掉显式隐藏后 a1 按其 order 首位投影（隐式轴 + 显式轴正交）。
    const sources = allSources(snapshot.configuredProviderIds, order, [], [], [], snapshot.providerInstances, aggregateSourcesOf(snapshot.aggregate));
    expect(sources[0]).toMatchObject({ id: 'agg:a1', kind: 'aggregate-instance' });
  });

  it('createAggregateInstance appends the new id to sourceOrder via the normalized path', async () => {
    const created = await createAggregateInstance({ name: '新聚合', members: ['google'] });
    const order = await getSourceOrder();
    expect(order[order.length - 1]).toBe(created.id);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 四类共存矩阵（红线硬性要求：agg × site × custom × provider-instance）
// ────────────────────────────────────────────────────────────────────────────

describe('four-type coexistence matrix (source-graph threading red line)', () => {
  const siteSeed: SiteInstanceDefinition = { id: 'site:s1', name: 'S1', target: 'https://s1.example.com', engineId: 'google' };
  const customSeed: CustomEngineDefinition = { id: 'custom:c1', name: 'C1', urlTemplate: 'https://c1.example.com/?q=%s' };
  const providerSeed: ProviderInstance = { id: 'inst:tavily:p1', baseProviderId: 'tavily', name: 'P1', options: {} };
  const aggSeed = aggInstance('a1', { name: 'A1', members: ['google'] });

  async function seedAllFour(): Promise<void> {
    installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggSeed],
      siteInstances: [siteSeed],
      customEngines: [customSeed],
      providerInstances: [providerSeed],
      [SOURCE_ORDER_KEY]: ['site:s1', 'custom:c1', 'inst:tavily:p1', 'agg:a1', 'google'],
      [SOURCE_HIDDEN_KEY]: ['site:s1', 'agg:a1'],
    });
  }

  async function expectSurvival(ids: string[]): Promise<void> {
    const order = await getSourceOrder();
    const hidden = await getSourceHidden();
    for (const id of ids) {
      expect(order).toContain(id);
    }
    expect(hidden).toEqual(['site:s1', 'agg:a1']);
  }

  it('mutating a site instance keeps agg + custom + provider-instance ids alive', async () => {
    await seedAllFour();
    await createSiteInstanceDefinition({ id: 'site:s2', name: 'S2', target: 'https://s2.example.com', engineId: 'google' });
    await expectSurvival(['custom:c1', 'inst:tavily:p1', 'agg:a1', 'site:s2']);
  });

  it('mutating a custom engine keeps agg + site + provider-instance ids alive', async () => {
    await seedAllFour();
    await createCustomEngineDefinition({ id: 'custom:c2', name: 'C2', urlTemplate: 'https://c2.example.com/?q=%s' });
    await expectSurvival(['site:s1', 'inst:tavily:p1', 'agg:a1', 'custom:c2']);
  });

  it('mutating a provider instance keeps agg + site + custom ids alive', async () => {
    await seedAllFour();
    await createProviderInstance('tavily', 'P2', {});
    await expectSurvival(['site:s1', 'custom:c1', 'agg:a1']);
  });

  it('mutating an aggregate instance keeps site + custom + provider-instance ids alive (reverse direction)', async () => {
    await seedAllFour();
    const created = await createAggregateInstance({ name: 'A2', members: ['bing'] });
    await expectSurvival(['site:s1', 'custom:c1', 'inst:tavily:p1']);
    const order = await getSourceOrder();
    expect(order[order.length - 1]).toBe(created.id);
  });

  it('clearing a provider key keeps agg ids in order/hidden (eligibility drops, definitions stay)', async () => {
    await seedAllFour();
    await setKey('tavily', 'tvly-key');
    await clearKey('tavily');
    await expectSurvival(['site:s1', 'custom:c1', 'inst:tavily:p1', 'agg:a1']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// selectActiveSourceId / getActiveSourceId（KTD5）
// ────────────────────────────────────────────────────────────────────────────

describe('storage: selectActiveSourceId with agg ids (KTD5)', () => {
  async function seedEligible(): Promise<StorageMock> {
    const mock = installStorage();
    await setAggregateInstances([aggInstance('a1', { name: 'A1', members: ['tavily'] })]);
    await setKey('tavily', 'tvly-key');
    await setRerankConfig({ endpoint: ENDPOINT });
    return mock;
  }

  it('accepts an eligible agg id, writing activeSource only (no activeProvider double-write)', async () => {
    const { store } = await seedEligible();
    await selectActiveSourceId('agg:a1');
    expect(store.get(ACTIVE_SOURCE_KEY)).toBe('agg:a1');
    expect(store.has(ACTIVE_KEY)).toBe(false); // 聚合无 base provider——不双写
    expect(await getActiveSourceId()).toBe('agg:a1');
  });

  it('rejects an unknown agg id with invalid_source', async () => {
    await seedEligible();
    await expect(selectActiveSourceId('agg:missing' as SourceId)).rejects.toThrow('invalid_source');
  });

  it('rejects a defined but ineligible agg id (rerank unconfigured / no valid members)', async () => {
    await setAggregateInstances([aggInstance('a1', { name: 'A1', members: ['tavily'] })]);
    await setKey('tavily', 'tvly-key');
    // rerank 未配置 → ineligible。
    await expect(selectActiveSourceId('agg:a1' as SourceId)).rejects.toThrow('invalid_source');
    // rerank 配置但 0 有效成员（成员 provider 未配 key）→ ineligible。
    await setAggregateInstances([aggInstance('a2', { name: 'A2', members: ['exa'] })]);
    await setRerankConfig({ endpoint: ENDPOINT });
    await expect(selectActiveSourceId('agg:a2' as SourceId)).rejects.toThrow('invalid_source');
  });

  it('derived fallback for an ineligible active agg id is never persisted (hidden-source-still-active)', async () => {
    const { store } = installStorage();
    await setAggregateInstances([aggInstance('a1', { name: 'A1', members: ['tavily'] })]);
    await setKey('tavily', 'tvly-key');
    store.set(ACTIVE_SOURCE_KEY, 'agg:a1');
    // rerank 未配置 → active agg 派生回退到首个已配置 provider（tavily；无 provider 实例 → 裸 id）。
    expect(await getActiveSourceId()).toBe('tavily');
    expect(store.get(ACTIVE_SOURCE_KEY)).toBe('agg:a1'); // 派生视图，绝不持久化写
    // 恢复 rerank → 原激活 agg id 直接复活（存储从未被动过）。
    await setRerankConfig({ endpoint: ENDPOINT });
    expect(await getActiveSourceId()).toBe('agg:a1');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// snapshot 脱敏 aggregate 字段（KTD5）
// ────────────────────────────────────────────────────────────────────────────

describe('snapshot: sanitized aggregate field (KTD5)', () => {
  it('exposes instances + eligibility + rerank status and never the apiKey', async () => {
    installStorage();
    await setAggregateInstances([aggInstance('a1', { name: 'A1', members: ['tavily', 'google'] })]);
    await setKey('tavily', 'tvly-key');
    await setRerankConfig({ endpoint: ENDPOINT, model: 'bge', apiKey: 'sk-local-secret' });

    const snapshot = await getProviderConfigSnapshot();
    expect(snapshot.aggregate.instances.map((i) => i.id)).toEqual(['agg:a1']);
    expect(snapshot.aggregate.eligibility['agg:a1']).toEqual({ eligible: true, validMembers: 2 });
    // hasApiKey 是脱敏布尔标志（Lane G）：只暴露「已配置与否」，永不暴露值。
    expect(snapshot.aggregate.rerank).toEqual({ configured: true, hasApiKey: true, endpoint: ENDPOINT, model: 'bge' });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('sk-local-secret');
    // 值字段绝不出现（带引号的键名/裸值）；hasApiKey 脱敏标志本身合法存在。
    expect(serialized).not.toContain('"apiKey"');
    expect(serialized).toContain('"hasApiKey":true');
  });

  it('marks instances ineligible while rerank is unconfigured', async () => {
    installStorage();
    await setAggregateInstances([aggInstance('a1', { name: 'A1', members: ['tavily'] })]);
    await setKey('tavily', 'tvly-key');

    const snapshot = await getProviderConfigSnapshot();
    expect(snapshot.aggregate.eligibility['agg:a1']).toEqual({ eligible: false, validMembers: 1 });
    expect(snapshot.aggregate.rerank).toEqual({ configured: false, hasApiKey: false });
    // activeSource 派生回退（agg ineligible）→ 首个已配置 provider（tavily；无实例 → 裸 id）。
    expect(snapshot.activeSourceId).toBe('tavily');
  });

  it('falls back consistently for empty and malformed storage', async () => {
    installStorage();
    const empty = await emptyAggregate();
    installStorage({ [AGGREGATE_INSTANCES_KEY]: 'garbage', [RERANK_CONFIG_KEY]: { endpoint: 42 } });
    const garbage = await emptyAggregate();
    expect(garbage).toEqual(empty);
    expect(empty).toEqual({ instances: [], eligibility: {}, rerank: { configured: false, hasApiKey: false } });
  });

  async function emptyAggregate(): Promise<AggregateConfigSnapshot> {
    return (await getProviderConfigSnapshot()).aggregate;
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 聚合 helpers 与 rerank 键登记
// ────────────────────────────────────────────────────────────────────────────

describe('aggregateSourcesOf helper', () => {
  it('maps snapshot instances to projection input and tolerates a missing field', () => {
    expect(aggregateSourcesOf(undefined)).toEqual([]);
    const snapshot: AggregateConfigSnapshot = {
      instances: [aggInstance('a1', { name: 'A1' })],
      eligibility: { 'agg:a1': { eligible: true, validMembers: 1 } },
      rerank: { configured: true, hasApiKey: false, endpoint: ENDPOINT },
    };
    expect(aggregateSourcesOf(snapshot)).toEqual([{ id: 'agg:a1', name: 'A1', eligible: true }]);
  });

  it('round-trips the rerank config through its registered key', async () => {
    installStorage();
    await setRerankConfig({ endpoint: ENDPOINT, apiKey: 'sk' });
    expect(await getRerankConfig()).toEqual({ endpoint: ENDPOINT, apiKey: 'sk' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AE9 全链路（Lane G）：删光 → 组消失/order/hidden/activeSource 剥落回退 → 重建 → 再搜成功。
// 跨 store（aggregate-instance-store CRUD + source 图剥落）/ gateway（handleAggregateSearch
// 真实存储 + 真实 tavily adapter + 真实 rerank-client，仅 stub 全局 fetch）/ 投影
// （getProviderConfigSnapshot → allSources）的串联场景。聚合实例按 KTD18 显式分歧**无独苗
// 保护、允许删光、无自动创建**。
// ────────────────────────────────────────────────────────────────────────────

/** 按 URL 路由的 fetch 替身：127.0.0.1:8000 → rerank；其余 → tavily 搜索响应。 */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('http://127.0.0.1:8000')) {
      return res(200, { results: [{ index: 0, relevance_score: 0.9 }] });
    }
    return res(200, { results: [{ title: 'T1', url: 'https://t.test/1', content: 'snippet one' }] });
  }));
}

describe('AE9 full chain: delete-all → spall/fallback → recreate → search succeeds', () => {
  function aggChipIds(snapshot: Awaited<ReturnType<typeof getProviderConfigSnapshot>>): string[] {
    const sources = allSources(
      snapshot.configuredProviderIds,
      snapshot.sourceOrder,
      snapshot.sourceHidden,
      snapshot.siteInstances,
      snapshot.customEngines,
      snapshot.providerInstances,
      aggregateSourcesOf(snapshot.aggregate),
    );
    return sources.filter((s) => s.kind === 'aggregate-instance').map((s) => s.id);
  }

  it('deleting every instance empties the group and spalls order/hidden/active; a recreated instance is projected and searchable', async () => {
    installStorage();
    await setKey('tavily', 'tvly-key');
    await setRerankConfig({ endpoint: ENDPOINT });
    const first = await createAggregateInstance({ name: 'A1', members: ['tavily'], topN: 10 });
    const second = await createAggregateInstance({ name: 'A2', members: ['tavily'], topN: 10 });
    await selectActiveSourceId(second.id);

    // 前置：两枚 eligible chip 均投影（存储序），active = second。
    const before = await getProviderConfigSnapshot();
    expect(aggChipIds(before)).toEqual([first.id, second.id]);
    expect(before.activeSourceId).toBe(second.id);

    // 删光（AE9 清零合法，无独苗保护，走 gateway handler = 用户路径）→ order/hidden 剥落被删
    // id、activeSource 剥落回退（聚合无 base provider，不双写 activeProvider——store 内部走
    // visibleUsableSource 兜底）；gateway 同步精确失效该实例的聚合缓存条目（KTD9）。
    await handleDeleteAggregateInstance(second.id);
    await handleDeleteAggregateInstance(first.id);

    const mid = await getProviderConfigSnapshot();
    expect(mid.aggregate.instances).toEqual([]);
    expect(mid.sourceOrder).not.toContain(first.id);
    expect(mid.sourceOrder).not.toContain(second.id);
    expect(mid.sourceHidden).not.toContain(first.id);
    expect(mid.activeSourceId).toBe('tavily'); // 回退到首个可用源（tavily 已配 key、无实例 → 裸 id）
    expect(aggChipIds(mid)).toEqual([]); // 聚合组不再承载任何 chip（组消失的投影语义）

    // 重建新实例 → 定义集/eligibility/order 补尾/chip 投影全部恢复，且可重新选为 active。
    const rebuilt = await createAggregateInstance({ name: 'A3', members: ['tavily'], topN: 20 });
    const after = await getProviderConfigSnapshot();
    expect(after.aggregate.instances.map((i) => i.id)).toEqual([rebuilt.id]);
    expect(after.aggregate.eligibility[rebuilt.id]).toEqual({ eligible: true, validMembers: 1 });
    expect(after.sourceOrder[after.sourceOrder.length - 1]).toBe(rebuilt.id);
    expect(aggChipIds(after)).toEqual([rebuilt.id]);
    await selectActiveSourceId(rebuilt.id);
    expect(await getActiveSourceId()).toBe(rebuilt.id);

    // 再搜成功（store → gateway 串联）：真实扇出/合并/rerank，响应含成员状态与 score。
    stubFetch();
    const reply = await handleAggregateSearch({ instanceId: rebuilt.id, query: 'hello' });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.response.kind).toBe('aggregate');
    expect(reply.response.instanceId).toBe(rebuilt.id);
    expect(reply.response.members).toEqual([{ sourceId: 'tavily', ok: true, resultCount: 1 }]);
    expect(reply.response.results[0]).toMatchObject({ url: 'https://t.test/1', sources: ['tavily'], score: 0.9 });
    expect(reply.cache.hit).toBe(false);
    // 整条聚合缓存已落盘（AE7 历史回放的前提：实例 id 即缓存键）。
    const savedEntry = await getCachedSearch(rebuilt.id, 'hello');
    expect(savedEntry && isAggregateCacheEntry(savedEntry)).toBe(true);

    // 删掉刚重建的实例后，其缓存条目被精确失效（KTD9/AE5 第一行），再搜该 id → unknown。
    await handleDeleteAggregateInstance(rebuilt.id);
    expect(await getCachedSearch(rebuilt.id, 'hello')).toBeNull();
    const gone = await handleAggregateSearch({ instanceId: rebuilt.id, query: 'hello' });
    expect(gone.ok).toBe(false);
    if (gone.ok) return;
    expect(gone.error.kind).toBe('unknown');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Oracle #1（实现复审 must）：导入替换聚合实例集的陈旧缓存缝隙。
// 导出文件逐字携带实例 id——同一 `agg:xxx` 换 members 导入后 id 不变，旧 `agg:xxx:query`
// 条目若不清池会带着旧成员组合存活（同一变更经 options 编辑路径会精确失效，导入路径此前
// 绕过了它）。修复 = 集合实际替换 → deleteAggregateCacheEntries('all')。
// ────────────────────────────────────────────────────────────────────────────
describe('import cache gap: same-id member change invalidates aggregate entries (Oracle #1)', () => {
  it('drops the cached aggregate entry when an import replaces an instance with the same id but different members', async () => {
    installStorage();
    await setKey('tavily', 'tvly-key');
    await setRerankConfig({ endpoint: ENDPOINT });
    const instance = await createAggregateInstance({ name: 'A1', members: ['tavily'], topN: 10 });

    // 经真实聚合搜索路径写入整条聚合缓存。
    stubFetch();
    const reply = await handleAggregateSearch({ instanceId: instance.id, query: 'hello' });
    expect(reply.ok).toBe(true);
    expect(await getCachedSearch(instance.id, 'hello')).not.toBeNull();

    // 导入同一 id（导出文件逐字携带 id）、不同 members 的备份 → 该实例的聚合缓存条目必须消失。
    const report = await mergeImport({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: 1,
      appVersion: 'test',
      providerKeys: {},
      activeProvider: null,
      activeSource: 'google',
      themePref: 'auto',
      localePref: 'auto',
      siteInstances: [],
      aggregateInstances: [{ id: instance.id, name: 'A1', members: ['exa'], topN: 10 }],
    }, { applyPrefs: true });

    expect(report.aggregateInstancesOverridden).toBe(true);
    expect(await getCachedSearch(instance.id, 'hello')).toBeNull();
  });
});
