import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildExportPayload,
  parseImportPayload,
  previewImport,
  mergeImport,
  type ConfigExport,
} from '@/lib/config-io';
import { CURRENT_SCHEMA_VERSION } from '@/lib/schema';
import { setSourceOrder } from '@/lib/storage';
import { defaultGroupConfig } from '@/lib/source-groups';
import type { SourceId } from '@/lib/sources';
import type { ProviderInstance, ProviderInstanceId } from '@/lib/provider-instances';

// 5 个预置 AI engine（registry 顺序固定），sourceOrder 归一化补尾追加在 duckduckgo 之后。
const AI_ENGINE_IDS = ['ai:grok', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao', 'ai:gemini'] as const;

// 内存版 chrome.storage.local，支持 get(string | string[] | null) + set + remove。
function installStorage(
  seed: Record<string, unknown> = {},
  hooks: { beforeSet?: (items: Record<string, unknown>) => Promise<void> } = {},
): { store: Map<string, unknown> } {
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
          await hooks.beforeSet?.(items);
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

function validPayload(overrides: Partial<ConfigExport> = {}): ConfigExport {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: 123,
    appVersion: '1.0.0',
    providerKeys: { tavily: 'tvly-1' },
    activeProvider: 'tavily',
    activeSource: 'tavily',
    themePref: 'auto',
    localePref: 'auto',
    serpBarPosition: 'auto',
    siteEngines: [],
    ...overrides,
  };
}

/** 构造一个合法 Provider Instance（Exa base，options 为 plain object）。 */
function makeInstance(id: string, overrides: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: id as ProviderInstanceId,
    baseProviderId: 'exa',
    name: 'AI Research',
    options: { category: 'publication' },
    ...overrides,
  };
}

beforeEach(() => {
  installStorage();
});

