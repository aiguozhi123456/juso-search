import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ACTIVE_SOURCE_KEY,
  AGGREGATE_INSTANCES_KEY,
  createAggregateInstance,
  deleteAggregateInstance,
  getAggregateInstances,
  getRerankConfig,
  RERANK_CONFIG_KEY,
  setAggregateInstances,
  setRerankConfig,
  setSourceOrder,
  SOURCE_HIDDEN_KEY,
  SOURCE_ORDER_KEY,
  updateAggregateInstance,
} from '@/lib/storage';
import { normalizeAggregateInstances } from '@/lib/aggregate-instances';
import type { AggregateInstance } from '@/lib/aggregate-instances';

/**
 * 聚合实例 store CRUD 回归（KTD10/KTD18）：双队列串行、create 追加 sourceOrder 尾部、
 * delete 剥离 order/hidden + activeSource 派生回退、无独苗保护。
 * mock 内存 storage，沿 tests/storage.test.ts 与 tests/storage-lock-order.test.ts 的既有模式。
 */

interface StorageMock {
  store: Map<string, unknown>;
  writeLog: string[][];
  blockNextSetOf(key: string): { resolve: () => void };
}

function installStorage(): StorageMock {
  const store = new Map<string, unknown>();
  const writeLog: string[][] = [];
  let gate: { key: string; used: boolean; promise: Promise<void>; resolve: () => void } | null = null;

  function blockNextSetOf(key: string): { resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    gate = { key, used: false, promise, resolve };
    return { resolve: gate.resolve };
  }

  vi.stubGlobal('browser', {
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          if (typeof keys === 'string') {
            return store.has(keys) ? { [keys]: store.get(keys) } : {};
          }
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (store.has(k)) out[k] = store.get(k);
            return out;
          }
          return {};
        },
        async set(items: Record<string, unknown>) {
          const keys = Object.keys(items);
          writeLog.push(keys);
          if (gate && !gate.used && keys.includes(gate.key)) {
            gate.used = true;
            await gate.promise;
          }
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        },
      },
    },
  });

  return { store, writeLog, blockNextSetOf };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aggregate instance store: create', () => {
  it('persists a normalized instance and appends its id to the sourceOrder tail', async () => {
    const mock = installStorage();

    const first = await createAggregateInstance({ name: '全家桶', members: ['tavily', 'google'], topN: 10 });
    const second = await createAggregateInstance({ name: '  技术区  ', members: ['exa', 'bing', 'bing'] });

    const instances = await getAggregateInstances();
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({ id: first.id, name: '全家桶', members: ['tavily', 'google'], topN: 10 });
    // members 首现去重 + name trim + topN 缺省钳位物化。
    expect(instances[1]).toMatchObject({ name: '技术区', members: ['exa', 'bing'], topN: 20 });

    // 新实例 id 依创建序追加在 sourceOrder 尾部（手术式 append：Lane C 前 normalizeSourceOrder
    // 不认识 agg: id，故对原始存储断言而非 getSourceOrder）。
    const rawOrder = mock.store.get(SOURCE_ORDER_KEY) as string[];
    expect(rawOrder[rawOrder.length - 2]).toBe(first.id);
    expect(rawOrder[rawOrder.length - 1]).toBe(second.id);
  });

  it('serializes behind an in-flight source-queue write (双队列锁序：source → aggregate)', async () => {
    const mock = installStorage();
    const gate = mock.blockNextSetOf(SOURCE_ORDER_KEY);

    const pA = setSourceOrder(['bing', 'google']);
    const pB = createAggregateInstance({ name: 'Agg', members: ['google'] });

    await new Promise((r) => setTimeout(r, 20));
    // B 的 mutation 体尚未开始：没有写日志，存储里也没有聚合实例键。
    expect(mock.writeLog.some((keys) => keys.includes(AGGREGATE_INSTANCES_KEY))).toBe(false);
    expect(mock.store.has(AGGREGATE_INSTANCES_KEY)).toBe(false);

    gate.resolve();
    const created = await pB;
    await pA;

    const instances = await getAggregateInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ id: created.id, name: 'Agg' });
    const rawOrder = mock.store.get(SOURCE_ORDER_KEY) as string[];
    expect(rawOrder[0]).toBe('bing');
    expect(rawOrder[1]).toBe('google');
    expect(rawOrder[rawOrder.length - 1]).toBe(created.id);

    // 串行化：A 的唯一一次写完成后才开始 B 的写（锁序 source 队列 → 实例队列）。
    const aWrite = mock.writeLog.findIndex((keys) => keys.length === 1 && keys[0] === SOURCE_ORDER_KEY);
    const bWrite = mock.writeLog.findIndex((keys) => keys.includes(AGGREGATE_INSTANCES_KEY));
    expect(aWrite).toBeGreaterThanOrEqual(0);
    expect(bWrite).toBeGreaterThan(aWrite);
  });

  it('rejects creation when the collection would exceed its byte budget', async () => {
    const mock = installStorage();
    // 用海量形状合法的 provider 实例成员撑爆字节预算（垃圾字段会被归一化剥掉，撑不爆）。
    const fatMembers = Array.from({ length: 8000 }, (_, i) => `inst:exa:m${i}`);
    mock.store.set(AGGREGATE_INSTANCES_KEY, [
      { id: 'agg:fat1', name: 'Fat1', members: fatMembers, topN: 20 },
      { id: 'agg:fat2', name: 'Fat2', members: fatMembers, topN: 20 },
    ]);
    // 预置集合字节超限，但 trusted 读归一化照常保留（绝不当空）。
    expect(normalizeAggregateInstances(mock.store.get(AGGREGATE_INSTANCES_KEY))).toHaveLength(2);

    await expect(createAggregateInstance({ name: 'X', members: ['tavily'] })).rejects.toThrow('invalid_aggregate_instance');
    // 失败的 create 不得清掉已有的 oversize 内容（安全持久化三不变量）。
    expect(normalizeAggregateInstances(mock.store.get(AGGREGATE_INSTANCES_KEY))).toHaveLength(2);
  });
});

