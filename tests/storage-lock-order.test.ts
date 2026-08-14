import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SOURCE_ORDER_KEY,
  PROVIDER_INSTANCES_KEY,
  getSourceOrder,
  setSourceOrder,
  getProviderInstances,
  createProviderInstance,
} from '@/lib/storage';

/**
 * 锁序并发回归：拆分后 source 队列 → instances 队列的串行化不变量。
 *
 * createProviderInstance 内部是 withSourceMutation(() => withProviderInstancesMutation(...))，
 * 任何 source 图写入（如 setSourceOrder）都必须先于它完成。若某条队列意外出现两份实例
 * （模块重复加载/分叉），两笔写并发交错会产生 lost-update：B 以陈旧 order 覆盖 A 的移动，
 * 或 A 覆盖 B 追加的实例 id。
 */

interface StorageMock {
  /** 底层内存存储（断言「尚未写入」用）。 */
  store: Map<string, unknown>;
  /** 每次 browser.storage.local.set 的 key 列表，按调用顺序记录。 */
  writeLog: string[][];
  /** 让指定 key 的下一次 set 挂起，直到返回的 handle.resolve() 被调用（仅首次命中挂起）。 */
  blockNextSetOf(key: string): { resolve: () => void };
}

// 内存版 browser.storage.local（镜像 tests/storage.test.ts 的 installStorage），
// 额外提供受控钩子：set 调用日志 + 对指定 key 首次 set 的 deferred gate。
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
            gate.used = true; // 仅首次命中挂起，后续同 key 的写（如 create 的镜像追加）放行
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

describe('storage lock order: source queue → instances queue', () => {
  it('createProviderInstance waits for an in-flight source-queue write', async () => {
    const mock = installStorage();
    // SOURCE_ORDER_KEY 的首次 set（A 的写）挂在测试控制的 gate 上。
    const gate = mock.blockNextSetOf(SOURCE_ORDER_KEY);

    // A：进入 source 队列，阻塞在 set 上（mutation 未完成 → 队列未释放）。
    const pA = setSourceOrder(['bing', 'google']);
    // B：createProviderInstance 先取 source 队列再取 instances 队列，应被 A 挡住。
    const pB = createProviderInstance('tavily', 'Fast', {});

    await new Promise((r) => setTimeout(r, 20));
    // B 的 mutation 体尚未开始：既没有 set 日志，存储里也没有实例键。
    expect(mock.writeLog.some((keys) => keys.includes(PROVIDER_INSTANCES_KEY))).toBe(false);
    expect(mock.store.has(PROVIDER_INSTANCES_KEY)).toBe(false);

    gate.resolve();
    const created = await pB;
    await pA;

    // 最终态：实例落盘（归一化器填默认），sourceOrder 末尾镜像追加实例 id。
    const instances = await getProviderInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ id: created.id, baseProviderId: 'tavily', name: 'Fast' });
    const order = await getSourceOrder();
    expect(order[0]).toBe('bing');
    expect(order[1]).toBe('google');
    expect(order[order.length - 1]).toBe(created.id);

    // 串行化：A 的唯一一次写（仅 SOURCE_ORDER_KEY）完成后才开始 B 的写（含 PROVIDER_INSTANCES_KEY）。
    const aWrite = mock.writeLog.findIndex((keys) => keys.length === 1 && keys[0] === SOURCE_ORDER_KEY);
    const bWrite = mock.writeLog.findIndex((keys) => keys.includes(PROVIDER_INSTANCES_KEY));
    expect(aWrite).toBeGreaterThanOrEqual(0);
    expect(bWrite).toBeGreaterThan(aWrite);
  });

  it('concurrent setSourceOrder + createProviderInstance lose no writes', async () => {
    installStorage();
    // 不挂 gate：两笔写入并发发起，靠队列串行化。
    const [, created] = await Promise.all([
      setSourceOrder(['bing', 'google']),
      createProviderInstance('tavily', 'Fast', {}),
    ]);

    // 两个写入都落盘：实例存在（B 的写未被 A 覆盖）……
    const instances = await getProviderInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ id: created.id, baseProviderId: 'tavily', name: 'Fast' });
    // ……且 order 同时保留 A 的移动结果与 B 追加的实例 id（A 的写未被 B 以陈旧 order 覆盖）。
    const order = await getSourceOrder();
    expect(order[0]).toBe('bing');
    expect(order[1]).toBe('google');
    expect(order[order.length - 1]).toBe(created.id);
    expect(order.filter((id) => id === created.id)).toHaveLength(1);
  });
});
