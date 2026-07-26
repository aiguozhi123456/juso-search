import { describe, expect, it } from 'vitest';
import {
  buildSiteEngineQuery,
  findDuplicateSiteEngineScopes,
  isBoundedSiteEngineCollection,
  matchSiteEngineQuery,
  MAX_SITE_ENGINES,
  MAX_SITE_ENGINES_SERIALIZED_BYTES,
  normalizeSiteEngineDefinition,
  normalizeSiteEngineDefinitions,
  normalizeSiteTarget,
  siteEnginesSerializedBytes,
  siteScopeForDefinition,
  type SiteEngineDefinition,
} from '@/lib/site-engines';

const google: SiteEngineDefinition = {
  id: 'site:docs', name: 'Docs', target: 'docs.example.com/guide/start?old=1#top', engineId: 'google',
};

describe('Site Engine targets', () => {
  it('normalizes scheme-less targets and removes query and fragment', () => {
    expect(normalizeSiteTarget(google.target)).toEqual({
      canonicalUrl: 'https://docs.example.com/guide/start', hostname: 'docs.example.com', pathname: '/guide/start',
    });
    expect(normalizeSiteEngineDefinition(google)).toEqual({ ...google, target: 'https://docs.example.com/guide/start' });
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

describe('Site Engine query scopes', () => {
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
    expect(buildSiteEngineQuery(google, 'install')).toBe('site:docs.example.com/guide/start install');
    expect(buildSiteEngineQuery(google, '')).toBe('site:docs.example.com/guide/start');
  });
});

describe('Site Engine query matching', () => {
  const definitions: SiteEngineDefinition[] = [
    { id: 'site:one', name: 'One', target: 'example.com/a', engineId: 'bing' },
    { id: 'site:two', name: 'Two', target: 'example.com/a/b/c', engineId: 'bing' },
  ];

  it('recovers only an exact generated prefix and its base query', () => {
    expect(matchSiteEngineQuery('bing', 'site:example.com/a/b query', definitions)).toEqual({ siteId: 'site:two', baseQuery: 'query' });
    expect(matchSiteEngineQuery('bing', 'site:example.com/a/bad query', definitions)).toBeNull();
  });

  it('recovers a Google site query with the scheme-free host/path prefix', () => {
    const googleDefs: SiteEngineDefinition[] = [
      { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/guide/start', engineId: 'google' },
    ];
    expect(matchSiteEngineQuery('google', 'site:docs.example.com/guide/start install', googleDefs)).toEqual({
      siteId: 'site:docs', baseQuery: 'install',
    });
    expect(matchSiteEngineQuery('google', 'site:https://docs.example.com/guide/start install', googleDefs)).toBeNull();
  });

  it('prefers the active source and then source order for duplicate scopes', () => {
    const duplicates: SiteEngineDefinition[] = [
      { id: 'site:first', name: 'First', target: 'example.com', engineId: 'baidu' },
      { id: 'site:second', name: 'Second', target: 'example.com/a', engineId: 'baidu' },
    ];
    expect(matchSiteEngineQuery('baidu', 'site:example.com term', duplicates, 'site:second')).toEqual({ siteId: 'site:second', baseQuery: 'term' });
    expect(matchSiteEngineQuery('baidu', 'site:example.com term', duplicates, null, ['site:second', 'site:first'])).toEqual({ siteId: 'site:second', baseQuery: 'term' });
  });
});

describe('duplicate Site Engines', () => {
  it('identifies duplicate effective engine scopes', () => {
    expect(findDuplicateSiteEngineScopes([
      { id: 'site:a', name: 'A', target: 'example.com/a', engineId: 'baidu' },
      { id: 'site:b', name: 'B', target: 'example.com/b', engineId: 'baidu' },
      { id: 'site:c', name: 'C', target: 'example.com/a', engineId: 'google' },
    ])).toEqual([{ engineId: 'baidu', scope: 'example.com', siteIds: ['site:a', 'site:b'] }]);
  });

  it('treats trailing-dot and bare host targets as the same effective scope', () => {
    expect(findDuplicateSiteEngineScopes([
      { id: 'site:a', name: 'A', target: 'docs.example.com', engineId: 'google' },
      { id: 'site:b', name: 'B', target: 'docs.example.com.', engineId: 'google' },
    ])).toEqual([{ engineId: 'google', scope: 'docs.example.com', siteIds: ['site:a', 'site:b'] }]);
    expect(siteScopeForDefinition({ engineId: 'google', target: 'docs.example.com.' }))
      .toBe(siteScopeForDefinition({ engineId: 'google', target: 'docs.example.com' }));
  });
});

describe('normalizeSiteEngineDefinitions bounds', () => {
  function makeDef(index: number, namePad = ''): SiteEngineDefinition {
    return {
      id: `site:${index}`,
      name: `S${index}${namePad}`.slice(0, 40),
      target: `https://example${index}.com/`,
      engineId: 'google',
    };
  }

  it('caps length without returning empty and keeps first-seen order', () => {
    const raw = Array.from({ length: MAX_SITE_ENGINES + 5 }, (_, i) => makeDef(i));
    const normalized = normalizeSiteEngineDefinitions(raw);
    expect(normalized).toHaveLength(MAX_SITE_ENGINES);
    expect(normalized[0]?.id).toBe('site:0');
    expect(normalized[MAX_SITE_ENGINES - 1]?.id).toBe(`site:${MAX_SITE_ENGINES - 1}`);
  });

  it('does not wipe a collection that exceeds the serialized byte budget', () => {
    // Pure valid defs stay under the byte cap at MAX_SITE_ENGINES; extra junk fields
    // simulate a bloated raw storage payload that previously triggered all-or-nothing [].
    const pad = 'x'.repeat(40);
    const oversized = Array.from({ length: MAX_SITE_ENGINES }, (_, i) => ({
      id: `site:big${i}`,
      name: pad,
      target: `https://host${i}.example.com/${'p'.repeat(1800)}`,
      engineId: 'google' as const,
      junk: 'J'.repeat(2000),
    }));
    expect(siteEnginesSerializedBytes(oversized)).toBeGreaterThan(MAX_SITE_ENGINES_SERIALIZED_BYTES);
    expect(isBoundedSiteEngineCollection(oversized)).toBe(false);
    const normalized = normalizeSiteEngineDefinitions(oversized);
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized.length).toBeLessThanOrEqual(MAX_SITE_ENGINES);
    expect(normalized[0]?.id).toBe('site:big0');
    expect(normalized[0]).not.toHaveProperty('junk');
  });

  it('isBoundedSiteEngineCollection still rejects oversize untrusted payloads', () => {
    const long = Array.from({ length: MAX_SITE_ENGINES + 1 }, (_, i) => makeDef(i));
    expect(isBoundedSiteEngineCollection(long)).toBe(false);
    expect(isBoundedSiteEngineCollection([makeDef(0)])).toBe(true);
  });
});
