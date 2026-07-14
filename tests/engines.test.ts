import { describe, expect, it } from 'vitest';
import { allEngines, getEngine, matchEngineByUrl, extractQuery, anchorFor } from '@/lib/engines/registry';
import { DEFAULT_ANCHOR } from '@/lib/engines/types';
import { BAIDU_SERP_HOSTS, BING_SERP_HOSTS, GOOGLE_SERP_HOSTS } from '@/lib/engines/scopes';

describe('engine registry', () => {
  it('registers google + bing + baidu', () => {
    expect(allEngines().map((e) => e.id)).toEqual(['google', 'bing', 'baidu']);
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
  it('baidu encodes the query', () => {
    expect(getEngine('baidu').buildSerpUrl('中文 & space')).toBe(
      'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%26%20space',
    );
  });
});

describe('matchEngineByUrl', () => {
  it('matches google host', () => {
    expect(matchEngineByUrl('https://www.google.com/search?q=x')?.id).toBe('google');
  });
  it('matches Google country hosts', () => {
    expect(matchEngineByUrl('https://www.google.co.jp/search?q=x')?.id).toBe('google');
    expect(matchEngineByUrl('https://www.google.com.hk/search?q=x')?.id).toBe('google');
  });
  it('matches bing host', () => {
    expect(matchEngineByUrl('https://www.bing.com/search?q=x')?.id).toBe('bing');
  });
  it('matches Bing China host', () => {
    expect(matchEngineByUrl('https://cn.bing.com/search?q=x')?.id).toBe('bing');
  });
  it('matches Baidu SERP host', () => {
    expect(matchEngineByUrl('https://www.baidu.com/s?wd=x')?.id).toBe('baidu');
  });
  it('rejects forged and unsupported hosts', () => {
    expect(matchEngineByUrl('https://www.google.co.jp.example.com/search?q=x')).toBeNull();
    expect(matchEngineByUrl('https://www.google.fr/search?q=x')).toBeNull();
    expect(matchEngineByUrl('https://www.bing.co.uk/search?q=x')).toBeNull();
    expect(matchEngineByUrl('https://www.baidu.com.example.com/s?wd=x')).toBeNull();
  });
  it.each([
    'http://www.google.com/search?q=x',
    'https://www.google.com:8443/search?q=x',
    'https://www.google.com/maps?q=x',
    'https://www.google.com/searching?q=x',
    'http://www.bing.com/search?q=x',
    'https://www.bing.com:8443/search?q=x',
    'https://www.bing.com/maps?q=x',
    'https://www.bing.com/searching?q=x',
    'http://www.baidu.com/s?wd=x',
    'https://www.baidu.com:8443/s?wd=x',
    'https://www.baidu.com/search?wd=x',
    'https://www.baidu.com/something?wd=x',
  ])('rejects non-canonical SERP URL %s', (url) => {
    expect(matchEngineByUrl(url)).toBeNull();
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
  it('returns a country-domain Google query', () => {
    expect(extractQuery('https://www.google.co.jp/search?q=react+hooks')).toBe('react hooks');
  });
  it('returns Baidu query', () => {
    expect(extractQuery('https://www.baidu.com/s?wd=react+hooks')).toBe('react hooks');
  });
  it('returns null when no query param', () => {
    expect(extractQuery('https://www.google.com/search')).toBeNull();
  });
  it('returns null for unknown host', () => {
    expect(extractQuery('https://example.com/search?q=x')).toBeNull();
  });
});

describe('engine scopes', () => {
  it('has a registry match for every configured host', () => {
    for (const host of GOOGLE_SERP_HOSTS) {
      expect(matchEngineByUrl(`https://${host}/search?q=x`)?.id).toBe('google');
    }
    for (const host of BING_SERP_HOSTS) {
      expect(matchEngineByUrl(`https://${host}/search?q=x`)?.id).toBe('bing');
    }
    for (const host of BAIDU_SERP_HOSTS) {
      expect(matchEngineByUrl(`https://${host}/s?wd=x`)?.id).toBe('baidu');
    }
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
  it('baidu anchors before #content_left with alignTo', () => {
    expect(anchorFor(getEngine('baidu'))).toEqual({
      selector: '#content_left',
      append: 'before',
      alignTo: '#content_left',
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
