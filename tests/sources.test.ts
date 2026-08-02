import { describe, it, expect } from 'vitest';
import { allSources, isEngineId, isProviderId, isKnownCustomEngineId, normalizeSourceHidden, normalizeSourceOrder, sourceLabel } from '@/lib/sources';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import type { CustomEngineDefinition } from '@/lib/custom-engines';

// sourceOrder 默认补尾顺序：provider(registry) → engine(registry)。
// registry 里 engine 顺序为 google → bing → baidu → douyin → xiaohongshu → bilibili → yandex → duckduckgo。
// 注：默认隐藏（douyin / xiaohongshu / bilibili / yandex / duckduckgo）是 schema 迁移写入 sourceHidden 的结果，
//     不由 allSources 投影层决定——本文件测的是投影函数本身。
const DEFAULT_ENGINE_ORDER = ['google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo'] as const;

describe('allSources', () => {
  it('lists configured providers first, then all engines', () => {
    const sources = allSources(['tavily']);
    const ids = sources.map((s) => s.id);
    expect(ids).toEqual(['tavily', ...DEFAULT_ENGINE_ORDER]);
  });

  it('filters out unconfigured providers but keeps all engines', () => {
    const sources = allSources(['exa']);
    const providerIds = sources.filter((s) => s.kind === 'provider').map((s) => s.id);
    const engineIds = sources.filter((s) => s.kind === 'engine').map((s) => s.id);
    expect(providerIds).toEqual(['exa']);
    expect(engineIds).toEqual([...DEFAULT_ENGINE_ORDER]);
  });

  it('with no configured providers, only engines remain', () => {
    const sources = allSources([]);
    expect(sources.map((s) => s.id)).toEqual([...DEFAULT_ENGINE_ORDER]);
    expect(sources.every((s) => s.kind === 'engine')).toBe(true);
  });

  it('preserves provider registry order', () => {
    const sources = allSources(['stepfun', 'tavily', 'exa', 'stepfun-plan']);
    const providerIds = sources.filter((s) => s.kind === 'provider').map((s) => s.id);
    expect(providerIds).toEqual(['tavily', 'exa', 'stepfun', 'stepfun-plan']);
  });

  it('engines always have supportsAnswer=false and a favicon', () => {
    const sources = allSources(['tavily']);
    for (const e of sources.filter((s) => s.kind === 'engine')) {
      expect(e.supportsAnswer).toBe(false);
      expect(e.favicon).toBeTruthy();
    }
  });

  it('providers carry supportsAnswer from the adapter', () => {
    const sources = allSources(['tavily', 'stepfun']);
    const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
    expect(byId.tavily.supportsAnswer).toBe(true);
    expect(byId.stepfun.supportsAnswer).toBe(false);
  });

  it('providers carry a favicon from the adapter', () => {
    const sources = allSources(['tavily', 'exa', 'stepfun', 'stepfun-plan']);
    const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
    expect(byId.tavily.favicon).toBe('/icons/tavily.svg');
    expect(byId.exa.favicon).toBe('/icons/exa.svg');
    expect(byId.stepfun.favicon).toBe('/icons/stepfun.svg');
    // stepfun-plan 与 stepfun 同公司，共享同一品牌图标。
    expect(byId['stepfun-plan'].favicon).toBe('/icons/stepfun.svg');
  });

  it('projects configured providers and engines in a custom mixed order', () => {
    expect(allSources(['tavily', 'exa'], ['bing', 'exa', 'google', 'tavily', 'baidu', 'stepfun', 'stepfun-plan', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo'])
      .map((source) => source.id)).toEqual(['bing', 'exa', 'google', 'tavily', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo']);
  });

  it('normalizes unknown, duplicate, and omitted source ids', () => {
    expect(normalizeSourceOrder(['bing', 'ghost', 'tavily', 'bing'])).toEqual([
      'bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo',
    ]);
  });

  it('filters out hidden providers and engines', () => {
    const sources = allSources(['tavily', 'exa'], undefined, ['tavily', 'baidu']);
    expect(sources.map((s) => s.id)).toEqual(['exa', 'google', 'bing', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo']);
  });

  it('ignores an empty hidden list', () => {
    expect(allSources(['tavily'], undefined, []).map((s) => s.id)).toEqual(['tavily', ...DEFAULT_ENGINE_ORDER]);
  });
});

describe('normalizeSourceHidden', () => {
  it('keeps known ids, dedupes, preserves first-seen order', () => {
    expect(normalizeSourceHidden(['baidu', 'ghost', 'tavily', 'baidu', 123 as never])).toEqual(['baidu', 'tavily']);
  });
  it('returns empty for non-array', () => {
    expect(normalizeSourceHidden(undefined)).toEqual([]);
    expect(normalizeSourceHidden('tavily')).toEqual([]);
  });
});

describe('Site Engine source projection', () => {
  const sites: SiteEngineDefinition[] = [
    { id: 'site:zeta', name: 'Literal Name', target: 'https://z.example/', engineId: 'google' },
    { id: 'site:alpha', name: 'engine_google', target: 'https://a.example/', engineId: 'bing' },
  ];

  it('normalizes dynamic ids, appending missing definitions deterministically', () => {
    const order = normalizeSourceOrder(['site:zeta', 'site:unknown'], sites);
    expect(order.indexOf('site:zeta')).toBeLessThan(order.indexOf('site:alpha'));
    expect(order).toContain('site:alpha');
    expect(normalizeSourceHidden(['site:unknown', 'site:alpha', 'site:alpha'], sites)).toEqual(['site:alpha']);
  });

  it('projects known sites in saved order and omits unknown dynamic ids', () => {
    const sources = allSources([], ['site:zeta', 'site:unknown', 'site:alpha'], ['site:alpha'], sites);
    expect(sources.filter((source) => source.kind === 'site-engine').map((source) => source.id)).toEqual(['site:zeta']);
    expect(sources.find((source) => source.id === 'site:zeta')).toMatchObject({
      label: 'Literal Name', favicon: '/icons/site.svg', supportsAnswer: false,
      labelDescriptor: { kind: 'literal', value: 'Literal Name' },
    });
  });

  it('keeps user-defined labels literal even when they look like an i18n key', () => {
    const source = allSources([], undefined, undefined, sites).find((item) => item.id === 'site:alpha');
    expect(source && sourceLabel(source, (key) => `translated:${key}`)).toBe('engine_google');
  });

  it('translates registry labels through the supplied resolver', () => {
    const source = allSources([]).find((item) => item.id === 'google');
    expect(source && sourceLabel(source, (key) => `translated:${key}`)).toBe('translated:engine_google');
  });
});

describe('Custom Engine source projection', () => {
  const customs: CustomEngineDefinition[] = [
    { id: 'custom:alpha', name: 'Alpha Search', urlTemplate: 'https://alpha.com/search?q=%s' },
    { id: 'custom:beta', name: 'Beta Search', urlTemplate: 'https://beta.com/%s' },
  ];

  it('projects custom definitions as kind custom-engine sources', () => {
    const sources = allSources([], undefined, undefined, [], customs);
    const customSources = sources.filter((s) => s.kind === 'custom-engine');
    expect(customSources.map((s) => s.id)).toEqual(['custom:alpha', 'custom:beta']);
    expect(customSources[0]).toMatchObject({
      label: 'Alpha Search', favicon: '/icons/custom-engine.svg', supportsAnswer: false,
      labelDescriptor: { kind: 'literal', value: 'Alpha Search' },
      customEngine: customs[0],
    });
  });

  it('respects sourceOrder for custom engines', () => {
    const order = ['custom:beta', 'google', 'custom:alpha'] as const;
    const sources = allSources([], [...order], undefined, [], customs);
    const ids = sources.map((s) => s.id);
    expect(ids.indexOf('custom:beta')).toBeLessThan(ids.indexOf('google'));
    expect(ids.indexOf('google')).toBeLessThan(ids.indexOf('custom:alpha'));
  });

  it('hides custom engines listed in hiddenSourceIds', () => {
    const sources = allSources([], undefined, ['custom:alpha'], [], customs);
    const customIds = sources.filter((s) => s.kind === 'custom-engine').map((s) => s.id);
    expect(customIds).toEqual(['custom:beta']);
  });

  it('keeps user-defined labels literal even when they look like an i18n key', () => {
    const source = allSources([], undefined, undefined, [], customs).find((s) => s.id === 'custom:alpha');
    expect(source && sourceLabel(source, (key) => `translated:${key}`)).toBe('Alpha Search');
  });
});

describe('normalizeSourceOrder with custom engines', () => {
  const customs: CustomEngineDefinition[] = [
    { id: 'custom:alpha', name: 'Alpha', urlTemplate: 'https://alpha.com/%s' },
    { id: 'custom:beta', name: 'Beta', urlTemplate: 'https://beta.com/%s' },
  ];

  it('preserves valid custom ids in order', () => {
    const order = normalizeSourceOrder(['custom:beta', 'google', 'custom:alpha'], [], customs);
    expect(order.indexOf('custom:beta')).toBeLessThan(order.indexOf('google'));
    expect(order.indexOf('google')).toBeLessThan(order.indexOf('custom:alpha'));
  });

  it('appends missing custom definitions at the end', () => {
    const order = normalizeSourceOrder(['google'], [], customs);
    expect(order).toContain('custom:alpha');
    expect(order).toContain('custom:beta');
    // They come after all default sources
    expect(order.indexOf('custom:alpha')).toBeGreaterThan(order.indexOf('duckduckgo'));
  });

  it('drops unknown custom ids not in definitions', () => {
    const order = normalizeSourceOrder(['custom:unknown', 'google'], [], customs);
    expect(order).not.toContain('custom:unknown');
    expect(order).toContain('google');
  });
});

describe('normalizeSourceHidden with custom engines', () => {
  const customs: CustomEngineDefinition[] = [
    { id: 'custom:alpha', name: 'Alpha', urlTemplate: 'https://alpha.com/%s' },
  ];

  it('recognizes known custom ids', () => {
    expect(normalizeSourceHidden(['custom:alpha', 'custom:unknown', 'google'], [], customs)).toEqual(['custom:alpha', 'google']);
  });

  it('dedupes custom ids', () => {
    expect(normalizeSourceHidden(['custom:alpha', 'custom:alpha'], [], customs)).toEqual(['custom:alpha']);
  });
});

describe('isKnownCustomEngineId', () => {
  const customs: CustomEngineDefinition[] = [
    { id: 'custom:alpha', name: 'Alpha', urlTemplate: 'https://alpha.com/%s' },
  ];

  it('returns true for a known custom engine id', () => {
    expect(isKnownCustomEngineId('custom:alpha', customs)).toBe(true);
  });

  it('returns false for an unknown custom engine id', () => {
    expect(isKnownCustomEngineId('custom:unknown', customs)).toBe(false);
  });

  it('returns false for a non-custom id', () => {
    expect(isKnownCustomEngineId('google', customs)).toBe(false);
    expect(isKnownCustomEngineId('site:alpha', customs)).toBe(false);
  });
});

describe('type guards', () => {
  it('isEngineId recognizes engine ids', () => {
    for (const id of DEFAULT_ENGINE_ORDER) {
      expect(isEngineId(id)).toBe(true);
    }
    expect(isEngineId('tavily')).toBe(false);
  });

  it('isProviderId recognizes provider ids', () => {
    expect(isProviderId('tavily')).toBe(true);
    expect(isProviderId('stepfun-plan')).toBe(true);
    expect(isProviderId('google')).toBe(false);
  });
});
