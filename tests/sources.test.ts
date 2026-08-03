import { describe, it, expect } from 'vitest';
import { allSources, allKnownSourceIds, isEngineId, isProviderId, isKnownCustomEngineId, normalizeSourceHidden, normalizeSourceOrder, resolveEffectiveActiveSource, sourceLabel } from '@/lib/sources';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import type { CustomEngineDefinition } from '@/lib/custom-engines';
import type { ProviderInstance } from '@/lib/provider-instances';

// sourceOrder 默认补尾顺序：provider(registry) → engine(registry) → ai-engine(registry)。
// registry 里 engine 顺序为 google → bing → baidu → douyin → xiaohongshu → bilibili → yandex → duckduckgo；
// AI engine 顺序为 ai:grok → ai:chatgpt → ai:deepseek → ai:doubao → ai:gemini（全部位于 duckduckgo 之后）。
// 注：默认隐藏（douyin / xiaohongshu / bilibili / yandex / duckduckgo / 5 个 AI engine）是 schema 迁移写入 sourceHidden 的结果，
//     不由 allSources 投影层决定——本文件测的是投影函数本身。
const DEFAULT_ENGINE_ORDER = ['google', 'bing', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo'] as const;
const AI_ENGINE_ORDER = ['ai:grok', 'ai:chatgpt', 'ai:deepseek', 'ai:doubao', 'ai:gemini'] as const;

describe('allSources', () => {
  it('lists configured providers first, then all engines', () => {
    const sources = allSources(['tavily']);
    const ids = sources.map((s) => s.id);
    expect(ids).toEqual(['tavily', ...DEFAULT_ENGINE_ORDER, ...AI_ENGINE_ORDER]);
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
    expect(sources.map((s) => s.id)).toEqual([...DEFAULT_ENGINE_ORDER, ...AI_ENGINE_ORDER]);
    expect(sources.every((s) => s.kind === 'engine' || s.kind === 'ai-engine')).toBe(true);
  });

  it('projects AI engines as ai-engine sources with supportsAnswer=false', () => {
    const sources = allSources([]);
    const aiEngineIds = sources.filter((s) => s.kind === 'ai-engine').map((s) => s.id);
    expect(aiEngineIds).toEqual([...AI_ENGINE_ORDER]);
    for (const source of sources.filter((s) => s.kind === 'ai-engine')) {
      expect(source.supportsAnswer).toBe(false);
      expect(source.favicon).toBeTruthy();
    }
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
      .map((source) => source.id)).toEqual(['bing', 'exa', 'google', 'tavily', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_ORDER]);
  });

  it('normalizes unknown, duplicate, and omitted source ids', () => {
    expect(normalizeSourceOrder(['bing', 'ghost', 'tavily', 'bing'])).toEqual([
      'bing', 'tavily', 'exa', 'brave', 'stepfun', 'stepfun-plan', 'jina', 'doubao', 'doubao-global', 'google', 'baidu', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_ORDER,
    ]);
  });

  it('filters out hidden providers and engines', () => {
    const sources = allSources(['tavily', 'exa'], undefined, ['tavily', 'baidu']);
    expect(sources.map((s) => s.id)).toEqual(['exa', 'google', 'bing', 'douyin', 'xiaohongshu', 'bilibili', 'yandex', 'duckduckgo', ...AI_ENGINE_ORDER]);
  });

  it('ignores an empty hidden list', () => {
    expect(allSources(['tavily'], undefined, []).map((s) => s.id)).toEqual(['tavily', ...DEFAULT_ENGINE_ORDER, ...AI_ENGINE_ORDER]);
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

describe('Provider Instance source projection', () => {
  const instances: ProviderInstance[] = [
    { id: 'inst:exa:ai-research', baseProviderId: 'exa', name: 'AI 研究', options: { category: 'publication' } },
    { id: 'inst:exa:startup-news', baseProviderId: 'exa', name: '创业资讯', options: { category: 'news' } },
  ];

  it('projects instance pills instead of the bare provider pill when instances exist', () => {
    const sources = allSources(['exa'], undefined, undefined, [], [], instances);
    const ids = sources.map((s) => s.id);
    expect(ids).not.toContain('exa'); // 无裸 provider pill
    expect(ids).toContain('inst:exa:ai-research');
    expect(ids).toContain('inst:exa:startup-news');
    const instanceSources = sources.filter((s) => s.kind === 'provider-instance');
    expect(instanceSources).toHaveLength(2);
  });

  it('projects the bare provider pill when a provider has no instances', () => {
    const sources = allSources(['tavily', 'exa'], undefined, undefined, [], [], instances);
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('tavily');
    const tavilySource = sources.find((s) => s.id === 'tavily');
    expect(tavilySource && tavilySource.kind).toBe('provider');
    expect(ids).not.toContain('exa');
  });

  it('carries literal label, base-adapter favicon and supportsAnswer on instance sources', () => {
    const sources = allSources(['exa'], undefined, undefined, [], [], instances);
    const instance = sources.find((s) => s.id === 'inst:exa:ai-research');
    expect(instance).toMatchObject({
      kind: 'provider-instance',
      label: 'AI 研究',
      labelDescriptor: { kind: 'literal', value: 'AI 研究' },
      favicon: '/icons/exa.svg',
      supportsAnswer: true, // 继承 base adapter
      providerInstance: instances[0],
    });
  });

  it('keeps instance labels literal even when they look like an i18n key', () => {
    const weird = { id: 'inst:exa:weird', baseProviderId: 'exa', name: 'engine_google', options: {} } as ProviderInstance;
    const source = allSources(['exa'], undefined, undefined, [], [], [weird]).find((s) => s.id === 'inst:exa:weird');
    expect(source && sourceLabel(source, (key) => `translated:${key}`)).toBe('engine_google');
  });

  it('projects same-provider instances adjacent within the provider block', () => {
    const sources = allSources(['tavily', 'exa', 'brave'], undefined, undefined, [], [], instances);
    const ids = sources.map((s) => s.id);
    const i1 = ids.indexOf('inst:exa:ai-research');
    const i2 = ids.indexOf('inst:exa:startup-news');
    expect(i1).toBeGreaterThan(ids.indexOf('tavily'));
    expect(Math.abs(i1 - i2)).toBe(1); // 相邻
    expect(i2).toBeLessThan(ids.indexOf('brave')); // 仍位于 provider 块内
  });

  it('orders instances within a provider group by sourceOrder', () => {
    const sources = allSources(['exa'], ['inst:exa:startup-news', 'inst:exa:ai-research'], undefined, [], [], instances);
    const instanceIds = sources.filter((s) => s.kind === 'provider-instance').map((s) => s.id);
    expect(instanceIds).toEqual(['inst:exa:startup-news', 'inst:exa:ai-research']);
  });

  it('dedupes instance ids spread across sourceOrder', () => {
    const sources = allSources(['exa'], ['inst:exa:ai-research', 'google', 'inst:exa:startup-news'], undefined, [], [], instances);
    const instanceIds = sources.filter((s) => s.kind === 'provider-instance').map((s) => s.id);
    // 组内相对顺序按 sourceOrder（ai-research 在 startup-news 前），且各只出现一次
    expect(instanceIds).toEqual(['inst:exa:ai-research', 'inst:exa:startup-news']);
  });

  it('hides a provider instance listed in hiddenSourceIds', () => {
    const sources = allSources(['exa'], undefined, ['inst:exa:startup-news'], [], [], instances);
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('inst:exa:ai-research');
    expect(ids).not.toContain('inst:exa:startup-news');
  });

  it('drops instances whose base provider is unconfigured', () => {
    const sources = allSources([], undefined, undefined, [], [], instances);
    expect(sources.some((s) => s.kind === 'provider-instance')).toBe(false);
  });

  it('allKnownSourceIds includes provider instance ids', () => {
    const known = allKnownSourceIds([], [], instances);
    expect(known).toContain('inst:exa:ai-research');
    expect(known).toContain('inst:exa:startup-news');
  });

  it('normalizeSourceOrder preserves known instance ids and appends missing ones', () => {
    const order = normalizeSourceOrder(['inst:exa:startup-news', 'google'], [], [], instances);
    expect(order.indexOf('inst:exa:startup-news')).toBeLessThan(order.indexOf('google'));
    expect(order).toContain('inst:exa:ai-research'); // 缺失实例按定义顺序补尾
    expect(order).not.toContain('inst:unknown:ghost');
  });

  it('normalizeSourceHidden recognizes known instance ids', () => {
    expect(normalizeSourceHidden(['inst:exa:ai-research', 'inst:unknown:ghost', 'google'], [], [], instances)).toEqual(['inst:exa:ai-research', 'google']);
  });
});

describe('resolveEffectiveActiveSource', () => {
  const instances: ProviderInstance[] = [
    { id: 'inst:exa:ai-research', baseProviderId: 'exa', name: 'AI 研究', options: {} },
  ];

  it('maps a bare provider id to the first instance id when instances exist (BUG-1)', () => {
    expect(resolveEffectiveActiveSource('exa', { exa: 'key' }, [], [], instances)).toBe('inst:exa:ai-research');
  });

  it('keeps a bare provider id when no instances exist (BUG-1)', () => {
    expect(resolveEffectiveActiveSource('exa', { exa: 'key' }, [], [], [])).toBe('exa');
  });

  it('returns an instance id whose base provider has a key (BUG-1)', () => {
    expect(resolveEffectiveActiveSource('inst:exa:ai-research', { exa: 'key' }, [], [], instances)).toBe('inst:exa:ai-research');
  });

  it('returns engine / site / custom sources as-is', () => {
    const site: SiteEngineDefinition = { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com', engineId: 'google' };
    const custom: CustomEngineDefinition = { id: 'custom:alpha', name: 'Alpha', urlTemplate: 'https://alpha.com/%s' };
    expect(resolveEffectiveActiveSource('google', {}, [], [], [])).toBe('google');
    expect(resolveEffectiveActiveSource('site:docs', {}, [site], [], [])).toBe('site:docs');
    expect(resolveEffectiveActiveSource('custom:alpha', {}, [], [custom], [])).toBe('custom:alpha');
  });

  it('falls back to the first configured provider with the same instance mapping', () => {
    expect(resolveEffectiveActiveSource(null, { exa: 'key' }, [], [], instances)).toBe('inst:exa:ai-research');
    expect(resolveEffectiveActiveSource(null, { exa: 'key' }, [], [], [])).toBe('exa');
    expect(resolveEffectiveActiveSource('ghost' as never, { exa: 'key' }, [], [], [])).toBe('exa');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveEffectiveActiveSource(null, {}, [], [], [])).toBeUndefined();
    expect(resolveEffectiveActiveSource('tavily', {}, [], [], [])).toBeUndefined();
    expect(resolveEffectiveActiveSource(undefined, {}, [], [], [])).toBeUndefined();
  });
});
