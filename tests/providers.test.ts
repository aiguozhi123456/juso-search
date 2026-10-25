import { describe, it, expect } from 'vitest';
import { allProviders, getAdapter, isProviderKeyless } from '@/lib/providers/registry';
import type { ProviderId } from '@/lib/providers/types';

describe('provider registry', () => {
  it('contains the eleven providers', () => {
    const ids = allProviders().map((p) => p.id).sort();
    expect(ids).toEqual(['anysearch', 'brave', 'deepseek', 'doubao', 'doubao-global', 'exa', 'jina', 'parallel', 'stepfun', 'stepfun-plan', 'tavily']);
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
    ['deepseek', false],
    ['anysearch', false],
  ] as Array<[ProviderId, boolean]>)('declares supportsAnswer=%s for %s', (id, expected) => {
    expect(getAdapter(id).supportsAnswer).toBe(expected);
  });

  // keyOptional 锁表：免 key 集合的任何增删都必须显式改这张表（防漂移，同 supportsAnswer 先例）。
  // 契约：未声明时属性缺省（undefined，defineProvider 不展开），读取一律 === true。
  it.each([
    ['tavily', true],
    ['exa', false],
    ['brave', false],
    ['stepfun', false],
    ['stepfun-plan', false],
    ['jina', true],
    ['doubao', false],
    ['doubao-global', false],
    ['parallel', false],
    ['deepseek', false],
    ['anysearch', true],
  ] as Array<[ProviderId, boolean]>)('declares keyOptional=%s for %s', (id, expected) => {
    expect(getAdapter(id).keyOptional === true).toBe(expected);
    expect(isProviderKeyless(id)).toBe(expected);
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
    // deepseek 与 ai:deepseek 对话引擎同品牌，共享同一品牌图标。
    ['deepseek', '/icons/ai-deepseek.svg'],
    ['anysearch', '/icons/anysearch.svg'],
  ] as Array<[ProviderId, string]>)('declares favicon=%s for %s', (id, expected) => {
    expect(getAdapter(id).favicon).toBe(expected);
  });

  it('throws on unknown id', () => {
    expect(() => getAdapter('nope' as ProviderId)).toThrow(/Unknown provider/);
  });
});
