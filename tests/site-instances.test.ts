import { describe, expect, it } from 'vitest';
import {
  buildSiteInstanceUrl,
  buildSiteScopeQuery,
  constructionFor,
  findDuplicateSiteInstanceScopes,
  formDefaultConstruction,
  isBoundedSiteInstanceCollection,
  legacyDefaultConstruction,
  matchSiteInstanceFromUrl,
  matchSiteInstanceQuery,
  MAX_SITE_INSTANCES,
  MAX_INSTANCES_SERIALIZED_BYTES,
  normalizeSiteInstanceDefinition,
  normalizeSiteInstanceDefinitions,
  normalizeSiteTarget,
  siteInstancesSerializedBytes,
  siteScopeForDefinition,
  zhanneiFingerprintFor,
  type SiteInstanceDefinition,
} from '@/lib/site-instances';
import { getEngine } from '@/lib/engines/registry';

const google: SiteInstanceDefinition = {
  id: 'site:docs', name: 'Docs', target: 'docs.example.com/guide/start?old=1#top', engineId: 'google',
};

describe('Site Instance targets', () => {
  it('normalizes scheme-less targets and removes query and fragment', () => {
    expect(normalizeSiteTarget(google.target)).toEqual({
      canonicalUrl: 'https://docs.example.com/guide/start', hostname: 'docs.example.com', pathname: '/guide/start',
    });
    expect(normalizeSiteInstanceDefinition(google)).toEqual({ ...google, target: 'https://docs.example.com/guide/start' });
  });

  it('rejects a scheme-less localhost target with a port', () => {
    expect(normalizeSiteTarget('localhost:3000/docs')).toBeNull();
  });

  it.each(['127.0.0.1', '8.8.8.8', '10.0.0.1', '192.168.1.1', '169.254.1.1', 'foo.local', 'service.internal', 'printer', '[::1]', '[::ffff:127.0.0.1]', '[::ffff:8.8.8.8]', 'localhost.', 'api.localhost.', 'foo.local.', 'host.home.arpa.', 'service.test', 'service.invalid', 'service.example'])('rejects non-public target %s', (target) => {
    expect(normalizeSiteTarget(target)).toBeNull();
  });

  it('accepts public domains only', () => {
    expect(normalizeSiteTarget('docs.example.com')).not.toBeNull();
    expect(normalizeSiteTarget('docs.example.com.')).not.toBeNull();
  });

  it('strips trailing FQDN dots from hostname and canonicalUrl', () => {
    expect(normalizeSiteTarget('docs.example.com.')).toEqual({
      canonicalUrl: 'https://docs.example.com/',
      hostname: 'docs.example.com',
      pathname: '/',
    });
    expect(normalizeSiteTarget('https://docs.example.com./guide')).toEqual({
      canonicalUrl: 'https://docs.example.com/guide',
      hostname: 'docs.example.com',
      pathname: '/guide',
    });
  });

  it.each(['ftp://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', '//example.com', 'https://', 'hello world'])(
    'rejects invalid target %s', (target) => expect(normalizeSiteTarget(target)).toBeNull(),
  );
});

describe('Site Instance query scopes', () => {
  it('degrades the target according to each engine capability', () => {
    const target = 'https://example.com/one/two/three?x=1';
    // Google: host + path, no scheme (never embed https:// in the site: operand).
    expect(siteScopeForDefinition({ engineId: 'google', target })).toBe('example.com/one/two/three');
    expect(siteScopeForDefinition({ engineId: 'bing', target })).toBe('example.com/one/two');
    expect(siteScopeForDefinition({ engineId: 'baidu', target })).toBe('example.com');
  });

  it('uses hostname only for Google when the path is root or empty', () => {
    expect(siteScopeForDefinition({ engineId: 'google', target: 'https://docs.example.com/' })).toBe('docs.example.com');
    expect(siteScopeForDefinition({ engineId: 'google', target: 'https://docs.example.com' })).toBe('docs.example.com');
  });

  it('strips a trailing slash from Google path scopes', () => {
    expect(siteScopeForDefinition({ engineId: 'google', target: 'https://docs.example.com/guide/' })).toBe('docs.example.com/guide');
  });

  it('builds a prefix with and without a base query', () => {
    expect(buildSiteScopeQuery('docs.example.com/guide/start', 'install')).toBe('site:docs.example.com/guide/start install');
    expect(buildSiteScopeQuery('docs.example.com/guide/start', '')).toBe('site:docs.example.com/guide/start');
  });
});

