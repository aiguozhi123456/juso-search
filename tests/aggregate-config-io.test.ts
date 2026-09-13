import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACTIVE_SOURCE_KEY,
  AGGREGATE_INSTANCES_KEY,
  RERANK_CONFIG_KEY,
  SOURCE_HIDDEN_KEY,
  SOURCE_ORDER_KEY,
} from '@/lib/storage';
import {
  buildExportPayload,
  mergeImport,
  parseImportPayload,
  previewImport,
  type ConfigExport,
} from '@/lib/config-io';
import { CURRENT_SCHEMA_VERSION } from '@/lib/schema';
import type { AggregateInstance } from '@/lib/aggregate-instances';
import type { SourceId } from '@/lib/sources';

// config-io 聚合接线回归（KTD13 + Oracle F3/F5 + AE6）：
// 导出两键、导入非法拒收、缺失 preserve（agg id 在 order/hidden/activeSource 存活）、
// applyPrefs 整数组替换、apiKey 仅填空、endpoint/model 变更触发全聚合失效、preview 无 apiKey。
// 聚合缓存删除经 mock 的 search-cache-store 观测；其余 storage 为内存实现。

vi.mock('@/lib/storage/search-cache-store', () => ({
  getSearchCacheSummaries: vi.fn().mockResolvedValue([]),
  getCachedSearch: vi.fn().mockResolvedValue(null),
  getCachedSearchEntry: vi.fn().mockResolvedValue(null),
  saveCachedSearch: vi.fn(),
  deleteCachedSearch: vi.fn(),
  clearSearchCache: vi.fn(),
  saveCachedAggregateSearch: vi.fn(),
  deleteAggregateCacheEntries: vi.fn().mockResolvedValue(undefined),
}));

import { deleteAggregateCacheEntries } from '@/lib/storage';

const mockedDeleteAggregateCacheEntries = vi.mocked(deleteAggregateCacheEntries);

function installStorage(seed: Record<string, unknown> = {}): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed));
  vi.stubGlobal('browser', {
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
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

function aggInstance(id: string, overrides: Partial<AggregateInstance> = {}): AggregateInstance {
  return { id: `agg:${id}`, name: `Name-${id}`, members: ['tavily', 'exa'], topN: 10, ...overrides };
}

function validPayload(overrides: Partial<ConfigExport> = {}): ConfigExport {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: 123,
    appVersion: '1.0.0',
    providerKeys: {},
    activeProvider: null,
    activeSource: 'google',
    themePref: 'auto',
    localePref: 'auto',
    siteInstances: [],
    ...overrides,
  };
}

const ENDPOINT_A = 'http://127.0.0.1:8000/v1/rerank';
const ENDPOINT_B = 'http://127.0.0.1:9000/v1/rerank';

beforeEach(() => {
  installStorage();
  mockedDeleteAggregateCacheEntries.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildExportPayload: aggregate keys (KTD13/AE6)', () => {
  it('exports aggregateInstances and rerankConfig with the plaintext apiKey', async () => {
    installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggInstance('e1', { topN: 12 })],
      [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge-reranker-base', apiKey: 'sk-local-secret' },
    });

    const payload = await buildExportPayload();

    expect(payload.aggregateInstances).toEqual([aggInstance('e1', { topN: 12 })]);
    expect(payload.rerankConfig).toEqual({ endpoint: ENDPOINT_A, model: 'bge-reranker-base', apiKey: 'sk-local-secret' });
  });

  it('exports unconfigured rerank and empty aggregate collection as explicit defaults', async () => {
    const payload = await buildExportPayload();
    expect(payload.aggregateInstances).toEqual([]);
    expect(payload.rerankConfig).toEqual({ endpoint: '' });
  });

  it('keeps local agg ids in the exported sourceOrder/sourceHidden (F3 ②, export side)', async () => {
    installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggInstance('e1')],
      [SOURCE_ORDER_KEY]: ['google', 'bing', 'agg:e1'],
      [SOURCE_HIDDEN_KEY]: ['agg:e1'],
    });

    const payload = await buildExportPayload();

    expect(payload.sourceOrder).toContain('agg:e1');
    expect(payload.sourceHidden).toContain('agg:e1');
  });
});