describe('aggregate instance store: update / delete', () => {
  async function seedTwoInstances(mock: StorageMock): Promise<{ a: AggregateInstance; b: AggregateInstance }> {
    const a: AggregateInstance = { id: 'agg:aaa', name: 'A', members: ['google'], topN: 10 };
    const b: AggregateInstance = { id: 'agg:bbb', name: 'B', members: ['tavily'], topN: 15 };
    mock.store.set(AGGREGATE_INSTANCES_KEY, [a, b]);
    mock.store.set(SOURCE_ORDER_KEY, ['google', a.id, b.id, 'bing']);
    mock.store.set(SOURCE_HIDDEN_KEY, [a.id]);
    return { a, b };
  }

  it('updates name/members/topN without touching order or siblings', async () => {
    const mock = installStorage();
    const { a } = await seedTwoInstances(mock);

    const updated = await updateAggregateInstance(a.id, { name: '  A2  ', members: ['brave'], topN: 99 });
    expect(updated).toMatchObject({ id: a.id, name: 'A2', members: ['brave'], topN: 20 });

    const instances = await getAggregateInstances();
    expect(instances.map((i) => i.id)).toEqual(['agg:aaa', 'agg:bbb']);
    expect(mock.store.get(SOURCE_ORDER_KEY)).toEqual(['google', 'agg:aaa', 'agg:bbb', 'bing']);
  });

  it('returns null when updating an unknown id', async () => {
    const mock = installStorage();
    await seedTwoInstances(mock);
    await expect(updateAggregateInstance('agg:missing', { name: 'X' })).resolves.toBeNull();
  });

  it('strips only the deleted id from order/hidden and keeps sibling aggregate ids (KTD4 分层铁律)', async () => {
    const mock = installStorage();
    const { b } = await seedTwoInstances(mock);

    await deleteAggregateInstance(b.id);

    const instances = await getAggregateInstances();
    expect(instances.map((i) => i.id)).toEqual(['agg:aaa']);
    // Lane C 折叠后 delete 走 normalizeSourceOrder 直调（定义集 = 删除后实例集）：
    // 被删 id 剥落、兄弟保留、既有相对序不动；静态默认项按 normalize 补尾语义追加。
    const order = mock.store.get(SOURCE_ORDER_KEY) as string[];
    expect(order.slice(0, 3)).toEqual(['google', 'agg:aaa', 'bing']);
    expect(order).not.toContain('agg:bbb');
    expect(mock.store.get(SOURCE_HIDDEN_KEY)).toEqual(['agg:aaa']);
  });

  it('falls back activeSource to the first visible usable source when the active instance is deleted', async () => {
    const mock = installStorage();
    const { b } = await seedTwoInstances(mock);
    mock.store.set(ACTIVE_SOURCE_KEY, b.id);

    await deleteAggregateInstance(b.id);

    // order=['google','agg:aaa','bing'], hidden=['agg:aaa'] → 首个可见可用源 = google（engine 恒可用）。
    // 仅写 activeSource，不双写 activeProvider（聚合无 base provider，KTD5 显式分歧）。
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('google');
  });

  it('leaves activeSource untouched when another instance is deleted', async () => {
    const mock = installStorage();
    const { a, b } = await seedTwoInstances(mock);
    mock.store.set(ACTIVE_SOURCE_KEY, a.id);

    await deleteAggregateInstance(b.id);

    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe(a.id);
  });

  it('allows deleting the last instance (无独苗保护，AE9 清零)', async () => {
    const mock = installStorage();
    mock.store.set(AGGREGATE_INSTANCES_KEY, [{ id: 'agg:solo', name: 'Solo', members: ['google'], topN: 20 }]);
    mock.store.set(SOURCE_ORDER_KEY, ['google', 'agg:solo']);
    mock.store.set(SOURCE_HIDDEN_KEY, ['agg:solo']);
    mock.store.set(ACTIVE_SOURCE_KEY, 'agg:solo');

    await deleteAggregateInstance('agg:solo');

    expect(await getAggregateInstances()).toEqual([]);
    // normalize 直调：被删 id 剥落，google 存活（静态默认项按 normalize 补尾语义追加）。
    const order = mock.store.get(SOURCE_ORDER_KEY) as string[];
    expect(order).toContain('google');
    expect(order).not.toContain('agg:solo');
    expect(mock.store.get(SOURCE_HIDDEN_KEY)).toEqual([]);
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('google');
  });

  it('is a no-op when deleting an unknown id', async () => {
    const mock = installStorage();
    await seedTwoInstances(mock);
    mock.store.set(ACTIVE_SOURCE_KEY, 'agg:aaa');

    await expect(deleteAggregateInstance('agg:missing')).resolves.toBeUndefined();
    expect(normalizeAggregateInstances(mock.store.get(AGGREGATE_INSTANCES_KEY))).toHaveLength(2);
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('agg:aaa');
  });
});

