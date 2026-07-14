import { describe, expect, it } from 'vitest';
import { allEngines, getEngine, matchEngineByUrl, extractQuery, anchorFor } from '@/lib/engines/registry';
import { DEFAULT_ANCHOR } from '@/lib/engines/types';

describe('engine registry', () => {
  it('registers google + bing', () => {
    expect(allEngines().map((e) => e.id).sort()).toEqual(['bing', 'google']);
  });

  it('getEngine throws on unknown id', () => {
    expect(() => getEngine('ddg' as never)).toThrow(/Unknown engine/);
  });
});

describe('buildSerpUrl', () => {
  it('google encodes the query', () => {
    expect(getEngine('google').buildSerpUrl('hello world')).toBe(
      'https://www.google.com/search?q=hello%20world',
    );
  });
  it('bing encodes special chars', () => {
    expect(getEngine('bing').buildSerpUrl('a&b=c')).toBe('https://www.bing.com/search?q=a%26b%3Dc');
  });
});

describe('matchEngineByUrl', () => {
  it('matches google host', () => {
    expect(matchEngineByUrl('https://www.google.com/search?q=x')?.id).toBe('google');
  });
  it('matches bing host', () => {
    expect(matchEngineByUrl('https://www.bing.com/search?q=x')?.id).toBe('bing');
  });
  it('rejects unsupported ccTLD', () => {
    expect(matchEngineByUrl('https://www.google.co.jp/search?q=x')).toBeNull();
  });
  it('rejects non-url', () => {
    expect(matchEngineByUrl('not a url')).toBeNull();
  });
});

describe('extractQuery', () => {
  it('decodes google query', () => {
    expect(extractQuery('https://www.google.com/search?q=react+hooks')).toBe('react hooks');
  });
  it('returns bing query', () => {
    expect(extractQuery('https://www.bing.com/search?q=hello')).toBe('hello');
  });
  it('returns null when no query param', () => {
    expect(extractQuery('https://www.google.com/search')).toBeNull();
  });
  it('returns null for unknown host', () => {
    expect(extractQuery('https://example.com/search?q=x')).toBeNull();
  });
});

describe('anchor strategy', () => {
  it('bing anchors before #b_content with alignTo', () => {
    expect(anchorFor(getEngine('bing'))).toEqual({
      selector: '#b_content',
      append: 'before',
      alignTo: '#b_content',
    });
  });
  it('google anchors before #rcnt and aligns to #center_col above AIO', () => {
    expect(anchorFor(getEngine('google'))).toEqual({
      selector: '#rcnt',
      append: 'before',
      alignTo: '#center_col',
    });
  });
  it('null engine falls back to DEFAULT_ANCHOR', () => {
    expect(anchorFor(null)).toEqual(DEFAULT_ANCHOR);
    expect(anchorFor(null)).toEqual({
      selector: '#rcnt',
      append: 'before',
      alignTo: '#center_col',
    });
  });
  it('regression: Bing avoids its rebuilt result node', () => {
    expect(anchorFor(getEngine('bing')).selector).not.toBe('#b_results');
  });
  it('no engine anchors to body', () => {
    for (const engine of allEngines()) {
      expect(anchorFor(engine).selector).not.toBe('body');
    }
  });
});