// agg id 尚不在 SourceId 联合内（Lane C 接线），构造带 agg id 的 payload 用窄化辅助。
const aggIds = (ids: string[]): SourceId[] => ids as SourceId[];
const aggId = (id: string): SourceId => id as string as SourceId;

describe('parseImportPayload: aggregate validation (KTD13)', () => {
  it('rejects an invalid aggregateInstances collection', () => {
    // 逐条非法（name 空 → normalize 丢弃）→ 长度不等值。
    const bad = validPayload({ aggregateInstances: [{ id: 'agg:x', name: '', members: [], topN: 10 }] as never });
    expect(parseImportPayload(bad)).toEqual({ ok: false, error: 'invalid_aggregate_instances' });

    // 超容量 → isBounded 拒收。
    const oversized = validPayload({ aggregateInstances: Array.from({ length: 51 }, (_, i) => aggInstance(`x${i}`)) });
    expect(parseImportPayload(oversized)).toEqual({ ok: false, error: 'invalid_aggregate_instances' });

    // 重复 id → 首现去重后长度不等值。
    const dup = validPayload({ aggregateInstances: [aggInstance('d1'), aggInstance('d1')] });
    expect(parseImportPayload(dup)).toEqual({ ok: false, error: 'invalid_aggregate_instances' });
  });

  it('rejects a rerankConfig endpoint that violates the loopback rule and rewrites localhost', () => {
    const remote = validPayload({ rerankConfig: { endpoint: 'http://example.com/v1/rerank' } });
    expect(parseImportPayload(remote)).toEqual({ ok: false, error: 'invalid_rerank_config' });

    const https = validPayload({ rerankConfig: { endpoint: 'https://127.0.0.1:8000/v1/rerank' } });
    expect(parseImportPayload(https)).toEqual({ ok: false, error: 'invalid_rerank_config' });

    const parsed = parseImportPayload(validPayload({ rerankConfig: { endpoint: 'http://localhost:8000/v1/rerank', model: 'bge', apiKey: 'sk' } }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.rerankConfig).toEqual({ endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk' });

    // 未配置态（endpoint ''）合法放行。
    const unconfigured = parseImportPayload(validPayload({ rerankConfig: { endpoint: '' } }));
    expect(unconfigured.ok).toBe(true);
  });

  it('accepts agg ids in sourceOrder/activeSource only when the payload carries the instance set', () => {
    const withSet = parseImportPayload(validPayload({
      aggregateInstances: [aggInstance('p1')],
      sourceOrder: aggIds(['google', 'agg:p1']),
      activeSource: aggId('agg:p1'),
    }));
    expect(withSet.ok).toBe(true);
    if (withSet.ok) {
      expect(withSet.value.sourceOrder).toContain('agg:p1');
      expect(withSet.value.activeSource).toBe('agg:p1');
    }

    const withoutSet = parseImportPayload(validPayload({ sourceOrder: aggIds(['google', 'agg:p1']) }));
    expect(withoutSet).toEqual({ ok: false, error: 'invalid_source_order' });
  });
});

describe('mergeImport: F3 preserve semantics', () => {
  it('keeps local aggregateInstances, their order/hidden ids, and the agg activeSource when the payload lacks the collection', async () => {
    const { store } = installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggInstance('local', { name: '本地聚合', members: ['tavily'] })],
      [SOURCE_ORDER_KEY]: ['google', 'bing', 'agg:local'],
      [SOURCE_HIDDEN_KEY]: ['agg:local'],
      [ACTIVE_SOURCE_KEY]: 'agg:local',
    });

    const report = await mergeImport(validPayload({ sourceOrder: ['bing', 'google'], sourceHidden: ['bing'] }), { applyPrefs: true });

    expect((store.get(AGGREGATE_INSTANCES_KEY) as AggregateInstance[]).map((i) => i.id)).toEqual(['agg:local']);
    // F3 ②：本地 order/hidden 中的 agg id 不剥落（normalize 后回注；normalize 会按已知集补尾，
    // 故断言头部 payload 序与尾部 agg id 保留，而非整表相等）。
    const order = store.get(SOURCE_ORDER_KEY) as string[];
    expect(order.slice(0, 2)).toEqual(['bing', 'google']);
    expect(order.at(-1)).toBe('agg:local');
    expect(store.get(SOURCE_HIDDEN_KEY)).toEqual(['bing', 'agg:local']);
    // F3 ①：本地 agg activeSource 保留。
    expect(store.get(ACTIVE_SOURCE_KEY)).toBe('agg:local');
    expect(report.aggregateInstancesOverridden).toBe(false);
  });

  it('does not preserve local agg ids when the payload replaces the aggregate collection', async () => {
    const { store } = installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggInstance('local')],
      [SOURCE_ORDER_KEY]: ['google', 'agg:local'],
      [SOURCE_HIDDEN_KEY]: ['agg:local'],
    });

    await mergeImport(validPayload({
      aggregateInstances: [aggInstance('fresh')],
      sourceOrder: aggIds(['bing', 'agg:fresh']),
    }), { applyPrefs: true });

    expect((store.get(AGGREGATE_INSTANCES_KEY) as AggregateInstance[]).map((i) => i.id)).toEqual(['agg:fresh']);
    // 被替换集合的本地 agg id 剥落；导入定义集内的 agg id 经保留回注（normalize 补尾在其后）。
    const order = store.get(SOURCE_ORDER_KEY) as string[];
    expect(order[0]).toBe('bing');
    expect(order).not.toContain('agg:local');
    expect(order).toContain('agg:fresh');
    expect(store.get(SOURCE_HIDDEN_KEY)).toEqual([]);
  });
});

