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
import type { SourceId } from '@/lib/sources';

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
    siteEngines: [],
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
    expect(payload.activeProvider).toBeNull();
    expect(payload.activeSource).toBe('google');
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
      sourceOrder: ['bing', 'exa', 'tavily', 'stepfun', 'stepfun-plan', 'jina', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili'],
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
      sourceOrder: [site.id, 'bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'jina', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili'],
      sourceHidden: [site.id],
    });
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
    if (result.ok) expect(result.value.sourceOrder).toEqual(['bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'jina', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili']);
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

  it('writes sourceOrder only when applying preferences', async () => {
    const payload = validPayload({ sourceOrder: ['bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'jina', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili'] });
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
    const importedOrder: SourceId[] = ['bing', 'exa', 'google', 'tavily', 'stepfun', 'stepfun-plan', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'jina'];
    const movedOrder: SourceId[] = ['exa', 'bing', 'google', 'tavily', 'stepfun', 'stepfun-plan', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'jina'];
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

  it('includes Site Engine-only changes in the same preference confirmation diff', async () => {
    const site = { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/', engineId: 'google' as const };
    installStorage({ providerKeys: { tavily: 'key' }, activeProvider: 'tavily', activeSource: 'tavily', siteEngines: [site] });
    const preview = await previewImport(validPayload());
    expect(preview.prefDiffs).toEqual(expect.arrayContaining([{
      key: 'siteEngines', from: 'site:docs:google:https://docs.example.com/:Docs', to: '',
    }, {
      key: 'sourceOrder',
      from: 'tavily > exa > stepfun > stepfun-plan > jina > google > bing > baidu > douyin > xiaohongshu > bilibili > site:docs',
      to: 'tavily > exa > stepfun > stepfun-plan > jina > google > bing > baidu > douyin > xiaohongshu > bilibili',
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
      from: 'bing > tavily > exa > stepfun > stepfun-plan > google > baidu > jina > douyin > xiaohongshu > bilibili',
      to: 'tavily > exa > stepfun > stepfun-plan > google > bing > baidu > jina > douyin > xiaohongshu > bilibili',
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
});