describe('construction defaults (KTD4)', () => {
  it('legacy read-side defaults: baidu→zhannei, bing→query, google→query', () => {
    expect(legacyDefaultConstruction('baidu')).toBe('zhannei');
    expect(legacyDefaultConstruction('bing')).toBe('query');
    expect(legacyDefaultConstruction('google')).toBe('query');
  });

  it('form build-side defaults: baidu→zhannei, bing→q1, google→query', () => {
    expect(formDefaultConstruction('baidu')).toBe('zhannei');
    expect(formDefaultConstruction('bing')).toBe('q1');
    expect(formDefaultConstruction('google')).toBe('query');
  });

  it('constructionFor uses a legal explicit mode and falls back to the read-side default', () => {
    expect(constructionFor({ engineId: 'baidu', options: { mode: 'query' } })).toBe('query');
    expect(constructionFor({ engineId: 'baidu', options: { mode: 'zhannei' } })).toBe('zhannei');
    expect(constructionFor({ engineId: 'baidu' })).toBe('zhannei');
    expect(constructionFor({ engineId: 'bing', options: { mode: 'q1' } })).toBe('q1');
    expect(constructionFor({ engineId: 'bing' })).toBe('query');
    // 非法 mode（不在该引擎允许集内）→ 读侧默认，不整记录拒绝（KTD5）。
    expect(constructionFor({ engineId: 'baidu', options: { mode: 'q1' } })).toBe('zhannei');
    expect(constructionFor({ engineId: 'bing', options: { mode: 'zhannei' } })).toBe('query');
    expect(constructionFor({ engineId: 'google', options: { mode: 'zhannei' } })).toBe('query');
  });
});

describe('options normalization (KTD5 whitelist degradation)', () => {
  it('keeps legal mode and zhannei filters', () => {
    expect(normalizeSiteInstanceDefinition({
      id: 'site:a', name: 'A', target: 'https://52pojie.cn', engineId: 'baidu',
      options: { mode: 'zhannei', zhannei: { timeRange: 10080, sortByTime: true, titleOnly: true } },
    })).toEqual({
      id: 'site:a', name: 'A', target: 'https://52pojie.cn/', engineId: 'baidu',
      options: { mode: 'zhannei', zhannei: { timeRange: 10080, sortByTime: true, titleOnly: true } },
    });
  });

  it('drops an illegal mode to the read-side default rather than rejecting the record', () => {
    expect(normalizeSiteInstanceDefinition({
      id: 'site:a', name: 'A', target: 'https://example.com', engineId: 'bing', options: { mode: 'zhannei' },
    })).toEqual({ id: 'site:a', name: 'A', target: 'https://example.com/', engineId: 'bing' });
  });

  it('drops out-of-enum timeRange, non-true booleans, and unknown keys', () => {
    expect(normalizeSiteInstanceDefinition({
      id: 'site:a', name: 'A', target: 'https://example.com', engineId: 'baidu',
      options: { mode: 'zhannei', zhannei: { timeRange: 9999, sortByTime: 'yes', titleOnly: false, junk: 'x' }, extra: 1 },
    })).toEqual({
      id: 'site:a', name: 'A', target: 'https://example.com/', engineId: 'baidu', options: { mode: 'zhannei' },
    });
  });

  it('materializes zhannei filters only in zhannei mode', () => {
    // 显式 query 模式 + 筛选 → 筛选被丢弃（筛选仅 zhannei 模式生效，R3）。
    expect(normalizeSiteInstanceDefinition({
      id: 'site:a', name: 'A', target: 'https://example.com', engineId: 'baidu',
      options: { mode: 'query', zhannei: { timeRange: 60 } },
    })).toEqual({
      id: 'site:a', name: 'A', target: 'https://example.com/', engineId: 'baidu', options: { mode: 'query' },
    });
    // legacy baidu（无 mode → 有效 zhannei）+ 筛选 → 筛选保留。
    expect(normalizeSiteInstanceDefinition({
      id: 'site:b', name: 'B', target: 'https://example.com', engineId: 'baidu',
      options: { zhannei: { timeRange: 60 } },
    })).toEqual({
      id: 'site:b', name: 'B', target: 'https://example.com/', engineId: 'baidu', options: { zhannei: { timeRange: 60 } },
    });
  });

  it('discards any options on google entirely', () => {
    expect(normalizeSiteInstanceDefinition({
      id: 'site:g', name: 'G', target: 'https://example.com', engineId: 'google', options: { mode: 'query', zhannei: { timeRange: 60 } },
    })).toEqual({ id: 'site:g', name: 'G', target: 'https://example.com/', engineId: 'google' });
  });
});

