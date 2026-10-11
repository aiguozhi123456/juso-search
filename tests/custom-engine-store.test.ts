import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ACTIVE_KEY,
  ACTIVE_SOURCE_KEY,
  AGGREGATE_INSTANCES_KEY,
  createCustomEngineDefinition,
  CUSTOM_ENGINES_KEY,
  deleteCustomEngineDefinition,
  getCustomEngineDefinitions,
  KEYS_KEY,
  PROVIDER_INSTANCES_KEY,
  RERANK_CONFIG_KEY,
  SOURCE_HIDDEN_KEY,
  SOURCE_ORDER_KEY,
  updateCustomEngineDefinition,
} from '@/lib/storage';
import { allEngines } from '@/lib/engines/registry';
import { allAiEngines } from '@/lib/ai-engines/registry';
import type { CustomEngineDefinition } from '@/lib/custom-engines';

/**
 * Custom Engine store 回归：读改写（create/update/delete）+ active source 重指四分支
 * （配置 provider / provider 实例 / 可用聚合 / 全不可用回退 DEFAULT_ENGINE_ID），
 * 以及 delete 后 SOURCE_ORDER_KEY / SOURCE_HIDDEN_KEY 按过滤后定义集重算。
 * OCR 评审指出 tests/gateway.test.ts mock 掉了整个 barrel，本模块此前零覆盖。
 */