describe('mergeImport: applyPrefs replacement semantics (KTD13)', () => {
  it('replaces the whole aggregate collection only when it actually differs', async () => {
    const { store } = installStorage({ [AGGREGATE_INSTANCES_KEY]: [aggInstance('local')] });

    const report = await mergeImport(validPayload({ aggregateInstances: [aggInstance('imported', { topN: 20 })] }), { applyPrefs: true });

    expect((store.get(AGGREGATE_INSTANCES_KEY) as AggregateInstance[]).map((i) => i.id)).toEqual(['agg:imported']);
    expect(report.aggregateInstancesOverridden).toBe(true);

    // 深度相等 → 不写、不报 overridden。
    const untouched = await mergeImport(validPayload({ aggregateInstances: [aggInstance('imported', { topN: 20 })] }), { applyPrefs: true });
    expect(untouched.aggregateInstancesOverridden).toBe(false);
  });

  it('leaves aggregateInstances untouched without applyPrefs', async () => {
    const { store } = installStorage({ [AGGREGATE_INSTANCES_KEY]: [aggInstance('local')] });

    await mergeImport(validPayload({ aggregateInstances: [aggInstance('imported')] }), { applyPrefs: false });

    expect((store.get(AGGREGATE_INSTANCES_KEY) as AggregateInstance[]).map((i) => i.id)).toEqual(['agg:local']);
  });

  it('invalidates the aggregate cache when the import replaces the collection (Oracle #1 缝隙)', async () => {
    // 导出文件逐字携带实例 id：同一 `agg:same` 换 members 导入后 id 不变，旧 `agg:same:query`
    // 条目若不清池会在下次搜索命中旧成员组合（实例 id 即缓存键 ⇒ 集合替换 = 内容可能已变）。
    const { store } = installStorage({ [AGGREGATE_INSTANCES_KEY]: [aggInstance('same')] });

    const report = await mergeImport(validPayload({ aggregateInstances: [aggInstance('same', { members: ['brave'] })] }), { applyPrefs: true });

    expect(report.aggregateInstancesOverridden).toBe(true);
    expect((store.get(AGGREGATE_INSTANCES_KEY) as AggregateInstance[])[0].members).toEqual(['brave']);
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledWith('all');

    // 深度相等（无实际替换）→ 不失效。
    mockedDeleteAggregateCacheEntries.mockClear();
    await mergeImport(validPayload({ aggregateInstances: [aggInstance('same', { members: ['brave'] })] }), { applyPrefs: true });
    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();
  });
});