describe('buildSiteInstanceUrl (R2/R3)', () => {
  it('builds the zhannei endpoint with cc + filters', () => {
    expect(buildSiteInstanceUrl({
      engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'zhannei', zhannei: { timeRange: 10080 } },
    }, 'python')).toBe('https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn&sti=10080');
    expect(buildSiteInstanceUrl({
      engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'zhannei', zhannei: { sortByTime: true, titleOnly: true } },
    }, 'python')).toBe('https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn&sort=lds&stp=1');
  });

  it('omits absent zhannei filter params and encodes the query', () => {
    expect(buildSiteInstanceUrl({ engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'zhannei' } }, '中文 搜索'))
      .toBe('https://zhannei.baidu.com/cse/site?q=%E4%B8%AD%E6%96%87%20%E6%90%9C%E7%B4%A2&cc=52pojie.cn');
  });

  it('builds the bing q1 form with encoded site: operand', () => {
    expect(buildSiteInstanceUrl({ engineId: 'bing', target: 'https://52pojie.cn', options: { mode: 'q1' } }, 'hello world'))
      .toBe('https://www.bing.com/search?q=hello%20world&q1=site%3A52pojie.cn');
  });

  it('keeps an empty base query semantics per mode', () => {
    expect(buildSiteInstanceUrl({ engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'zhannei' } }, ''))
      .toBe('https://zhannei.baidu.com/cse/site?q=&cc=52pojie.cn');
    expect(buildSiteInstanceUrl({ engineId: 'bing', target: 'https://52pojie.cn', options: { mode: 'q1' } }, ''))
      .toBe('https://www.bing.com/search?q=&q1=site%3A52pojie.cn');
    expect(buildSiteInstanceUrl(google, '')).toBe('https://www.google.com/search?q=site%3Adocs.example.com%2Fguide%2Fstart');
  });

  it('query mode + google keep the engine SERP prefix path (AE4: legacy baidu→zhannei, legacy bing→query)', () => {
    // 存量 bing（无 options）→ 仍走 q=site:... 前缀（行为不变）。
    expect(buildSiteInstanceUrl({ engineId: 'bing', target: 'https://docs.example.com/guide' }, 'install'))
      .toBe('https://www.bing.com/search?q=site%3Adocs.example.com%2Fguide%20install');
    // 存量 baidu（无 options）→ 读侧默认 zhannei 端点（有意的行为变更）。
    expect(buildSiteInstanceUrl({ engineId: 'baidu', target: 'https://52pojie.cn' }, 'install'))
      .toBe('https://zhannei.baidu.com/cse/site?q=install&cc=52pojie.cn');
    // baidu 显式 query 模式 → 主站前缀回退。
    expect(buildSiteInstanceUrl({ engineId: 'baidu', target: 'https://52pojie.cn', options: { mode: 'query' } }, 'install'))
      .toBe('https://www.baidu.com/s?wd=site%3A52pojie.cn%20install');
  });

  it('returns null for an invalid target', () => {
    expect(buildSiteInstanceUrl({ engineId: 'google', target: 'not a url' }, 'q')).toBeNull();
  });
});

