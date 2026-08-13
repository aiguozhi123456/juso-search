import { describe, it, expect } from 'vitest';
import { allProviders, getAdapter } from '@/lib/providers/registry';
import type { ProviderId } from '@/lib/providers/types';

describe('provider registry', () => {
  it('contains the eight providers', () => {
    const ids = allProviders().map((p) => p.id).sort();
    expect(ids).toEqual(['brave', 'doubao', 'doubao-global', 'exa', 'jina', 'parallel', 'stepfun', 'stepfun-plan', 'tavily']);
  });

  it.each([
    ['tavily', true],
    ['exa', true],
    ['brave', false],
    ['stepfun', false],
    ['stepfun-plan', false],
    ['jina', false],
    ['doubao', false],
    ['doubao-global', false],
    ['parallel', false],
  ] as Array<[ProviderId, boolean]>)('declares supportsAnswer=%s for %s', (id, expected) => {
    expect(getAdapter(id).supportsAnswer).toBe(expected);
  });

  it.each([
    ['tavily', '/icons/tavily.svg'],
    ['exa', '/icons/exa.svg'],
    ['brave', '/icons/brave.svg'],
    ['stepfun', '/icons/stepfun.svg'],
    // stepfun-plan 与 stepfun 同公司，共享同一品牌图标。
    ['stepfun-plan', '/icons/stepfun.svg'],
    ['jina', '/icons/jina.svg'],
    ['doubao', '/icons/doubao.svg'],
    // doubao-global 与 doubao 同公司，共享同一品牌图标。
    ['doubao-global', '/icons/doubao.svg'],
    ['parallel', '/icons/parallel.svg'],
  ] as Array<[ProviderId, string]>)('declares favicon=%s for %s', (id, expected) => {
    expect(getAdapter(id).favicon).toBe(expected);
  });

  it('throws on unknown id', () => {
    expect(() => getAdapter('nope' as ProviderId)).toThrow(/Unknown provider/);
  });
});
