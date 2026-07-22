import { describe, expect, it } from 'vitest';
import { allEngines, getEngine, matchEngineByUrl, extractQuery, anchorsFor } from '@/lib/engines/registry';
import { DEFAULT_ANCHORS } from '@/lib/engines/types';
import { BAIDU_SERP_HOSTS, BING_SERP_HOSTS, DOUYIN_SERP_HOSTS, GOOGLE_SERP_HOSTS, XIAOHONGSHU_SERP_HOSTS } from '@/lib/engines/scopes';

describe('engine registry', () => {
  it('registers google + bing + baidu + douyin + xiaohongshu', () => {
    expect(allEngines().map((e) => e.id)).toEqual(['google', 'bing', 'baidu', 'douyin', 'xiaohongshu']);
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
  it('douyin encodes the query into the path segment', () => {
    expect(getEngine('douyin').buildSerpUrl('hello 世界')).toBe(
      'https://www.douyin.com/search/hello%20%E4%B8%96%E7%95%8C',
    );
  });
  it('xiaohongshu encodes the query into the keyword param', () => {
    expect(getEngine('xiaohongshu').buildSerpUrl('hello 世界')).toBe(
      'https://www.xiaohongshu.com/search_result?keyword=hello%20%E4%B8%96%E7%95%8C',
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
  it('matches Douyin SERP host (query in path segment)', () => {
    expect(matchEngineByUrl('https://www.douyin.com/search/hello')?.id).toBe('douyin');
    expect(matchEngineByUrl('https://www.douyin.com/search/hello/')?.id).toBe('douyin');
  });
  it('rejects Douyin nested paths beyond a single search segment', () => {
    expect(matchEngineByUrl('https://www.douyin.com/search/hello/user')).toBeNull();
    expect(matchEngineByUrl('https://www.douyin.com/search/hello/video/123')).toBeNull();
  });
  it('matches Xiaohongshu SERP host (keyword param)', () => {
    expect(matchEngineByUrl('https://www.xiaohongshu.com/search_result?keyword=hello')?.id).toBe('xiaohongshu');
  });
  it('matches Xiaohongshu SERP host with trailing slash (/search_result/?keyword=)', () => {
    expect(matchEngineByUrl('https://www.xiaohongshu.com/search_result/?keyword=hello&source=web')?.id).toBe('xiaohongshu');
  });
  it('rejects forged and unsupported hosts', () => {
    expect(matchEngineByUrl('https://www.google.co.jp.example.com/search?q=x')).toBeNull();
    expect(matchEngineByUrl('https://www.google.fr/search?q=x')).toBeNull();
    expect(matchEngineByUrl('https://www.bing.co.uk/search?q=x')).toBeNull();
    expect(matchEngineByUrl('https://www.baidu.com.example.com/s?wd=x')).toBeNull();
    expect(matchEngineByUrl('https://www.douyin.com.example.com/search/x')).toBeNull();
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
    // 抖音 query 在 path 段：以下非 canonical 形式应被拒
    'http://www.douyin.com/search/x',
    'https://www.douyin.com:8443/search/x',
    'https://www.douyin.com/searching/x',
    // 小红书 query 在 keyword 参数：非 canonical 路径应被拒
    'http://www.xiaohongshu.com/search_result?keyword=x',
    'https://www.xiaohongshu.com:8443/search_result?keyword=x',
    'https://www.xiaohongshu.com/searching?keyword=x',
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
  it('decodes Douyin query from the path segment', () => {
    expect(extractQuery('https://www.douyin.com/search/react%20hooks')).toBe('react hooks');
  });
  it('decodes Xiaohongshu query from the keyword param', () => {
    expect(extractQuery('https://www.xiaohongshu.com/search_result?keyword=react+hooks')).toBe('react hooks');
  });
  it('decodes Xiaohongshu query from the keyword param (trailing-slash path)', () => {
    expect(extractQuery('https://www.xiaohongshu.com/search_result/?keyword=react+hooks&source=web')).toBe('react hooks');
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
    for (const host of DOUYIN_SERP_HOSTS) {
      expect(matchEngineByUrl(`https://${host}/search/x`)?.id).toBe('douyin');
    }
    for (const host of XIAOHONGSHU_SERP_HOSTS) {
      expect(matchEngineByUrl(`https://${host}/search_result?keyword=x`)?.id).toBe('xiaohongshu');
    }
  });
});

describe('anchor strategy', () => {
  it('bing has a single-element cascade: #b_content + before + alignTo', () => {
    const bing = getEngine('bing');
    expect(bing.anchors).toHaveLength(1);
    expect(bing.anchors[0]).toEqual({
      selector: '#b_content',
      append: 'before',
      alignTo: '#b_content',
    });
  });
  it('bing does not declare pageStyles', () => {
    expect(getEngine('bing').pageStyles).toBeUndefined();
  });
  it('google cascade: primary #rcnt + before + alignTo #center_col (above AIO), fallback #center_col + first', () => {
    // #center_col + first lands below AIO (real-device confirmed 2026-07-17), so the above-AIO
    // strategy is the primary; #center_col + first remains as a defensive fallback for layouts
    // where #rcnt is absent.
    const google = getEngine('google');
    expect(google.anchors).toHaveLength(2);
    expect(google.anchors[0]).toEqual({
      selector: '#rcnt',
      append: 'before',
      alignTo: '#center_col',
    });
    expect(google.anchors[1]).toEqual({ selector: '#center_col', append: 'first' });
  });
  it('google does not declare pageStyles', () => {
    expect(getEngine('google').pageStyles).toBeUndefined();
  });
  it('baidu cascade: primary #container + first, fallback #content_left + before + alignTo #content_left', () => {
    const baidu = getEngine('baidu');
    expect(baidu.anchors).toHaveLength(2);
    expect(baidu.anchors[0]).toEqual({ selector: '#container', append: 'first' });
    expect(baidu.anchors[1]).toEqual({
      selector: '#content_left',
      append: 'before',
      alignTo: '#content_left',
    });
  });
  it('baidu declares pageStyles targeting the result-molecule z-index shim', () => {
    // Pin the selector target, not the full CSS — lets QA tune property values freely.
    expect(getEngine('baidu').pageStyles).toContain('#wrapper>.result-molecule');
  });
  it('null engine falls back to DEFAULT_ANCHORS', () => {
    expect(anchorsFor(null)).toEqual(DEFAULT_ANCHORS);
  });
  it('anchorsFor returns the engine cascade (not the default) for known engines', () => {
    expect(anchorsFor(getEngine('google'))).toBe(getEngine('google').anchors);
    expect(anchorsFor(getEngine('bing'))).toBe(getEngine('bing').anchors);
    expect(anchorsFor(getEngine('baidu'))).toBe(getEngine('baidu').anchors);
  });
  it('regression: Bing avoids its rebuilt result node in every candidate', () => {
    for (const candidate of getEngine('bing').anchors) {
      expect(candidate.selector).not.toBe('#b_results');
    }
  });
  it('no engine anchors to body in any candidate', () => {
    for (const engine of allEngines()) {
      for (const candidate of engine.anchors) {
        expect(candidate.selector).not.toBe('body');
      }
    }
  });
  it('every engine exposes at least one anchor candidate', () => {
    for (const engine of allEngines()) {
      expect(engine.anchors.length).toBeGreaterThan(0);
    }
  });
});