describe('Site Instance query matching (prefix path)', () => {
  const definitions: SiteInstanceDefinition[] = [
    { id: 'site:one', name: 'One', target: 'example.com/a', engineId: 'bing' },
    { id: 'site:two', name: 'Two', target: 'example.com/a/b/c', engineId: 'bing' },
  ];

  it('recovers only an exact generated prefix and its base query', () => {
    expect(matchSiteInstanceQuery('bing', 'site:example.com/a/b query', definitions)).toEqual({ siteId: 'site:two', baseQuery: 'query' });
    expect(matchSiteInstanceQuery('bing', 'site:example.com/a/bad query', definitions)).toBeNull();
  });

  it('recovers a Google site query with the scheme-free host/path prefix', () => {
    const googleDefs: SiteInstanceDefinition[] = [
      { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/guide/start', engineId: 'google' },
    ];
    expect(matchSiteInstanceQuery('google', 'site:docs.example.com/guide/start install', googleDefs)).toEqual({
      siteId: 'site:docs', baseQuery: 'install',
    });
    expect(matchSiteInstanceQuery('google', 'site:https://docs.example.com/guide/start install', googleDefs)).toBeNull();
  });

  it('prefers the active source and then source order for duplicate scopes', () => {
    const duplicates: SiteInstanceDefinition[] = [
      { id: 'site:first', name: 'First', target: 'example.com', engineId: 'baidu' },
      { id: 'site:second', name: 'Second', target: 'example.com/a', engineId: 'baidu' },
    ];
    expect(matchSiteInstanceQuery('baidu', 'site:example.com term', duplicates, 'site:second')).toEqual({ siteId: 'site:second', baseQuery: 'term' });
    expect(matchSiteInstanceQuery('baidu', 'site:example.com term', duplicates, null, ['site:second', 'site:first'])).toEqual({ siteId: 'site:second', baseQuery: 'term' });
  });
});

describe('matchSiteInstanceFromUrl (KTD2 three-way recognition)', () => {
  const defs: SiteInstanceDefinition[] = [
    // zhannei 模式 + 一周筛选（AE1/AE5）。
    { id: 'site:z-week', name: '52pojie Week', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei', zhannei: { timeRange: 10080 } } },
    // 同站 zhannei 不限（与上一条不同筛选指纹 → 合法共存）。
    { id: 'site:z-any', name: '52pojie Any', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei' } },
    // 同站 baidu query 模式（跨模式共存）。
    { id: 'site:q', name: '52pojie Prefix', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'query' } },
    // bing q1 模式（AE3）。
    { id: 'site:b-q1', name: 'Bing q1', target: 'https://52pojie.cn', engineId: 'bing', options: { mode: 'q1' } },
    // bing query 模式（跨模式）。
    { id: 'site:b-q', name: 'Bing prefix', target: 'https://52pojie.cn', engineId: 'bing' },
    // google 前缀。
    { id: 'site:g', name: 'Docs', target: 'https://docs.example.com/guide', engineId: 'google' },
  ];

  it('① reads cc from a zhannei SERP and matches baidu definitions cross-mode', () => {
    const url = 'https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn&sti=10080';
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), url, defs, 'site:z-week')).toEqual({ siteId: 'site:z-week', baseQuery: 'python' });
    // 无 active 偏好 → sourceOrder 决定；再退到首次出现。
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), url, defs, null, ['site:z-any'])).toEqual({ siteId: 'site:z-any', baseQuery: 'python' });
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), url, defs)).toEqual({ siteId: 'site:z-week', baseQuery: 'python' });
  });

  it('① normalizes trailing-dot cc and rejects non-zhannei URLs', () => {
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), 'https://zhannei.baidu.com/cse/site?q=x&cc=52pojie.cn.', defs)).toEqual({ siteId: 'site:z-week', baseQuery: 'x' });
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), 'https://zhannei.baidu.com/cse/search?q=x&cc=52pojie.cn', defs)).toBeNull();
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), 'https://zhannei.baidu.com/cse/site?q=x', defs)).toBeNull();
  });

  it('② reads the site: operand from a bing q1 SERP and matches bing definitions cross-mode', () => {
    const url = 'https://www.bing.com/search?q=hello+world&q1=site%3A52pojie.cn';
    expect(matchSiteInstanceFromUrl(getEngine('bing'), url, defs, 'site:b-q1')).toEqual({ siteId: 'site:b-q1', baseQuery: 'hello world' });
    expect(matchSiteInstanceFromUrl(getEngine('bing'), url, defs)).toEqual({ siteId: 'site:b-q1', baseQuery: 'hello world' });
  });

  it('② ignores a q1 without a site: operand and falls through to the prefix path', () => {
    // q1 含其他操作符（无 site:）→ 落前缀路径；q 干净无前缀 → null。
    expect(matchSiteInstanceFromUrl(getEngine('bing'), 'https://www.bing.com/search?q=hello&q1=filetype%3Apdf', defs)).toBeNull();
    // 手输前缀（任意引擎）仍可识别（R6）；q1/query 两模式同 scope 时按 active/首现排序。
    const manual = 'https://www.bing.com/search?q=site%3A52pojie.cn+hello';
    expect(matchSiteInstanceFromUrl(getEngine('bing'), manual, defs)).toEqual({ siteId: 'site:b-q1', baseQuery: 'hello' });
    expect(matchSiteInstanceFromUrl(getEngine('bing'), manual, defs, 'site:b-q')).toEqual({ siteId: 'site:b-q', baseQuery: 'hello' });
  });

  it('③ keeps the prefix path for google and cross-mode highlights query-mode definitions', () => {
    expect(matchSiteInstanceFromUrl(getEngine('google'), 'https://www.google.com/search?q=site%3Adocs.example.com%2Fguide+install', defs))
      .toEqual({ siteId: 'site:g', baseQuery: 'install' });
    // zhannei SERP 上高亮 query 模式实例（跨模式识别）。
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), 'https://zhannei.baidu.com/cse/site?q=x&cc=52pojie.cn', defs, 'site:q'))
      .toEqual({ siteId: 'site:q', baseQuery: 'x' });
    // 无匹配的 raw site: → null（resolveSerpContext 回退 raw query）。
    expect(matchSiteInstanceFromUrl(getEngine('baidu'), 'https://www.baidu.com/s?wd=site%3Aunknown.com+x', defs)).toBeNull();
  });
});