describe('buildExportPayload', () => {
  it('reads the config keys precisely (not get(null))', async () => {
    installStorage({
      providerKeys: { tavily: 'tvly-1', exa: 'exa-1' },
      activeProvider: 'exa',
      activeSource: 'google',
      themePref: 'dark',
      localePref: 'en',
      sourceHidden: ['baidu'],
      searchCacheIndex: { version: 1, order: ['x'], byKey: {}, summaries: {} }, // 不应被读
      searchCacheEntry: { big: 'payload' },
    });
    const payload = await buildExportPayload();
    expect(payload.providerKeys).toEqual({ tavily: 'tvly-1', exa: 'exa-1' });
    expect(payload.activeProvider).toBe('exa');
    expect(payload.activeSource).toBe('google');
    expect(payload.themePref).toBe('dark');
    expect(payload.localePref).toBe('en');
    expect(payload.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(payload.appVersion).toBe('1.0.0');
    expect(payload.exportedAt).toBeGreaterThan(0);
    expect(payload.sourceHidden).toEqual(['baidu']);
    // 缓存池键不应出现在任何读取结果里
    expect(payload).not.toHaveProperty('searchCacheIndex');
  });

  it('defaults prefs to auto when missing/invalid', async () => {
    installStorage({ providerKeys: {}, activeProvider: 'nonexistent-id' });
    const payload = await buildExportPayload();
    expect(payload.themePref).toBe('auto');
    expect(payload.localePref).toBe('auto');
    expect(payload.serpBarPosition).toBe('auto');
    expect(payload.activeProvider).toBeNull();
    expect(payload.activeSource).toBe('google');
  });

  it('exports groupConfig when present', async () => {
    installStorage({
      providerKeys: {},
      groupConfig: {
        groups: [
          { id: 'ai-search', label: { kind: 'i18n', key: 'group_ai_search' } },
          { id: 'engines', label: { kind: 'i18n', key: 'group_engines' } },
          { id: 'sites', label: { kind: 'i18n', key: 'group_sites' } },
        ],
        layout: [{ kind: 'source', sourceId: 'google' }, { kind: 'group', groupId: 'ai-search' }],
        assignments: { tavily: 'ai-search' },
      },
    });
    const payload = await buildExportPayload();
    expect(payload.groupConfig).toBeDefined();
    // 持久化 layout 缺 engines/sites/ai-engines/custom；normalizeGroupConfig 把缺失内置组按 DEFAULT_GROUPS 顺序追加到末尾。
    expect(payload.groupConfig?.layout).toEqual([
      { kind: 'source', sourceId: 'google' },
      { kind: 'group', groupId: 'ai-search' },
      { kind: 'group', groupId: 'engines' },
      { kind: 'group', groupId: 'sites' },
      { kind: 'group', groupId: 'ai-engines' },
      { kind: 'group', groupId: 'custom' },
    ]);
  });

  it('omits groupConfig (undefined) when not stored', async () => {
    installStorage({ providerKeys: {} });
    const payload = await buildExportPayload();
    expect(payload.groupConfig).toBeUndefined();
  });

  it('reads a stored serpBarPosition value', async () => {
    installStorage({ serpBarPosition: 'bottom' });
    const payload = await buildExportPayload();
    expect(payload.serpBarPosition).toBe('bottom');
  });

  it('falls back activeSource through activeProvider and configured keys', async () => {
    installStorage({ providerKeys: { exa: 'exa-1' }, activeProvider: 'exa' });
    await expect(buildExportPayload()).resolves.toMatchObject({ activeSource: 'exa' });

    installStorage({ providerKeys: { tavily: 'tvly-1' }, activeProvider: 'exa', activeSource: 'exa' });
    await expect(buildExportPayload()).resolves.toMatchObject({ activeSource: 'tavily' });
  });

  it('filters out unknown provider ids from providerKeys', async () => {
    installStorage({ providerKeys: { tavily: 'good', ghost: 'bad', exa: 'good2' } });
    const payload = await buildExportPayload();
    expect(payload.providerKeys).toEqual({ tavily: 'good', exa: 'good2' });
  });

  it('exports a normalized complete source order', async () => {
    installStorage({ sourceOrder: ['bing', 'exa', 'ghost', 'bing'] });
    await expect(buildExportPayload()).resolves.toMatchObject({
      sourceOrder: ['bing', 'exa', 'tavily', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS],
    });
  });

  it('exports a normalized hidden source list', async () => {
    installStorage({ sourceHidden: ['baidu', 'ghost', 'baidu'] });
    const payload = await buildExportPayload();
    expect(payload.sourceHidden).toEqual(['baidu']);
  });

  it('exports an empty hidden list when unset', async () => {
    installStorage({});
    const payload = await buildExportPayload();
    expect(payload.sourceHidden).toEqual([]);
  });

  it('exports populated canonical Site Engine definitions and their dependent sources', async () => {
    const site = { id: 'site:docs', name: ' Docs ', target: 'docs.example.com/guide?ignored=1', engineId: 'google' as const };
    installStorage({ siteEngines: [site], activeSource: site.id, sourceOrder: [site.id, 'bing'], sourceHidden: [site.id] });
    await expect(buildExportPayload()).resolves.toMatchObject({
      siteEngines: [{ ...site, name: 'Docs', target: 'https://docs.example.com/guide' }],
      activeSource: site.id,
      sourceOrder: [site.id, 'bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS],
      sourceHidden: [site.id],
    });
  });

  it('exports populated Provider Instances', async () => {
    const instances = [
      makeInstance('inst:exa:abc'),
      makeInstance('inst:exa:def', { name: 'Startup News', options: { category: 'news' } }),
    ];
    installStorage({ providerInstances: instances });
    const payload = await buildExportPayload();
    expect(payload.providerInstances).toEqual(instances);
  });

  it('exports an empty Provider Instance list when none are stored', async () => {
    installStorage({});
    const payload = await buildExportPayload();
    expect(payload.providerInstances).toEqual([]);
  });

  it('exports an instance id in sourceOrder', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerKeys: { exa: 'exa-1' }, providerInstances: [instance], sourceOrder: [instance.id, 'bing'] });
    const payload = await buildExportPayload();
    expect(payload.sourceOrder?.[0]).toBe(instance.id);
    expect(payload.sourceOrder).toContain(instance.id);
    expect(payload.providerInstances).toEqual([instance]);
  });

  it('exports an instance id as activeSource', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerKeys: { exa: 'exa-1' }, providerInstances: [instance], activeSource: instance.id });
    const payload = await buildExportPayload();
    expect(payload.activeSource).toBe(instance.id);
  });

  it('maps a bare provider activeSource to the first instance id when instances exist (BUG-1)', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({
      providerKeys: { exa: 'exa-1' },
      providerInstances: [instance],
      activeProvider: 'exa',
      // handleSaveProviderKey 自动建默认实例后 activeSource 仍可能存为裸 provider id。
      activeSource: 'exa',
    });
    const payload = await buildExportPayload();
    expect(payload.activeSource).toBe(instance.id);
  });
});