describe('aggregate instance store: collection setter + rerank config', () => {
  it('setAggregateInstances normalizes on write', async () => {
    const mock = installStorage();
    const valid: AggregateInstance = { id: 'agg:ok', name: 'OK', members: ['tavily'], topN: 7 };
    await setAggregateInstances([valid, null as unknown as AggregateInstance, valid]);
    expect(await getAggregateInstances()).toEqual([valid]);
    expect(mock.store.get(AGGREGATE_INSTANCES_KEY)).toEqual([valid]);
  });

  it('getRerankConfig falls back to the unconfigured default and round-trips a set', async () => {
    installStorage();
    expect(await getRerankConfig()).toEqual({ endpoint: '' });

    await setRerankConfig({ endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge', apiKey: 'sk-local' });
    expect(await getRerankConfig()).toEqual({ endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge', apiKey: 'sk-local' });

    // 畸形覆盖值归一兜底，不落垃圾。
    await setRerankConfig({ endpoint: '' });
    expect(await getRerankConfig()).toEqual({ endpoint: '' });
  });

  it('keeps rerank config under its registered key', async () => {
    const mock = installStorage();
    await setRerankConfig({ endpoint: 'http://127.0.0.1:9/v1/rerank' });
    expect(mock.store.has(RERANK_CONFIG_KEY)).toBe(true);
  });
});