describe('duplicate Site Instances (KTD6)', () => {
  it('groups duplicates by (engine, mode, scope, zhannei fingerprint)', () => {
    const definitions: SiteInstanceDefinition[] = [
      { id: 'site:a', name: 'A', target: 'example.com/a', engineId: 'baidu' },
      { id: 'site:b', name: 'B', target: 'example.com/b', engineId: 'baidu' },
      { id: 'site:c', name: 'C', target: 'example.com/a', engineId: 'google' },
      // 与 site:a 同 (baidu, zhannei, example.com, 无筛选) → 重复。
      { id: 'site:d', name: 'D', target: 'example.com/a', engineId: 'baidu', options: { mode: 'zhannei' } },
      // 与 site:a 同 scope 但 query 模式 → 合法共存。
      { id: 'site:e', name: 'E', target: 'example.com/a', engineId: 'baidu', options: { mode: 'query' } },
    ];
    // site:b 的 target 是 example.com/b，但 baidu scope 为 host-only → 同键。
    expect(findDuplicateSiteInstanceScopes(definitions)).toEqual([
      { engineId: 'baidu', mode: 'zhannei', scope: 'example.com', zhannei: '', siteIds: ['site:a', 'site:b', 'site:d'] },
    ]);
  });

  it('treats different zhannei filter fingerprints as distinct instances (AE5)', () => {
    const week: SiteInstanceDefinition = { id: 'site:week', name: 'W', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei', zhannei: { timeRange: 10080 } } };
    const any: SiteInstanceDefinition = { id: 'site:any', name: 'A', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei' } };
    expect(findDuplicateSiteInstanceScopes([week, any])).toEqual([]);
    expect(zhanneiFingerprintFor(week)).not.toBe(zhanneiFingerprintFor(any));
  });

  it('treats trailing-dot and bare host targets as the same effective scope', () => {
    expect(findDuplicateSiteInstanceScopes([
      { id: 'site:a', name: 'A', target: 'docs.example.com', engineId: 'google' },
      { id: 'site:b', name: 'B', target: 'docs.example.com.', engineId: 'google' },
    ])).toEqual([{ engineId: 'google', mode: 'query', scope: 'docs.example.com', zhannei: '', siteIds: ['site:a', 'site:b'] }]);
    expect(siteScopeForDefinition({ engineId: 'google', target: 'docs.example.com.' }))
      .toBe(siteScopeForDefinition({ engineId: 'google', target: 'docs.example.com' }));
  });
});

describe('normalizeSiteInstanceDefinitions: mixed legacy + new collections (R-2)', () => {
  it('keeps cross-mode records that the old (engine, scope) key would have dropped', () => {
    const normalized = normalizeSiteInstanceDefinitions([
      { id: 'site:legacy', name: 'Legacy', target: 'https://52pojie.cn', engineId: 'baidu' },
      { id: 'site:z', name: 'Z', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei' } },
      { id: 'site:q', name: 'Q', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'query' } },
      { id: 'site:g1', name: 'G1', target: 'https://52pojie.cn', engineId: 'google' },
      { id: 'site:b', name: 'B', target: 'https://52pojie.cn', engineId: 'bing', options: { mode: 'q1' } },
    ]);
    // legacy（有效 zhannei 无筛选）与 site:z 同键 → 后者被丢（first-seen 保留）；query 模式保留。
    expect(normalized.map((definition) => definition.id)).toEqual(['site:legacy', 'site:q', 'site:g1', 'site:b']);
  });

  it('deduplicates same (engine, mode, scope, fingerprint) in first-seen order', () => {
    const normalized = normalizeSiteInstanceDefinitions([
      { id: 'site:week1', name: 'W1', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei', zhannei: { timeRange: 10080 } } },
      { id: 'site:week2', name: 'W2', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei', zhannei: { sortByTime: true } } },
      { id: 'site:week3', name: 'W3', target: 'https://52pojie.cn', engineId: 'baidu', options: { mode: 'zhannei', zhannei: { timeRange: 10080, sortByTime: false } } },
    ]);
    // week1 与 week3 同指纹（false 不物化）；week2 指纹不同保留。
    expect(normalized.map((definition) => definition.id)).toEqual(['site:week1', 'site:week2']);
  });
});

describe('normalizeSiteInstanceDefinitions bounds', () => {
  function makeDef(index: number, namePad = ''): SiteInstanceDefinition {
    return {
      id: `site:${index}`,
      name: `S${index}${namePad}`.slice(0, 40),
      target: `https://example${index}.com/`,
      engineId: 'google',
    };
  }

  it('caps length without returning empty and keeps first-seen order', () => {
    const raw = Array.from({ length: MAX_SITE_INSTANCES + 5 }, (_, i) => makeDef(i));
    const normalized = normalizeSiteInstanceDefinitions(raw);
    expect(normalized).toHaveLength(MAX_SITE_INSTANCES);
    expect(normalized[0]?.id).toBe('site:0');
    expect(normalized[MAX_SITE_INSTANCES - 1]?.id).toBe(`site:${MAX_SITE_INSTANCES - 1}`);
  });

  it('does not wipe a collection that exceeds the serialized byte budget', () => {
    // Pure valid defs stay under the byte cap at MAX_SITE_INSTANCES; extra junk fields
    // simulate a bloated raw storage payload that previously triggered all-or-nothing [].
    const pad = 'x'.repeat(40);
    const oversized = Array.from({ length: MAX_SITE_INSTANCES }, (_, i) => ({
      id: `site:big${i}`,
      name: pad,
      target: `https://host${i}.example.com/${'p'.repeat(1800)}`,
      engineId: 'google' as const,
      junk: 'J'.repeat(2000),
    }));
    expect(siteInstancesSerializedBytes(oversized)).toBeGreaterThan(MAX_INSTANCES_SERIALIZED_BYTES);
    expect(isBoundedSiteInstanceCollection(oversized)).toBe(false);
    const normalized = normalizeSiteInstanceDefinitions(oversized);
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized.length).toBeLessThanOrEqual(MAX_SITE_INSTANCES);
    expect(normalized[0]?.id).toBe('site:big0');
    expect(normalized[0]).not.toHaveProperty('junk');
  });

  it('isBoundedSiteInstanceCollection still rejects oversize untrusted payloads', () => {
    const long = Array.from({ length: MAX_SITE_INSTANCES + 1 }, (_, i) => makeDef(i));
    expect(isBoundedSiteInstanceCollection(long)).toBe(false);
    expect(isBoundedSiteInstanceCollection([makeDef(0)])).toBe(true);
  });
});
