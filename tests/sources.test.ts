import { describe, it, expect } from 'vitest';
import { allSources, isEngineId, isProviderId, normalizeSourceOrder } from '@/lib/sources';

describe('allSources', () => {
  it('lists configured providers first, then all engines', () => {
    const sources = allSources(['tavily']);
    const ids = sources.map((s) => s.id);
    expect(ids).toEqual(['tavily', 'google', 'bing', 'baidu']);
  });

  it('filters out unconfigured providers but keeps all engines', () => {
    const sources = allSources(['exa']);
    const providerIds = sources.filter((s) => s.kind === 'provider').map((s) => s.id);
    const engineIds = sources.filter((s) => s.kind === 'engine').map((s) => s.id);
    expect(providerIds).toEqual(['exa']);
    expect(engineIds).toEqual(['google', 'bing', 'baidu']);
  });

  it('with no configured providers, only engines remain', () => {
    const sources = allSources([]);
    expect(sources.map((s) => s.id)).toEqual(['google', 'bing', 'baidu']);
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
    expect(allSources(['tavily', 'exa'], ['bing', 'exa', 'google', 'tavily', 'baidu', 'stepfun', 'stepfun-plan'])
      .map((source) => source.id)).toEqual(['bing', 'exa', 'google', 'tavily', 'baidu']);
  });

  it('normalizes unknown, duplicate, and omitted source ids', () => {
    expect(normalizeSourceOrder(['bing', 'ghost', 'tavily', 'bing'])).toEqual([
      'bing', 'tavily', 'exa', 'stepfun', 'stepfun-plan', 'google', 'baidu',
    ]);
  });
});

describe('type guards', () => {
  it('isEngineId recognizes engine ids', () => {
    expect(isEngineId('google')).toBe(true);
    expect(isEngineId('bing')).toBe(true);
    expect(isEngineId('baidu')).toBe(true);
    expect(isEngineId('tavily')).toBe(false);
  });

  it('isProviderId recognizes provider ids', () => {
    expect(isProviderId('tavily')).toBe(true);
    expect(isProviderId('stepfun-plan')).toBe(true);
    expect(isProviderId('google')).toBe(false);
  });
});
