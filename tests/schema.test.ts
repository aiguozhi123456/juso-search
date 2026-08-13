import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureSchema,
  readSchemaVersion,
  migrateConfig,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  CONFIG_KEYS,
  migrations,
  type Migration,
} from '@/lib/schema';

// 内存版 chrome.storage.local，支持 get(string | string[] | null) + set + remove。
function installStorage(seed: Record<string, unknown> = {}, hooks: { beforeSet?: (items: Record<string, unknown>) => void } = {}): { store: Map<string, unknown> } {
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
          hooks.beforeSet?.(items);
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

// v6→v7 迁移引入的 5 个预置 AI engine（registry 顺序固定）。
const AI_ENGINE_IDS = ['ai:grok', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao', 'ai:gemini'];

describe('CONFIG_KEYS whitelist', () => {
  // 回归（L1）：Custom Engine 功能新增 customEngines 存储键，须纳入 CONFIG_KEYS 白名单，
  // 否则未来迁移读写 config 域时会静默漏掉它（getter 仍兜底 []，故无需 bump 版本/迁移）。
  it('includes customEngines alongside siteEngines', () => {
    expect(CONFIG_KEYS).toContain('customEngines');
    expect(CONFIG_KEYS).toContain('siteEngines');
  });

  it('includes aiAutoEnter in the config whitelist', () => {
    expect(CONFIG_KEYS).toContain('aiAutoEnter');
  });

  it('includes flatLayoutFewSources in the config whitelist', () => {
    expect(CONFIG_KEYS).toContain('flatLayoutFewSources');
  });
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
  it('real migrations include v3->v4 Site Engine defaults', () => {
    return import('@/lib/schema').then((mod) => {
      expect(mod.migrations).toHaveLength(8);
      expect(mod.migrations[0].version).toBe(1);
      expect(mod.migrations[1].version).toBe(2);
      expect(mod.migrations[2].version).toBe(3);
      expect(mod.migrations[3].version).toBe(4);
      expect(mod.migrations[4].version).toBe(5);
      expect(mod.migrations[5].version).toBe(6);
      expect(mod.migrations[6].version).toBe(7);
      expect(mod.migrations[7].version).toBe(8);
      expect(mod.CURRENT_SCHEMA_VERSION).toBe(9);
    });
  });

  it('full chain v1->current merges douyin/xiaohongshu (v2), bilibili (v3), yandex/duckduckgo (v6), AI engines (v7) and weixin (v9) into sourceHidden (idempotent)', () => {
    const once = migrateConfig({ sourceHidden: ['bing'] }, 1, CURRENT_SCHEMA_VERSION, migrations);
    const twice = migrateConfig(once, 1, CURRENT_SCHEMA_VERSION, migrations);
    expect(once.sourceHidden).toEqual(['bing', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS, 'weixin']);
    expect(twice).toEqual(once);
  });

  it('full chain v1->current initializes sourceHidden when absent', () => {
    const out = migrateConfig({ providerKeys: {} }, 1, CURRENT_SCHEMA_VERSION, migrations);
    expect(out.sourceHidden).toEqual(['douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS, 'weixin']);
  });

  it('full chain v1->current does not duplicate ids already hidden', () => {
    const out = migrateConfig({ sourceHidden: ['douyin', 'baidu'] }, 1, CURRENT_SCHEMA_VERSION, migrations);
    expect(out.sourceHidden).toEqual(['douyin', 'baidu', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS, 'weixin']);
  });

  it('v1->v2 alone (target v2) adds douyin/xiaohongshu but NOT bilibili', () => {
    const out = migrateConfig({ sourceHidden: ['baidu'] }, 1, 2, migrations);
    expect(out.sourceHidden).toEqual(['baidu', 'douyin', 'xiaohongshu']);
    expect(out.sourceHidden).not.toContain('bilibili');
  });

  it('v2->current chain merges bilibili (v3), yandex/duckduckgo (v6), AI engines (v7) and weixin (v9) into sourceHidden (idempotent)', () => {
    const once = migrateConfig({ sourceHidden: ['douyin', 'xiaohongshu'] }, 2, CURRENT_SCHEMA_VERSION, migrations);
    const twice = migrateConfig(once, 2, CURRENT_SCHEMA_VERSION, migrations);
    expect(once.sourceHidden).toEqual(['douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS, 'weixin']);
    expect(twice).toEqual(once);
  });

  it('v2->current chain does not duplicate bilibili if already hidden', () => {
    const out = migrateConfig({ sourceHidden: ['bilibili', 'douyin'] }, 2, CURRENT_SCHEMA_VERSION, migrations);
    expect(out.sourceHidden).toEqual(['bilibili', 'douyin', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS, 'weixin']);
  });

  it('v5->v6 migration merges yandex/duckduckgo into sourceHidden (idempotent)', () => {
    const once = migrateConfig({ sourceHidden: ['baidu'] }, 5, 6, migrations);
    const twice = migrateConfig(once, 5, 6, migrations);
    expect(once.sourceHidden).toEqual(['baidu', 'yandex', 'duckduckgo']);
    expect(twice).toEqual(once);
  });

  it('v5->v6 migration does not duplicate yandex/duckduckgo if already hidden', () => {
    const out = migrateConfig({ sourceHidden: ['duckduckgo', 'yandex'] }, 5, 6, migrations);
    expect(out.sourceHidden).toEqual(['duckduckgo', 'yandex']);
  });

  it('v6->v7 migration merges AI engines into sourceHidden after duckduckgo (idempotent)', () => {
    const once = migrateConfig({ sourceHidden: ['baidu'] }, 6, 7, migrations);
    const twice = migrateConfig(once, 6, 7, migrations);
    expect(once.sourceHidden).toEqual(['baidu', ...AI_ENGINE_IDS]);
    expect(twice).toEqual(once);
  });

  it('v6->v7 migration does not duplicate AI engines already hidden', () => {
    const out = migrateConfig({ sourceHidden: ['ai:grok', 'ai:gemini'] }, 6, 7, migrations);
    expect(out.sourceHidden).toEqual(['ai:grok', 'ai:gemini', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao']);
  });

  it('v7->v8 migration remaps legacy "top" serpBarPosition to inline', () => {
    // v7 的 'top' 表示内联引擎锚点插入；v8 起该语义改名 'inline'，'top' 变为固定覆盖顶栏。
    const once = migrateConfig({ serpBarPosition: 'top' }, 7, 8, migrations);
    const twice = migrateConfig(once, 7, 8, migrations);
    expect(once.serpBarPosition).toBe('inline');
    expect(twice).toEqual(once);
  });

  it('v7->v8 migration leaves bottom serpBarPosition unchanged', () => {
    const out = migrateConfig({ serpBarPosition: 'bottom' }, 7, 8, migrations);
    expect(out.serpBarPosition).toBe('bottom');
  });

  it('v7->v8 migration leaves inline serpBarPosition unchanged (idempotent)', () => {
    const once = migrateConfig({ serpBarPosition: 'inline' }, 7, 8, migrations);
    const twice = migrateConfig(once, 7, 8, migrations);
    expect(once.serpBarPosition).toBe('inline');
    expect(twice).toEqual(once);
  });

  it('v8->v9 migration merges weixin into sourceHidden (idempotent)', () => {
    const once = migrateConfig({ sourceHidden: ['baidu'] }, 8, 9, migrations);
    const twice = migrateConfig(once, 8, 9, migrations);
    expect(once.sourceHidden).toEqual(['baidu', 'weixin']);
    expect(twice).toEqual(once);
  });

  it('v8->v9 migration does not duplicate weixin if already hidden', () => {
    const out = migrateConfig({ sourceHidden: ['weixin', 'yandex'] }, 8, 9, migrations);
    expect(out.sourceHidden).toEqual(['weixin', 'yandex']);
  });

  it('v3->v4 adds explicit empty Site Engine definitions', () => {
    expect(migrateConfig({}, 3, 4, migrations).siteEngines).toEqual([]);
  });

  it('v4->v5 is a no-op pass-through (groupConfig defaults lazily via getter)', () => {
    // groupConfig 缺省由 getter 回退默认配置，迁移无需填充数据——仅 bump 版本戳。
    const before = { providerKeys: {}, sourceHidden: ['baidu'] };
    const after = migrateConfig(before, 4, 5, migrations);
    expect(after).toEqual(before);
    expect('groupConfig' in after).toBe(false);
  });

  it('stamps version as the final commit after data migration', async () => {
    const { store } = installStorage({ themePref: 'dark' });
    const setSpy = vi.spyOn(browser.storage.local, 'set');
    const removeSpy = vi.spyOn(browser.storage.local, 'remove');
    await ensureSchema();
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(CURRENT_SCHEMA_VERSION);
    expect(setSpy).toHaveBeenCalledWith({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('does not stamp v4 when the final commit fails and safely retries migrated data', async () => {
    let failFinalStamp = true;
    const { store } = installStorage({ [SCHEMA_VERSION_KEY]: 3 }, {
      beforeSet: (items) => {
        if (items[SCHEMA_VERSION_KEY] === CURRENT_SCHEMA_VERSION && failFinalStamp) {
          failFinalStamp = false;
          throw new Error('final stamp failed');
        }
      },
    });
    await expect(ensureSchema()).rejects.toThrow('final stamp failed');
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(3);
    expect(store.get('siteEngines')).toEqual([]);

    await ensureSchema();
    expect(store.get(SCHEMA_VERSION_KEY)).toBe(CURRENT_SCHEMA_VERSION);
    expect(store.get('siteEngines')).toEqual([]);
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