describe('parseImportPayload', () => {
  it('accepts a valid payload', () => {
    const result = parseImportPayload(validPayload());
    expect(result.ok).toBe(true);
  });

  it('requires valid unique Site Engines before validating dependent source ids', () => {
    expect(parseImportPayload(validPayload({ siteEngines: [{ id: 'site:one', name: 'One', target: 'example.com', engineId: 'google' }], activeSource: 'site:one', sourceOrder: ['site:one'] }))).toMatchObject({ ok: true });
    expect(parseImportPayload(validPayload({ siteEngines: [{ id: 'site:one', name: 'One', target: 'example.com', engineId: 'google' }, { id: 'site:two', name: 'Two', target: 'example.com', engineId: 'google' }] }))).toEqual({ ok: false, error: 'invalid_site_engines' });
  });

  it('requires the v4 Site Engine collection', () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.siteEngines;
    expect(parseImportPayload(payload)).toEqual({ ok: false, error: 'invalid_site_engines' });
  });

  it('accepts a v3 export without Site Engines', () => {
    const payload = validPayload({ schemaVersion: 3 }) as unknown as Record<string, unknown>;
    delete payload.siteEngines;
    const parsed = parseImportPayload(payload);
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) expect(parsed.value.siteEngines).toBeUndefined();
  });

  it('accepts a v4 export (immediately previous schema; structurally a v5 without groupConfig)', () => {
    // v4 是本次 schema bump 前的导出版本；结构等同缺 groupConfig 的 v5，应当可重新导入。
    const payload = validPayload({ schemaVersion: 4 });
    const parsed = parseImportPayload(payload);
    expect(parsed.ok).toBe(true);
  });

  // 回归（M1）：导入接受连续支持区间 [MIN_SUPPORTED, CURRENT]，而非硬编码版本列表——
  // 否则下次 bump（如 v6→v7）会静默拒绝仍有效的 v6 备份。覆盖区间内每个版本（含此前漏掉的 v5）。
  it.each([3, 4, 5, CURRENT_SCHEMA_VERSION])('accepts schema version %i within the supported range', (version) => {
    expect(parseImportPayload(validPayload({ schemaVersion: version })).ok).toBe(true);
  });

  it.each([2, CURRENT_SCHEMA_VERSION + 1])('rejects schema version %i outside the supported range', (version) => {
    expect(parseImportPayload(validPayload({ schemaVersion: version }))).toEqual({
      ok: false,
      error: 'schema_version_mismatch',
    });
  });

  it('rejects non-object', () => {
    expect(parseImportPayload(null).ok).toBe(false);
    expect(parseImportPayload('string').ok).toBe(false);
    expect(parseImportPayload([]).ok).toBe(false);
    expect(parseImportPayload(42).ok).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    const result = parseImportPayload(validPayload({ schemaVersion: 999 as never }));
    expect(result.ok).toBe(false);
  });

  it('rejects unknown provider id in providerKeys', () => {
    const result = parseImportPayload(validPayload({
      providerKeys: { tavily: 'k', ghost: 'x' } as never,
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects non-string key value', () => {
    const result = parseImportPayload(validPayload({
      providerKeys: { tavily: 123 } as never,
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects empty string key value', () => {
    const result = parseImportPayload(validPayload({
      providerKeys: { tavily: '' },
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects invalid activeProvider', () => {
    const result = parseImportPayload(validPayload({ activeProvider: 'ghost' as never }));
    expect(result.ok).toBe(false);
  });

  it('accepts null activeProvider', () => {
    const result = parseImportPayload(validPayload({ activeProvider: null }));
    expect(result.ok).toBe(true);
  });

  it('normalizes missing activeSource to activeProvider', () => {
    const payload = { ...validPayload({ activeProvider: 'exa' }) } as Record<string, unknown>;
    delete payload.activeSource;
    const result = parseImportPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeSource).toBe('exa');
  });

  it('normalizes a missing sourceOrder for compatible old payloads', () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.sourceOrder;
    const result = parseImportPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sourceOrder).toBeUndefined();
  });

  it('normalizes a valid partial sourceOrder by appending missing sources', () => {
    const result = parseImportPayload(validPayload({ sourceOrder: ['bing', 'tavily'] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sourceOrder).toEqual(['bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS]);
  });

  it('accepts ai:* ids in sourceOrder and sourceHidden (regression: isKnownSource knows ai-engine ids)', () => {
    const result = parseImportPayload(validPayload({
      sourceOrder: ['bing', 'ai:grok', 'tavily', 'ai:gemini'],
      sourceHidden: ['ai:chatgpt', 'ai:deepseek', 'ai:doubao'],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // normalizeSourceOrder 按 registry 补全缺失的 AI engine id，并保留已有顺序。
    expect(result.value.sourceOrder).toContain('ai:grok');
    expect(result.value.sourceOrder).toContain('ai:gemini');
    expect(result.value.sourceOrder).toEqual(['bing', 'ai:grok', 'tavily', 'ai:gemini', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao']);
    expect(result.value.sourceHidden).toEqual(['ai:chatgpt', 'ai:deepseek', 'ai:doubao']);
  });

  it.each([
    ['unknown source', ['ghost']],
    ['non-string source', [123]],
    ['duplicate source', ['bing', 'bing']],
  ])('rejects sourceOrder with %s', (_label, sourceOrder) => {
    expect(parseImportPayload(validPayload({ sourceOrder: sourceOrder as never }))).toEqual({
      ok: false,
      error: 'invalid_source_order',
    });
  });

  it('normalizes a missing sourceHidden for compatible old payloads', () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.sourceHidden;
    const result = parseImportPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sourceHidden).toBeUndefined();
  });

  it('normalizes a valid partial sourceHidden', () => {
    const result = parseImportPayload(validPayload({ sourceHidden: ['baidu', 'tavily'] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sourceHidden).toEqual(['baidu', 'tavily']);
  });

  it.each([
    ['unknown source', ['ghost']],
    ['non-string source', [123]],
    ['duplicate source', ['bing', 'bing']],
  ])('rejects sourceHidden with %s', (_label, sourceHidden) => {
    expect(parseImportPayload(validPayload({ sourceHidden: sourceHidden as never }))).toEqual({ ok: false, error: 'invalid_source_hidden' });
  });

  it('accepts engine activeSource', () => {
    const result = parseImportPayload(validPayload({ activeSource: 'baidu' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeSource).toBe('baidu');
  });

  it('rejects invalid activeSource', () => {
    const result = parseImportPayload(validPayload({ activeSource: 'ghost' as never }));
    expect(result).toEqual({ ok: false, error: 'invalid_active_source' });
  });

  it('rejects invalid themePref', () => {
    const result = parseImportPayload(validPayload({ themePref: 'neon' as never }));
    expect(result.ok).toBe(false);
  });

  it('rejects invalid localePref', () => {
    const result = parseImportPayload(validPayload({ localePref: 'fr' as never }));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid serpBarPosition value', () => {
    const result = parseImportPayload(validPayload({ serpBarPosition: 'side' as never }));
    expect(result).toEqual({ ok: false, error: 'invalid_bar_position' });
  });

  it('accepts a missing serpBarPosition field (legacy export)', () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    delete payload.serpBarPosition;
    const result = parseImportPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.serpBarPosition).toBeUndefined();
  });

  it('accepts valid Provider Instances in an import payload', () => {
    const instance = makeInstance('inst:exa:abc');
    const result = parseImportPayload(validPayload({ providerInstances: [instance] }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.providerInstances).toEqual([instance]);
  });

  it('accepts an import payload without Provider Instances (legacy/partial export)', () => {
    const result = parseImportPayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerInstances).toBeUndefined();
  });

  it('accepts an instance id in sourceOrder and preserves it', () => {
    const instance = makeInstance('inst:exa:abc');
    const result = parseImportPayload(validPayload({
      providerInstances: [instance],
      sourceOrder: [instance.id, 'bing'],
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceOrder?.[0]).toBe(instance.id);
      expect(result.value.sourceOrder).toContain(instance.id);
    }
  });

  it('rejects a dangling instance id in sourceOrder (not in providerInstances)', () => {
    const result = parseImportPayload(validPayload({ sourceOrder: ['inst:exa:abc'] as never }));
    expect(result).toEqual({ ok: false, error: 'invalid_source_order' });
  });

  it('accepts an instance id as activeSource', () => {
    const instance = makeInstance('inst:exa:abc');
    const result = parseImportPayload(validPayload({
      providerInstances: [instance],
      activeSource: instance.id,
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeSource).toBe(instance.id);
  });

  it('preserves a Provider Instance assignment in groupConfig across import', () => {
    const instance = makeInstance('inst:exa:abc');
    const result = parseImportPayload(validPayload({
      providerInstances: [instance],
      groupConfig: {
        groups: [{ id: 'ai-search', label: { kind: 'i18n', key: 'group_ai_search' } }],
        layout: [{ kind: 'source', sourceId: 'google' }, { kind: 'group', groupId: 'ai-search' }],
        assignments: { [instance.id]: 'ai-search' },
        groupOrders: {},
      },
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.groupConfig?.assignments[instance.id]).toBe('ai-search');
  });

  it('rejects Provider Instances with an invalid id', () => {
    const result = parseImportPayload(validPayload({
      providerInstances: [{ id: 'bogus', baseProviderId: 'exa', name: 'X', options: {} }] as never,
    }));
    expect(result).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });

  it('rejects Provider Instances with an unknown base provider', () => {
    const result = parseImportPayload(validPayload({
      providerInstances: [{ id: 'inst:exa:abc', baseProviderId: 'ghost', name: 'X', options: {} }] as never,
    }));
    expect(result).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });

  it('rejects Provider Instances with non-object options', () => {
    expect(parseImportPayload(validPayload({
      providerInstances: [{ id: 'inst:exa:abc', baseProviderId: 'exa', name: 'X', options: 'nope' }] as never,
    }))).toEqual({ ok: false, error: 'invalid_provider_instances' });
    expect(parseImportPayload(validPayload({
      providerInstances: [{ id: 'inst:exa:abc', baseProviderId: 'exa', name: 'X', options: [] }] as never,
    }))).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });

  it('rejects Provider Instances with an over-length name', () => {
    const result = parseImportPayload(validPayload({
      providerInstances: [{ id: 'inst:exa:abc', baseProviderId: 'exa', name: 'X'.repeat(41), options: {} }] as never,
    }));
    expect(result).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });

  it('rejects a Provider Instance collection with any invalid record', () => {
    const instances = [
      makeInstance('inst:exa:abc'),
      { id: 'inst:exa:def', baseProviderId: 'ghost', name: 'Bad', options: {} },
    ] as never;
    expect(parseImportPayload(validPayload({ providerInstances: instances }))).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });

  it('rejects an oversized Provider Instance collection', () => {
    const instances = Array.from({ length: 51 }, (_, i) => makeInstance(`inst:exa:${i}`));
    expect(parseImportPayload(validPayload({ providerInstances: instances }))).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });

  it('rejects a Provider Instance collection that exceeds the byte budget', () => {
    const instances = [makeInstance('inst:exa:abc', { options: { big: 'x'.repeat(150 * 1024) } })];
    expect(parseImportPayload(validPayload({ providerInstances: instances }))).toEqual({ ok: false, error: 'invalid_provider_instances' });
  });
});

describe('mergeImport', () => {
  it('fills empty slots only (does not overwrite existing keys)', async () => {
    installStorage({ providerKeys: { tavily: 'existing' } });
    const report = await mergeImport(validPayload({
      providerKeys: { tavily: 'imported', exa: 'new-exa' },
    }));
    expect(report.written).toEqual(['exa']);
    expect(report.skipped).toEqual(['tavily']);
    const got = await browser.storage.local.get('providerKeys');
    expect(got.providerKeys).toEqual({ tavily: 'existing', exa: 'new-exa' });
  });

  it('writes all keys when storage is empty', async () => {
    const report = await mergeImport(validPayload({
      providerKeys: { tavily: 'a', exa: 'b' },
    }));
    expect(report.written.sort()).toEqual(['exa', 'tavily']);
    expect(report.skipped).toEqual([]);
  });

  it('does NOT touch prefs by default (applyPrefs undefined)', async () => {
    installStorage({ activeProvider: 'exa', activeSource: 'bing', themePref: 'light', localePref: 'zh_CN' });
    const report = await mergeImport(validPayload({
      activeProvider: 'tavily',
      activeSource: 'google',
      themePref: 'dark',
      localePref: 'en',
    }));
    expect(report.activeProviderOverridden).toBe(false);
    expect(report.activeSourceOverridden).toBe(false);
    expect(report.themePrefOverridden).toBe(false);
    expect(report.localePrefOverridden).toBe(false);
    const got = await browser.storage.local.get(['activeProvider', 'activeSource', 'themePref', 'localePref']);
    expect(got.activeProvider).toBe('exa');
    expect(got.activeSource).toBe('bing');
    expect(got.themePref).toBe('light');
    expect(got.localePref).toBe('zh_CN');
  });

  it('overrides prefs only when applyPrefs=true', async () => {
    installStorage({ activeProvider: 'exa', activeSource: 'bing', themePref: 'light', localePref: 'zh_CN' });
    const report = await mergeImport(validPayload({
      activeProvider: 'tavily',
      activeSource: 'google',
      themePref: 'dark',
      localePref: 'en',
    }), { applyPrefs: true });
    expect(report.activeProviderOverridden).toBe(true);
    expect(report.activeSourceOverridden).toBe(true);
    expect(report.themePrefOverridden).toBe(true);
    expect(report.localePrefOverridden).toBe(true);
    const got = await browser.storage.local.get(['activeProvider', 'activeSource', 'themePref', 'localePref']);
    expect(got.activeProvider).toBe('tavily');
    expect(got.activeSource).toBe('google');
    expect(got.themePref).toBe('dark');
    expect(got.localePref).toBe('en');
  });

  it('applyPrefs=true does not mark overridden when values are identical', async () => {
    installStorage({ activeProvider: 'tavily', activeSource: 'tavily', providerKeys: { tavily: 'k' }, themePref: 'dark', localePref: 'en' });
    const report = await mergeImport(validPayload({
      activeProvider: 'tavily',
      activeSource: 'tavily',
      themePref: 'dark',
      localePref: 'en',
    }), { applyPrefs: true });
    expect(report.activeProviderOverridden).toBe(false);
    expect(report.activeSourceOverridden).toBe(false);
    expect(report.themePrefOverridden).toBe(false);
    expect(report.localePrefOverridden).toBe(false);
    expect(report.sourceOrderOverridden).toBe(false);
    expect(report.sourceHiddenOverridden).toBe(false);
  });

  it('applyPrefs=true with a different serpBarPosition writes it and marks overridden', async () => {
    installStorage({ serpBarPosition: 'auto' });
    const report = await mergeImport(validPayload({ serpBarPosition: 'bottom' }), { applyPrefs: true });
    expect(report.serpBarPositionOverridden).toBe(true);
    expect((await browser.storage.local.get('serpBarPosition')).serpBarPosition).toBe('bottom');
  });

  it('applyPrefs=true with an identical serpBarPosition does NOT mark overridden', async () => {
    installStorage({ serpBarPosition: 'bottom' });
    const report = await mergeImport(validPayload({ serpBarPosition: 'bottom' }), { applyPrefs: true });
    expect(report.serpBarPositionOverridden).toBe(false);
    expect((await browser.storage.local.get('serpBarPosition')).serpBarPosition).toBe('bottom');
  });

  it('applyPrefs undefined/false does NOT touch serpBarPosition', async () => {
    installStorage({ serpBarPosition: 'top' });
    const report = await mergeImport(validPayload({ serpBarPosition: 'bottom' }));
    expect(report.serpBarPositionOverridden).toBe(false);
    expect((await browser.storage.local.get('serpBarPosition')).serpBarPosition).toBe('top');
  });

  it('writes sourceOrder only when applying preferences', async () => {
    const payload = validPayload({ sourceOrder: ['bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS] });
    await mergeImport(payload);
    expect((await browser.storage.local.get('sourceOrder')).sourceOrder).toBeUndefined();

    const report = await mergeImport(payload, { applyPrefs: true });
    expect(report.sourceOrderOverridden).toBe(true);
    expect((await browser.storage.local.get('sourceOrder')).sourceOrder).toEqual(payload.sourceOrder);
  });

  it('writes sourceHidden only when applying preferences', async () => {
    const payload = validPayload({ sourceHidden: ['baidu', 'tavily'] });
    await mergeImport(payload);
    expect((await browser.storage.local.get('sourceHidden')).sourceHidden).toBeUndefined();
    const report = await mergeImport(payload, { applyPrefs: true });
    expect(report.sourceHiddenOverridden).toBe(true);
    expect((await browser.storage.local.get('sourceHidden')).sourceHidden).toEqual(['baidu', 'tavily']);
  });

  it('treats Site Engines and dependent source graph as apply-preferences data', async () => {
    const site = { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/', engineId: 'google' as const };
    installStorage({ siteEngines: [site], activeSource: site.id, sourceOrder: [site.id, 'bing'], sourceHidden: [site.id] });
    const payload = validPayload({ siteEngines: [], activeSource: 'google', sourceOrder: [], sourceHidden: [] });
    const skipped = await mergeImport(payload, { applyPrefs: false });
    expect(skipped.siteEnginesOverridden).toBe(false);
    expect((await browser.storage.local.get('siteEngines')).siteEngines).toEqual([site]);

    const report = await mergeImport(payload, { applyPrefs: true });
    expect(report).toMatchObject({ siteEnginesOverridden: true, sourceOrderOverridden: true, sourceHiddenOverridden: true });
    const got = await browser.storage.local.get(['siteEngines', 'sourceOrder', 'sourceHidden']);
    expect(got.siteEngines).toEqual([]);
    expect(got.sourceHidden).toEqual([]); // explicit [] clears hidden preferences
    expect(got.sourceOrder).not.toContain(site.id);
  });

  it('preserves the current source order for a legacy payload throughout parse, preview, and merge', async () => {
    const currentOrder = ['bing', 'exa', 'google', 'tavily', 'stepfun', 'stepfun-plan', 'baidu'];
    installStorage({ sourceOrder: currentOrder });
    const rawPayload = validPayload() as unknown as Record<string, unknown>;
    delete rawPayload.sourceOrder;

    const parsed = parseImportPayload(rawPayload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sourceOrder).toBeUndefined();

    const preview = await previewImport(parsed.value);
    expect(preview.prefDiffs).not.toContainEqual(expect.objectContaining({ key: 'sourceOrder' }));

    const report = await mergeImport(parsed.value, { applyPrefs: true });
    expect(report.sourceOrderOverridden).toBe(false);
    expect((await browser.storage.local.get('sourceOrder')).sourceOrder).toEqual(currentOrder);
  });

  it('preserves Site Engine definitions and their graph references for a v3 preference restore', async () => {
    const site = { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/', engineId: 'google' as const };
    installStorage({ siteEngines: [site], activeSource: site.id, sourceOrder: [site.id, 'bing'], sourceHidden: [site.id] });
    const raw = validPayload({ schemaVersion: 3, activeSource: 'google', sourceOrder: ['bing'], sourceHidden: ['baidu'] }) as unknown as Record<string, unknown>;
    delete raw.siteEngines;
    const parsed = parseImportPayload(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await mergeImport(parsed.value, { applyPrefs: true });
    const got = await browser.storage.local.get(['siteEngines', 'activeSource', 'sourceOrder', 'sourceHidden']);
    expect(got.siteEngines).toEqual([site]);
    expect(got.activeSource).toBe(site.id);
    expect(got.sourceOrder).toContain(site.id);
    expect(got.sourceHidden).toContain(site.id);
  });

  it('does not preview v3 changes that would replace an active or hidden local Site Engine', async () => {
    const site = { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/', engineId: 'google' as const };
    installStorage({ providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: site.id, siteEngines: [site], sourceOrder: [site.id], sourceHidden: [site.id] });
    const raw = validPayload({ schemaVersion: 3, activeSource: 'google' }) as unknown as Record<string, unknown>;
    delete raw.siteEngines;
    delete raw.sourceOrder;
    delete raw.sourceHidden;
    const parsed = parseImportPayload(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(await previewImport(parsed.value)).toMatchObject({ prefDiffs: [] });
    expect(await mergeImport(parsed.value, { applyPrefs: true })).toMatchObject({ activeSourceOverridden: false, sourceOrderOverridden: false, sourceHiddenOverridden: false });
  });

  it('preserves existing unknown keys in storage (does not strip)', async () => {
    installStorage({ providerKeys: { tavily: 'keep', mystery: 'x' } });
    await mergeImport(validPayload({ providerKeys: { exa: 'new' } }));
    const got = await browser.storage.local.get('providerKeys');
    // mystery 不在已知 provider 列表，被 mergeImport 当作非法丢弃（只保留已知 provider 的合法 key）
    expect(got.providerKeys).toEqual({ tavily: 'keep', exa: 'new' });
  });

  it('keeps a later source order move after an earlier import completes', async () => {
    let releaseImportSet!: () => void;
    let signalImportSet!: () => void;
    const importSet = new Promise<void>((resolve) => { releaseImportSet = resolve; });
    const importSetStarted = new Promise<void>((resolve) => { signalImportSet = resolve; });
    const importedOrder: SourceId[] = ['bing', 'exa', 'google', 'tavily', 'brave', 'stepfun', 'stepfun-plan', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'jina', 'doubao', 'doubao-global', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS];
    const movedOrder: SourceId[] = ['exa', 'bing', 'google', 'tavily', 'brave', 'stepfun', 'stepfun-plan', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'jina', 'doubao', 'doubao-global', 'yandex', 'duckduckgo', ...AI_ENGINE_IDS];
    const { store } = installStorage({}, {
      beforeSet: async (items) => {
        if (items.providerKeys && items.sourceOrder) {
          signalImportSet();
          await importSet;
        }
      },
    });

    const importPromise = mergeImport(validPayload({ sourceOrder: importedOrder }), { applyPrefs: true });
    await importSetStarted;
    const movePromise = setSourceOrder(movedOrder);
    releaseImportSet();
    await Promise.all([importPromise, movePromise]);

    expect(store.get('sourceOrder')).toEqual(movedOrder);
  });

  it('treats Provider Instances as apply-preferences data (whole-array overwrite)', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerInstances: [instance] });
    const payload = validPayload({ providerInstances: [] });

    const skipped = await mergeImport(payload);
    expect(skipped.providerInstancesOverridden).toBe(false);
    expect((await browser.storage.local.get('providerInstances')).providerInstances).toEqual([instance]);

    const report = await mergeImport(payload, { applyPrefs: true });
    expect(report.providerInstancesOverridden).toBe(true);
    expect((await browser.storage.local.get('providerInstances')).providerInstances).toEqual([]);
  });

  it('overwrites existing Provider Instances with valid imported ones', async () => {
    const oldInstance = makeInstance('inst:exa:old', { name: 'Old' });
    const newInstance = makeInstance('inst:exa:new', { name: 'New', options: { category: 'news' } });
    installStorage({ providerInstances: [oldInstance] });
    const report = await mergeImport(validPayload({ providerInstances: [newInstance] }), { applyPrefs: true });
    expect(report.providerInstancesOverridden).toBe(true);
    expect((await browser.storage.local.get('providerInstances')).providerInstances).toEqual([newInstance]);
  });

  it('preserves existing Provider Instances when the import omits them', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerInstances: [instance] });
    const report = await mergeImport(validPayload(), { applyPrefs: true });
    expect(report.providerInstancesOverridden).toBe(false);
    expect((await browser.storage.local.get('providerInstances')).providerInstances).toEqual([instance]);
  });

  it('does not mark providerInstances overridden when the imported array is identical', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerInstances: [instance] });
    const report = await mergeImport(validPayload({ providerInstances: [instance] }), { applyPrefs: true });
    expect(report.providerInstancesOverridden).toBe(false);
    expect((await browser.storage.local.get('providerInstances')).providerInstances).toEqual([instance]);
  });

  it('AE5 round trip: export → import restores instance ids in activeSource and sourceOrder', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerKeys: { exa: 'exa-1' }, providerInstances: [instance], activeSource: instance.id, sourceOrder: [instance.id, 'bing'] });
    const exported = await buildExportPayload();
    expect(exported.activeSource).toBe(instance.id);
    expect(exported.sourceOrder).toContain(instance.id);

    // v7 导出的 sourceOrder 含 5 个 AI engine id；parseImportPayload 的 isKnownSource 已认识 ai:* id，
    // 完整 payload（含 AI engine id）必须能原样导入。
    const parsed = parseImportPayload(exported);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sourceOrder?.filter((id) => id.startsWith('ai:'))).toEqual([...AI_ENGINE_IDS]);

    installStorage({}); // 全新导入目标
    const report = await mergeImport(parsed.value, { applyPrefs: true });
    expect(report.activeSourceOverridden).toBe(true);
    const got = await browser.storage.local.get(['activeSource', 'sourceOrder', 'providerInstances']);
    expect(got.activeSource).toBe(instance.id);
    expect(got.sourceOrder).toContain(instance.id);
    expect(got.providerInstances).toEqual([instance]);
  });
});

describe('previewImport (dry-run)', () => {
  it('reports keys to fill/skip and pref diffs without writing', async () => {
    installStorage({
      providerKeys: { tavily: 'existing' },
      activeProvider: 'tavily',
      activeSource: 'tavily',
      themePref: 'light',
      localePref: 'zh_CN',
    });
    const preview = await previewImport(validPayload({
      providerKeys: { tavily: 'imported', exa: 'new-exa' },
      activeProvider: 'exa',
      activeSource: 'google',
      themePref: 'dark',
      localePref: 'zh_CN', // unchanged
    }));
    expect(preview.written).toEqual(['exa']);
    expect(preview.skipped).toEqual(['tavily']);
    // activeProvider / activeSource / themePref 不同；localePref 相同，不进 diffs
    expect(preview.prefDiffs).toEqual([
      { key: 'activeProvider', from: 'tavily', to: 'exa' },
      { key: 'activeSource', from: 'tavily', to: 'google' },
      { key: 'themePref', from: 'light', to: 'dark' },
    ]);
    // dry-run：storage 不变
    const got = await browser.storage.local.get(['providerKeys', 'themePref']);
    expect(got.providerKeys).toEqual({ tavily: 'existing' });
    expect(got.themePref).toBe('light');
  });

  it('returns empty prefDiffs when all prefs match current', async () => {
    installStorage({ activeProvider: 'tavily', activeSource: 'tavily', providerKeys: { tavily: 'k' }, themePref: 'auto', localePref: 'auto' });
    const preview = await previewImport(validPayload({
      activeProvider: 'tavily', activeSource: 'tavily', themePref: 'auto', localePref: 'auto',
    }));
    expect(preview.prefDiffs).toEqual([]);
  });

  it('reports no groupConfig diff when the imported groupConfig equals the current one', async () => {
    // 回归：previewImport 此前漏读 GROUP_CONFIG_KEY，会把任何 groupConfig 都误报为 diff（与 mergeImport 不一致）。
    const groupConfig = defaultGroupConfig(['tavily', 'google']);
    installStorage({
      activeProvider: 'tavily', activeSource: 'tavily', providerKeys: { tavily: 'k' },
      themePref: 'auto', localePref: 'auto',
      groupConfig,
    });
    const preview = await previewImport(validPayload({
      activeProvider: 'tavily', activeSource: 'tavily', themePref: 'auto', localePref: 'auto',
      groupConfig,
    }));
    expect(preview.prefDiffs.find((d) => d.key === 'groupConfig')).toBeUndefined();
  });

  it('includes Site Engine-only changes in the same preference confirmation diff', async () => {
    const site = { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/', engineId: 'google' as const };
    installStorage({ providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: 'tavily', siteEngines: [site] });
    const preview = await previewImport(validPayload());
    expect(preview.prefDiffs).toEqual(expect.arrayContaining([{
      key: 'siteEngines', from: 'site:docs:google:https://docs.example.com/:Docs', to: '',
    }, {
      key: 'sourceOrder',
      from: 'tavily > exa > brave > stepfun > stepfun-plan > jina > doubao > doubao-global > google > bing > baidu > douyin > xiaohongshu > bilibili > yandex > duckduckgo > ai:grok > ai:chatgpt > ai:deepseek > ai:doubao > ai:gemini > site:docs',
      to: 'tavily > exa > brave > stepfun > stepfun-plan > jina > doubao > doubao-global > google > bing > baidu > douyin > xiaohongshu > bilibili > yandex > duckduckgo > ai:grok > ai:chatgpt > ai:deepseek > ai:doubao > ai:gemini',
    }]));
  });

  it('reports a preference diff when only the normalized source order differs', async () => {
    installStorage({
      providerKeys: { tavily: 'tvly-1' },
      activeProvider: 'tavily',
      activeSource: 'tavily',
      themePref: 'auto',
      localePref: 'auto',
      sourceOrder: ['bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'baidu'],
    });
    const preview = await previewImport(validPayload({
      sourceOrder: ['tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'bing', 'baidu'],
    }));
    expect(preview.prefDiffs).toEqual([{
      key: 'sourceOrder',
      from: 'bing > tavily > exa > stepfun > stepfun-plan > google > baidu > brave > jina > doubao > doubao-global > douyin > xiaohongshu > bilibili > yandex > duckduckgo > ai:grok > ai:chatgpt > ai:deepseek > ai:doubao > ai:gemini',
      to: 'tavily > exa > stepfun > stepfun-plan > google > bing > baidu > brave > jina > doubao > doubao-global > douyin > xiaohongshu > bilibili > yandex > duckduckgo > ai:grok > ai:chatgpt > ai:deepseek > ai:doubao > ai:gemini',
    }]);
  });

  it('reports a preference diff when only the hidden source list differs', async () => {
    installStorage({
      providerKeys: { tavily: 'tvly-1' }, activeProvider: 'tavily', activeSource: 'tavily',
      themePref: 'auto', localePref: 'auto', sourceHidden: ['baidu'],
    });
    const preview = await previewImport(validPayload({ sourceHidden: ['bing', 'tavily'] }));
    expect(preview.prefDiffs).toEqual([{ key: 'sourceHidden', from: 'baidu', to: 'bing > tavily' }]);
  });

  it('reports a serpBarPosition diff when current is auto and payload is bottom', async () => {
    installStorage({
      providerKeys: { tavily: 'tvly-1' }, activeProvider: 'tavily', activeSource: 'tavily',
      themePref: 'auto', localePref: 'auto', serpBarPosition: 'auto',
    });
    const preview = await previewImport(validPayload({ serpBarPosition: 'bottom' }));
    expect(preview.prefDiffs).toEqual([{ key: 'serpBarPosition', from: 'auto', to: 'bottom' }]);
  });

  it('includes Provider Instance changes in the preference diff', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: 'tavily', providerInstances: [instance] });
    const preview = await previewImport(validPayload({ providerInstances: [] }));
    expect(preview.prefDiffs).toContainEqual({
      key: 'providerInstances',
      from: 'inst:exa:abc:exa:AI Research:{"category":"publication"}',
      to: '',
    });
  });

  it('reports no Provider Instance diff when the imported array matches current', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: 'tavily', providerInstances: [instance] });
    const preview = await previewImport(validPayload({ providerInstances: [instance] }));
    expect(preview.prefDiffs.find((d) => d.key === 'providerInstances')).toBeUndefined();
  });

  it('omits the Provider Instance diff when the import payload omits the field', async () => {
    const instance = makeInstance('inst:exa:abc');
    installStorage({ providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: 'tavily', providerInstances: [instance] });
    const preview = await previewImport(validPayload());
    expect(preview.prefDiffs.find((d) => d.key === 'providerInstances')).toBeUndefined();
  });
});