// 内存版 browser.storage.local（镜像 tests/aggregate-instance-store.test.ts 的 installStorage）。
function installStorage(seed: Record<string, unknown> = {}): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed));
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
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        },
      },
    },
  });
  return { store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// 全部引擎 + AI engine id（构造「除 custom 外全隐藏」的种子，检验 ensureVisibleUsable 修复路径）。
const ALL_ENGINE_IDS = [...allEngines().map((engine) => engine.id), ...allAiEngines().map((engine) => engine.id)];

function makeCustom(id: string, urlTemplate = 'https://example.com/search?q=%s'): CustomEngineDefinition {
  return { id: id as CustomEngineDefinition['id'], name: `CE ${id}`, urlTemplate };
}

describe('custom engine store: create / update / delete round-trip', () => {
  it('create appends the id to sourceOrder; delete strips it and recomputes hidden', async () => {
    const mock = installStorage();

    const created = await createCustomEngineDefinition(makeCustom('custom:aaa'));
    expect(await getCustomEngineDefinitions()).toEqual([created]);
    expect(mock.store.get(SOURCE_ORDER_KEY)).toContain('custom:aaa');

    await updateCustomEngineDefinition('custom:aaa', { name: 'Renamed', urlTemplate: 'https://other.example.com/?q=%s' });
    expect((await getCustomEngineDefinitions())[0]).toMatchObject({ id: 'custom:aaa', name: 'Renamed' });
    expect(mock.store.get(SOURCE_ORDER_KEY)).toContain('custom:aaa');

    mock.store.set(SOURCE_HIDDEN_KEY, ['custom:aaa', 'baidu']);
    await deleteCustomEngineDefinition('custom:aaa');

    expect(await getCustomEngineDefinitions()).toEqual([]);
    // order/hidden 按过滤后定义集重算：被删 id 剥落，无关 id 保留。
    expect(mock.store.get(SOURCE_ORDER_KEY)).not.toContain('custom:aaa');
    expect(mock.store.get(SOURCE_HIDDEN_KEY)).not.toContain('custom:aaa');
    expect(mock.store.get(SOURCE_HIDDEN_KEY)).toContain('baidu');
  });

  it('rejects a duplicate urlTemplate on create', async () => {
    installStorage();
    await createCustomEngineDefinition(makeCustom('custom:aaa', 'https://dup.example.com/?q=%s'));
    await expect(createCustomEngineDefinition(makeCustom('custom:bbb', 'https://dup.example.com/?q=%s'))).rejects.toThrow('invalid_custom_engine');
  });
});

describe('custom engine store: active source re-pointing on delete', () => {
  it('falls back to a configured provider (writes both active keys)', async () => {
    const mock = installStorage({
      [KEYS_KEY]: { tavily: 'tvly-1' },
      [SOURCE_ORDER_KEY]: ['custom:gone', 'tavily'],
      [SOURCE_HIDDEN_KEY]: ['custom:gone'],
      [ACTIVE_SOURCE_KEY]: 'custom:gone',
      [CUSTOM_ENGINES_KEY]: [makeCustom('custom:gone')],
    });
    await deleteCustomEngineDefinition('custom:gone');
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('tavily');
    expect(mock.store.get(ACTIVE_KEY)).toBe('tavily');
  });

  it('falls back to a provider instance (activeSource = instance id, activeProvider = base provider)', async () => {
    const mock = installStorage({
      [KEYS_KEY]: { exa: 'exa-1' },
      [PROVIDER_INSTANCES_KEY]: [{ id: 'inst:exa:abc', baseProviderId: 'exa', name: 'AI Research', options: {} }],
      [SOURCE_ORDER_KEY]: ['custom:gone', 'inst:exa:abc'],
      [SOURCE_HIDDEN_KEY]: [],
      [ACTIVE_SOURCE_KEY]: 'custom:gone',
      [CUSTOM_ENGINES_KEY]: [makeCustom('custom:gone')],
    });
    await deleteCustomEngineDefinition('custom:gone');
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('inst:exa:abc');
    expect(mock.store.get(ACTIVE_KEY)).toBe('exa');
  });

  it('falls back to an eligible aggregate instance (聚合无 base provider，不双写 activeProvider)', async () => {
    const mock = installStorage({
      [SOURCE_ORDER_KEY]: ['custom:gone', 'agg:aaa'],
      [SOURCE_HIDDEN_KEY]: [],
      [ACTIVE_SOURCE_KEY]: 'custom:gone',
      [ACTIVE_KEY]: undefined,
      [AGGREGATE_INSTANCES_KEY]: [{ id: 'agg:aaa', name: 'Agg', members: ['google'], topN: 10 }],
      // eligibility：rerank 已配置 + engine 成员恒有效。
      [RERANK_CONFIG_KEY]: { endpoint: 'http://127.0.0.1:9/v1/rerank' },
      [CUSTOM_ENGINES_KEY]: [makeCustom('custom:gone')],
    });
    await deleteCustomEngineDefinition('custom:gone');
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('agg:aaa');
    expect(mock.store.get(ACTIVE_KEY)).toBeUndefined();
  });

  it('re-points to DEFAULT_ENGINE_ID via the ensureVisibleUsable repair when everything else is hidden (ACTIVE_KEY untouched)', async () => {
    const mock = installStorage({
      // 无已配 key 的 provider；全部引擎 + 被删 custom 均在隐藏清单 → 删除前无可见可用源。
      [SOURCE_ORDER_KEY]: ['custom:gone', ...ALL_ENGINE_IDS],
      [SOURCE_HIDDEN_KEY]: ['custom:gone', ...ALL_ENGINE_IDS],
      [ACTIVE_SOURCE_KEY]: 'custom:gone',
      [CUSTOM_ENGINES_KEY]: [makeCustom('custom:gone')],
    });
    await deleteCustomEngineDefinition('custom:gone');
    // hidden 经 ensureVisibleUsable 修复（对齐兄弟 delete 路径）：谷歌解除隐藏成为可见可用回退，
    // activeSource 重指到它；其余引擎保持隐藏；ACTIVE_KEY 不写（engine 无 base provider）。
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('google');
    expect(mock.store.get(ACTIVE_KEY)).toBeUndefined();
    expect(mock.store.get(SOURCE_HIDDEN_KEY)).not.toContain('google');
    expect(mock.store.get(SOURCE_HIDDEN_KEY)).toContain('baidu');
  });

  it('leaves activeSource untouched when a non-active custom engine is deleted', async () => {
    const mock = installStorage({
      [SOURCE_ORDER_KEY]: ['custom:aaa', 'custom:bbb'],
      [ACTIVE_SOURCE_KEY]: 'custom:aaa',
      [CUSTOM_ENGINES_KEY]: [makeCustom('custom:aaa'), makeCustom('custom:bbb')],
    });
    await deleteCustomEngineDefinition('custom:bbb');
    expect(mock.store.get(ACTIVE_SOURCE_KEY)).toBe('custom:aaa');
    expect(mock.store.get(SOURCE_ORDER_KEY)).toContain('custom:aaa');
    expect(mock.store.get(SOURCE_ORDER_KEY)).not.toContain('custom:bbb');
  });
});
