import { describe, it, expect } from 'vitest';
import { allEngines, getEngine, buildSerpUrl, matchEngineByUrl, extractQuery } from '@/lib/engines/registry';

describe('engine registry', () => {
  it('contains google + bing (v2 scope)', () => {
    expect(allEngines().map((e) => e.id).sort()).toEqual(['bing', 'google']);
  });

  it('each engine declares query param + serp url template', () => {
    for (const e of allEngines()) {
      expect(e.queryParam).toBe('q');
      expect(e.serpUrlTemplate).toContain('{q}');
    }
  });

  it('throws on unknown id', () => {
    expect(() => getEngine('ddg' as never)).toThrow(/Unknown engine/);
  });
});

describe('buildSerpUrl', () => {
  it('encodes the query into the google serp url', () => {
    expect(buildSerpUrl(getEngine('google'), 'hello world')).toBe(
      'https://www.google.com/search?q=hello%20world',
    );
  });

  it('encodes special characters', () => {
    expect(buildSerpUrl(getEngine('bing'), 'a&b=c')).toBe('https://www.bing.com/search?q=a%26b%3Dc');
  });
});

describe('matchEngineByUrl', () => {
  it('matches google www host', () => {
    expect(matchEngineByUrl('https://www.google.com/search?q=x')?.id).toBe('google');
  });

  it('matches bing www host', () => {
    expect(matchEngineByUrl('https://www.bing.com/search?q=x')?.id).toBe('bing');
  });

  it('returns null for non-engine host (e.g. country domain)', () => {
    expect(matchEngineByUrl('https://www.google.co.jp/search?q=x')).toBeNull();
  });

  it('returns null for invalid url', () => {
    expect(matchEngineByUrl('not a url')).toBeNull();
  });
});

describe('extractQuery', () => {
  it('extracts google q param', () => {
    expect(extractQuery('https://www.google.com/search?q=react+hooks')).toBe('react hooks');
  });

  it('extracts bing q param', () => {
    expect(extractQuery('https://www.bing.com/search?q=hello')).toBe('hello');
  });

  it('returns null when q is absent', () => {
    expect(extractQuery('https://www.google.com/search')).toBeNull();
  });

  it('returns null on non-engine host', () => {
    expect(extractQuery('https://example.com/search?q=x')).toBeNull();
  });
});
