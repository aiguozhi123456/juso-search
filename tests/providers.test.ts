import { describe, it, expect } from 'vitest';
import { allProviders, getAdapter } from '@/lib/providers/registry';
import type { ProviderId } from '@/lib/providers/types';

describe('provider registry', () => {
  it('contains the four v1 providers', () => {
    const ids = allProviders().map((p) => p.id).sort();
    expect(ids).toEqual(['exa', 'stepfun', 'stepfun-plan', 'tavily']);
  });

  it.each([
    ['tavily', true],
    ['exa', true],
    ['stepfun', false],
    ['stepfun-plan', false],
  ] as Array<[ProviderId, boolean]>)('declares supportsAnswer=%s for %s', (id, expected) => {
    expect(getAdapter(id).supportsAnswer).toBe(expected);
  });

  it.each([
    ['tavily', '/icons/tavily.svg'],
    ['exa', '/icons/exa.svg'],
    ['stepfun', '/icons/stepfun.svg'],
    // stepfun-plan 与 stepfun 同公司，共享同一品牌图标。
    ['stepfun-plan', '/icons/stepfun.svg'],
  ] as Array<[ProviderId, string]>)('declares favicon=%s for %s', (id, expected) => {
    expect(getAdapter(id).favicon).toBe(expected);
  });

  it('throws on unknown id', () => {
    expect(() => getAdapter('nope' as ProviderId)).toThrow(/Unknown provider/);
  });
});