describe('mergeImport: rerankConfig merge + cache invalidation (KTD9/F5)', () => {
  it('fills an empty apiKey regardless of applyPrefs and never invalidates for apiKey-only changes', async () => {
    const { store } = installStorage({ [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge' } });

    await mergeImport(validPayload({ rerankConfig: { endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk-new' } }), { applyPrefs: false });

    expect(store.get(RERANK_CONFIG_KEY)).toEqual({ endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk-new' });
    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();
  });

  it('never overwrites an existing apiKey (fill-blank only)', async () => {
    const { store } = installStorage({ [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk-old' } });

    const report = await mergeImport(validPayload({ rerankConfig: { endpoint: ENDPOINT_B, model: 'm2', apiKey: 'sk-imported' } }), { applyPrefs: true });

    expect(store.get(RERANK_CONFIG_KEY)).toEqual({ endpoint: ENDPOINT_B, model: 'm2', apiKey: 'sk-old' });
    expect(report.rerankConfigOverridden).toBe(true);
    // F5：endpoint/model 实际变更 → 全部聚合缓存条目失效。
    expect(mockedDeleteAggregateCacheEntries).toHaveBeenCalledWith('all');
  });

  it('does not invalidate when endpoint and model are unchanged', async () => {
    installStorage({ [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge' } });

    await mergeImport(validPayload({ rerankConfig: { endpoint: ENDPOINT_A, model: 'bge' } }), { applyPrefs: true });

    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();
  });

  it('applies endpoint/model changes only with applyPrefs', async () => {
    const { store } = installStorage({ [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge' } });

    await mergeImport(validPayload({ rerankConfig: { endpoint: ENDPOINT_B } }), { applyPrefs: false });

    expect(store.get(RERANK_CONFIG_KEY)).toEqual({ endpoint: ENDPOINT_A, model: 'bge' });
    expect(mockedDeleteAggregateCacheEntries).not.toHaveBeenCalled();
  });
});

describe('previewImport: aggregate diffs (KTD13/AE6)', () => {
  it('summarizes instances as id:name:成员数:topN and never shows the apiKey', async () => {
    installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggInstance('local', { name: '本地', topN: 5 })],
      [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk-local-secret' },
    });

    const preview = await previewImport(validPayload({
      aggregateInstances: [aggInstance('new', { name: '导入聚合', members: ['tavily', 'exa', 'brave'], topN: 15 })],
      rerankConfig: { endpoint: ENDPOINT_B, model: 'bge', apiKey: 'sk-imported-secret' },
    }));

    const aggDiff = preview.prefDiffs.find((diff) => diff.key === 'aggregateInstances');
    expect(aggDiff).toEqual({
      key: 'aggregateInstances',
      from: 'agg:local:本地:2:5',
      to: 'agg:new:导入聚合:3:15',
    });
    const rerankDiff = preview.prefDiffs.find((diff) => diff.key === 'rerankConfig');
    expect(rerankDiff).toEqual({ key: 'rerankConfig', from: `${ENDPOINT_A}:bge`, to: `${ENDPOINT_B}:bge` });
    // apiKey 绝不进预览（本地或导入值都不出现）。
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain('sk-local-secret');
    expect(serialized).not.toContain('sk-imported-secret');
    expect(serialized).not.toContain('apiKey');
  });

  it('omits the diffs when the collections and endpoint/model match', async () => {
    installStorage({
      [AGGREGATE_INSTANCES_KEY]: [aggInstance('same')],
      [RERANK_CONFIG_KEY]: { endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk-old' },
    });

    const preview = await previewImport(validPayload({
      aggregateInstances: [aggInstance('same')],
      rerankConfig: { endpoint: ENDPOINT_A, model: 'bge', apiKey: 'sk-new' },
    }));

    expect(preview.prefDiffs.find((diff) => diff.key === 'aggregateInstances')).toBeUndefined();
    expect(preview.prefDiffs.find((diff) => diff.key === 'rerankConfig')).toBeUndefined();
  });
});
