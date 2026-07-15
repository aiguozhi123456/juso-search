import { describe, expect, it } from 'vitest';
import {
  BAIDU_SERP_HOSTS,
  BING_SERP_HOSTS,
  ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS,
  GOOGLE_SERP_HOSTS,
  SERP_CONTENT_MATCH_PATTERNS,
  SERP_HOST_MATCH_PATTERNS,
  SERP_HOSTS,
} from '@/lib/engines/scopes';

describe('SERP scopes', () => {
  it('maps every host to one unique resource and content-script match pattern', () => {
    expect(new Set(SERP_HOSTS).size).toBe(SERP_HOSTS.length);
    expect(SERP_HOST_MATCH_PATTERNS).toEqual(SERP_HOSTS.map((host) => `https://${host}/*`));
    expect(SERP_CONTENT_MATCH_PATTERNS).toEqual([
      ...GOOGLE_SERP_HOSTS.map((host) => `https://${host}/search*`),
      ...BING_SERP_HOSTS.map((host) => `https://${host}/search*`),
      ...BAIDU_SERP_HOSTS.map((host) => `https://${host}/s*`),
    ]);
    expect(new Set(SERP_HOST_MATCH_PATTERNS).size).toBe(SERP_HOSTS.length);
    expect(new Set(SERP_CONTENT_MATCH_PATTERNS).size).toBe(SERP_HOSTS.length);
    expect(ENGINE_EXTRACTOR_CONTENT_MATCH_PATTERNS).toEqual(SERP_HOST_MATCH_PATTERNS);
  });

  it('uses only the approved Google, Bing and Baidu hosts', () => {
    expect(GOOGLE_SERP_HOSTS).toEqual([
      'www.google.com',
      'www.google.com.hk',
      'www.google.com.tw',
      'www.google.co.jp',
      'www.google.co.uk',
    ]);
    expect(BING_SERP_HOSTS).toEqual(['www.bing.com', 'cn.bing.com']);
    expect(BAIDU_SERP_HOSTS).toEqual(['www.baidu.com']);
  });
});
