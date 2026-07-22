import { describe, it, expect } from 'vitest';
import { allSources, isEngineId, isProviderId, normalizeSourceHidden, normalizeSourceOrder } from '@/lib/sources';

// sourceOrder 默认补尾顺序：provider(registry) → engine(registry)。
// registry 里 engine 顺序为 google → bing → baidu → douyin → xiaohongshu。
// 注：默认隐藏（douyin / xiaohongshu）是 schema v2 迁移写入 sourceHidden 的结果，
//     不由 allSources 投影层决定——本文件测的是投影函数本身。
const DEFAULT_ENGINE_ORDER = ['google', 'bing', 'baidu', 'douyin', 'xiaohongshu'] as const;

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

  it('projects configured providers and engines in a custom mixed order', () => {
    expect(allSources(['tavily', 'exa'], ['bing', 'exa', 'google', 'tavily', 'baidu', 'stepfun', 'stepfun-plan', 'douyin', 'xiaohongshu'])
      .map((source) => source.id)).toEqual(['bing', 'exa', 'google', 'tavily', 'baidu', 'douyin', 'xiaohongshu']);
  });

  it('normalizes unknown, duplicate, and omitted source ids', () => {
    expect(normalizeSourceOrder(['bing', 'ghost', 'tavily', 'bing'])).toEqual([
      'bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'baidu', 'douyin', 'xiaohongshu',
    ]);
  });

  it('filters out hidden providers and engines', () => {
    const sources = allSources(['tavily', 'exa'], undefined, ['tavily', 'baidu']);
    expect(sources.map((s) => s.id)).toEqual(['exa', 'google', 'bing', 'douyin', 'xiaohongshu']);
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
