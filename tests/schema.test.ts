import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureSchema,
  readSchemaVersion,
  migrateConfig,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  migrations,
  type Migration,
} from '@/lib/schema';

// 内存版 chrome.storage.local，支持 get(string | string[] | null) + set + remove。
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

describe('ensureSchema: stamping (first install)', () => {
  it('writes CURRENT_SCHEMA_VERSION when the version key is missing', async () => {
    await ensureSchema();
    expect(await readSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('does not touch existing config values when stamping', async () => {
    const { store } = installStorage({ providerKeys: { tavily: 'tvly-x' }, themePref: 'dark' });
    await ensureSchema();
    expect(store.get('providerKeys')).toEqual({ tavily: 'tvly-x' });
    expect(store.get('themePref')).toBe('dark');
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('ensureSchema: steady state', () => {
  it('does not write when already at CURRENT_SCHEMA_VERSION', async () => {
    const { store } = installStorage({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
    const setSpy = vi.spyOn(browser.storage.local, 'set');
    await ensureSchema();
    expect(setSpy).not.toHaveBeenCalled();
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('only reads the version key in steady state (not the whole store)', async () => {
    installStorage({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION, providerKeys: { tavily: 'x' } });
    const getSpy = vi.spyOn(browser.storage.local, 'get');
    await ensureSchema();
    // 第一（仅）次读应只取版本键
    expect(getSpy.mock.calls[0][0]).toBe(SCHEMA_VERSION_KEY);
  });
});

describe('ensureSchema: downgrade tolerance', () => {
  it('ignores a stored version higher than current (forward-compat, no writes)', async () => {
    const { store } = installStorage({ [SCHEMA_VERSION_KEY]: 999 });
    const setSpy = vi.spyOn(browser.storage.local, 'set');
    await ensureSchema();
    expect(setSpy).not.toHaveBeenCalled();
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(999);
  });
});

describe('ensureSchema: migration chain (forward compatibility)', () => {
  it('real migrations array contains the v1->v2 default-hidden engines migration', () => {
    return import('@/lib/schema').then((mod) => {
      expect(mod.migrations).toHaveLength(1);
      expect(mod.migrations[0].version).toBe(1);
      expect(mod.CURRENT_SCHEMA_VERSION).toBe(2);
    });
  });

  it('v1->v2 migration merges default-hidden engine ids into sourceHidden (idempotent)', () => {
    const once = migrateConfig({ sourceHidden: ['bing'] }, 1, CURRENT_SCHEMA_VERSION, migrations);
    const twice = migrateConfig(once, 1, CURRENT_SCHEMA_VERSION, migrations);
    expect(once.sourceHidden).toEqual(['bing', 'douyin', 'xiaohongshu']);
    expect(twice).toEqual(once);
  });

  it('v1->v2 migration initializes sourceHidden when absent', () => {
    const out = migrateConfig({ providerKeys: {} }, 1, CURRENT_SCHEMA_VERSION, migrations);
    expect(out.sourceHidden).toEqual(['douyin', 'xiaohongshu']);
  });

  it('v1->v2 migration does not duplicate ids already hidden', () => {
    const out = migrateConfig({ sourceHidden: ['douyin', 'baidu'] }, 1, CURRENT_SCHEMA_VERSION, migrations);
    expect(out.sourceHidden).toEqual(['douyin', 'baidu', 'xiaohongshu']);
  });

  it('ensureSchema set-then-remove: stamps version even when only version key changes', async () => {
    // 首装：缺戳 → 应写 CURRENT；顺序上 set 先于 remove（remove 通常为空）。
    const { store } = installStorage({ themePref: 'dark' });
    const setSpy = vi.spyOn(browser.storage.local, 'set');
    const removeSpy = vi.spyOn(browser.storage.local, 'remove');
    await ensureSchema();
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(CURRENT_SCHEMA_VERSION);
    // set 必须被调用（至少写 schemaVersion）；若有 remove，set 的 call 应不晚于 remove。
    expect(setSpy).toHaveBeenCalled();
    if (removeSpy.mock.calls.length > 0) {
      const setOrder = setSpy.mock.invocationCallOrder[0]!;
      const removeOrder = removeSpy.mock.invocationCallOrder[0]!;
      expect(setOrder).toBeLessThan(removeOrder);
    }
  });
});

// 直接测 migrateConfig 纯函数：验证链式 + 跳过 + 幂等。
describe('migrateConfig (pure migration runner)', () => {
  it('runs migrations in version order from->to', () => {
    const chain: Migration[] = [
      { version: 1, migrate: (c) => ({ ...c, step: 'v1->2' }) },
      { version: 2, migrate: (c) => ({ ...c, step: 'v2->3' }) },
      { version: 3, migrate: (c) => ({ ...c, step: 'v3->4' }) },
    ];
    const out = migrateConfig({ a: 1 }, 1, 4, chain);
    expect(out.step).toBe('v3->4'); // 最后一条迁移的产物
  });

  it('skips migrations before fromVersion and at/after toVersion', () => {
    const chain: Migration[] = [
      { version: 1, migrate: (c) => ({ ...c, touched: [...(c.touched as string[] ?? []), 'v1'] }) },
      { version: 2, migrate: (c) => ({ ...c, touched: [...(c.touched as string[] ?? []), 'v2'] }) },
      { version: 3, migrate: (c) => ({ ...c, touched: [...(c.touched as string[] ?? []), 'v3'] }) },
    ];
    // fromVersion=2, toVersion=3：只跑 version=2 这一条
    const out = migrateConfig({ touched: [] }, 2, 3, chain);
    expect(out.touched).toEqual(['v2']);
  });

  it('is idempotent when migrations are pure (running twice yields deep-equal)', () => {
    const chain: Migration[] = [
      { version: 1, migrate: (c) => renameKey(c, 'activeProvider', 'activeProviderId') },
      { version: 2, migrate: (c) => ({ ...c, addedDefault: c.addedDefault ?? 'new-tab' }) },
    ];
    const input = { activeProvider: 'exa', themePref: 'dark' };
    const once = migrateConfig(input, 0, 3, chain);
    const twice = migrateConfig(once, 0, 3, chain);
    expect(twice).toEqual(once);
  });

  it('real-world scenario: rename key v1->v2', () => {
    const chain: Migration[] = [
      { version: 1, migrate: (c) => renameKey(c, 'activeProvider', 'activeProviderId') },
    ];
    const out = migrateConfig({ activeProvider: 'exa', providerKeys: { exa: 'k' } }, 1, 2, chain);
    expect(out).not.toHaveProperty('activeProvider');
    expect(out).toHaveProperty('activeProviderId', 'exa');
    expect(out.providerKeys).toEqual({ exa: 'k' });
  });

  it('real-world scenario: add field with default v2->v3', () => {
    const chain: Migration[] = [
      { version: 2, migrate: (c) => ({ ...c, searchDefault: c.searchDefault ?? 'new-tab' }) },
    ];
    const out = migrateConfig({ providerKeys: {} }, 2, 3, chain);
    expect(out.searchDefault).toBe('new-tab');
  });
});

function renameKey(obj: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  const out = { ...obj };
  if (from in out) {
    out[to] = out[from];
    delete out[from];
  }
  return out;
}
