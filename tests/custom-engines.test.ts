import { describe, it, expect } from 'vitest';
import {
  isCustomEngineId,
  normalizeCustomEngineUrlTemplate,
  normalizeCustomEngineDefinition,
  normalizeCustomEngineDefinitions,
  isBoundedCustomEngineCollection,
  buildCustomEngineUrl,
  findDuplicateCustomEngineUrls,
  sanitizeOpenNewTabUrl,
  customEnginesSerializedBytes,
  MAX_CUSTOM_ENGINES,
  MAX_CUSTOM_ENGINE_NAME_LENGTH,
  MAX_CUSTOM_ENGINE_URL_LENGTH,
  MAX_CUSTOM_ENGINES_SERIALIZED_BYTES,
  type CustomEngineDefinition,
} from '@/lib/custom-engines';

describe('isCustomEngineId', () => {
  it('accepts valid custom engine ids', () => {
    expect(isCustomEngineId('custom:abc')).toBe(true);
    expect(isCustomEngineId('custom:uuid-here')).toBe(true);
    expect(isCustomEngineId('custom:A1_b2-c3')).toBe(true);
    expect(isCustomEngineId('custom:0')).toBe(true);
  });

  it('rejects ids with empty token after prefix', () => {
    expect(isCustomEngineId('custom:')).toBe(false);
  });

  it('rejects non-custom prefixes', () => {
    expect(isCustomEngineId('site:x')).toBe(false);
    expect(isCustomEngineId('google')).toBe(false);
    expect(isCustomEngineId('')).toBe(false);
  });

  it('rejects tokens with invalid characters', () => {
    expect(isCustomEngineId('custom:!bad')).toBe(false);
    expect(isCustomEngineId('custom:has space')).toBe(false);
    expect(isCustomEngineId('custom:a.b')).toBe(false);
  });

  it('rejects tokens starting with invalid characters', () => {
    expect(isCustomEngineId('custom:-start')).toBe(false);
    expect(isCustomEngineId('custom:_start')).toBe(false);
  });

  it('rejects tokens exceeding 128 characters', () => {
    expect(isCustomEngineId(`custom:${'a'.repeat(129)}`)).toBe(false);
    expect(isCustomEngineId(`custom:${'a'.repeat(128)}`)).toBe(true);
  });
});

describe('normalizeCustomEngineUrlTemplate', () => {
  it('accepts valid https templates', () => {
    expect(normalizeCustomEngineUrlTemplate('https://example.com/search?q=%s')).toBe('https://example.com/search?q=%s');
  });

  it('accepts valid http templates', () => {
    expect(normalizeCustomEngineUrlTemplate('http://foo.bar/%s')).toBe('http://foo.bar/%s');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCustomEngineUrlTemplate('  https://example.com/search?q=%s  ')).toBe('https://example.com/search?q=%s');
  });

  it('rejects templates without %s', () => {
    expect(normalizeCustomEngineUrlTemplate('https://example.com/search?q=test')).toBeNull();
  });

  it('rejects templates with multiple %s', () => {
    expect(normalizeCustomEngineUrlTemplate('https://example.com/%s?q=%s')).toBeNull();
  });

  it('rejects non-http schemes', () => {
    expect(normalizeCustomEngineUrlTemplate('ftp://example.com/%s')).toBeNull();
    expect(normalizeCustomEngineUrlTemplate('javascript:alert(%s)')).toBeNull();
  });

  it('rejects empty and whitespace-only strings', () => {
    expect(normalizeCustomEngineUrlTemplate('')).toBeNull();
    expect(normalizeCustomEngineUrlTemplate('   ')).toBeNull();
  });

  it('rejects strings exceeding the max length', () => {
    const long = `https://example.com/${'a'.repeat(MAX_CUSTOM_ENGINE_URL_LENGTH)}?q=%s`;
    expect(normalizeCustomEngineUrlTemplate(long)).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(normalizeCustomEngineUrlTemplate(123)).toBeNull();
    expect(normalizeCustomEngineUrlTemplate(null)).toBeNull();
    expect(normalizeCustomEngineUrlTemplate(undefined)).toBeNull();
  });

  it('rejects invalid URLs', () => {
    expect(normalizeCustomEngineUrlTemplate('not a url %s')).toBeNull();
  });

  it('rejects templates with internal whitespace', () => {
    expect(normalizeCustomEngineUrlTemplate('https://example.com/search?q= %s')).toBeNull();
    expect(normalizeCustomEngineUrlTemplate('https://example.com /%s')).toBeNull();
  });

  it('rejects templates with embedded credentials', () => {
    expect(normalizeCustomEngineUrlTemplate('https://user:pass@example.com/%s')).toBeNull();
    expect(normalizeCustomEngineUrlTemplate('https://user@example.com/%s')).toBeNull();
  });

  it('canonicalizes scheme and host to lowercase', () => {
    expect(normalizeCustomEngineUrlTemplate('HTTPS://EXAMPLE.COM/search?q=%s')).toBe('https://example.com/search?q=%s');
    expect(normalizeCustomEngineUrlTemplate('Http://Foo.BAR/%s')).toBe('http://foo.bar/%s');
  });

  it('deduplicates case-variant templates via canonical form', () => {
    const a = { id: 'custom:a', name: 'A', urlTemplate: 'HTTPS://X.COM/?q=%s' };
    const b = { id: 'custom:b', name: 'B', urlTemplate: 'https://x.com/?q=%s' };
    // Both normalize to the same canonical urlTemplate, so second is deduped.
    expect(normalizeCustomEngineDefinitions([a, b])).toHaveLength(1);
  });

  it('rejects uppercase %S placeholder', () => {
    expect(normalizeCustomEngineUrlTemplate('https://example.com/?q=%S')).toBeNull();
  });
});

describe('normalizeCustomEngineDefinition', () => {
  const valid = { id: 'custom:abc', name: 'My Engine', urlTemplate: 'https://example.com/search?q=%s' };

  it('accepts a valid definition', () => {
    expect(normalizeCustomEngineDefinition(valid)).toEqual(valid);
  });

  it('trims the name', () => {
    expect(normalizeCustomEngineDefinition({ ...valid, name: '  Trimmed  ' })).toEqual({ ...valid, name: 'Trimmed' });
  });

  it('rejects null and non-object values', () => {
    expect(normalizeCustomEngineDefinition(null)).toBeNull();
    expect(normalizeCustomEngineDefinition('string')).toBeNull();
    expect(normalizeCustomEngineDefinition(42)).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(normalizeCustomEngineDefinition({ id: 'custom:abc' })).toBeNull();
    expect(normalizeCustomEngineDefinition({ name: 'X', urlTemplate: 'https://a.com/%s' })).toBeNull();
    expect(normalizeCustomEngineDefinition({ id: 'custom:abc', name: 'X' })).toBeNull();
  });

  it('rejects invalid id', () => {
    expect(normalizeCustomEngineDefinition({ ...valid, id: 'site:abc' })).toBeNull();
    expect(normalizeCustomEngineDefinition({ ...valid, id: 'custom:' })).toBeNull();
  });

  it('rejects invalid urlTemplate', () => {
    expect(normalizeCustomEngineDefinition({ ...valid, urlTemplate: 'https://example.com/no-placeholder' })).toBeNull();
  });

  it('rejects empty name', () => {
    expect(normalizeCustomEngineDefinition({ ...valid, name: '   ' })).toBeNull();
  });

  it('rejects name exceeding max length', () => {
    expect(normalizeCustomEngineDefinition({ ...valid, name: 'x'.repeat(MAX_CUSTOM_ENGINE_NAME_LENGTH + 1) })).toBeNull();
    expect(normalizeCustomEngineDefinition({ ...valid, name: 'x'.repeat(MAX_CUSTOM_ENGINE_NAME_LENGTH) })).not.toBeNull();
  });

  it('rejects non-string name', () => {
    expect(normalizeCustomEngineDefinition({ ...valid, name: 123 })).toBeNull();
  });
});

describe('normalizeCustomEngineDefinitions', () => {
  const a: CustomEngineDefinition = { id: 'custom:a', name: 'A', urlTemplate: 'https://a.com/%s' };
  const b: CustomEngineDefinition = { id: 'custom:b', name: 'B', urlTemplate: 'https://b.com/%s' };

  it('normalizes valid items', () => {
    expect(normalizeCustomEngineDefinitions([a, b])).toEqual([a, b]);
  });

  it('filters invalid items', () => {
    expect(normalizeCustomEngineDefinitions([a, null, 'junk', { id: 'bad' }, b])).toEqual([a, b]);
  });

  it('deduplicates by id, keeping first', () => {
    const dup = { ...a, name: 'A-dup' };
    expect(normalizeCustomEngineDefinitions([a, dup, b])).toEqual([a, b]);
  });

  it('deduplicates by urlTemplate, keeping first', () => {
    const sameUrl = { id: 'custom:c', name: 'C', urlTemplate: a.urlTemplate };
    expect(normalizeCustomEngineDefinitions([a, sameUrl, b])).toEqual([a, b]);
  });

  it('caps at MAX_CUSTOM_ENGINES', () => {
    const many = Array.from({ length: MAX_CUSTOM_ENGINES + 10 }, (_, i) => ({
      id: `custom:e${i}`, name: `E${i}`, urlTemplate: `https://e${i}.com/%s`,
    }));
    expect(normalizeCustomEngineDefinitions(many)).toHaveLength(MAX_CUSTOM_ENGINES);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeCustomEngineDefinitions(null)).toEqual([]);
    expect(normalizeCustomEngineDefinitions(undefined)).toEqual([]);
    expect(normalizeCustomEngineDefinitions('string')).toEqual([]);
    expect(normalizeCustomEngineDefinitions(42)).toEqual([]);
  });

  it('does NOT empty on oversize (trusted read behavior)', () => {
    // Even when serialized bytes exceed the limit, normalizeCustomEngineDefinitions
    // still returns items (it only caps by count). This is the trusted-read contract.
    const big = Array.from({ length: 5 }, (_, i) => ({
      id: `custom:big${i}`, name: 'N'.repeat(MAX_CUSTOM_ENGINE_NAME_LENGTH), urlTemplate: `https://example.com/${'x'.repeat(500)}?q=%s&pad=${i}`,
    }));
    const result = normalizeCustomEngineDefinitions(big);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('isBoundedCustomEngineCollection', () => {
  it('returns true for a within-bounds collection', () => {
    const items = [{ id: 'custom:a', name: 'A', urlTemplate: 'https://a.com/%s' }];
    expect(isBoundedCustomEngineCollection(items)).toBe(true);
  });

  it('returns true for an empty array', () => {
    expect(isBoundedCustomEngineCollection([])).toBe(true);
  });

  it('returns false when count exceeds MAX_CUSTOM_ENGINES', () => {
    const items = Array.from({ length: MAX_CUSTOM_ENGINES + 1 }, (_, i) => ({ id: `custom:e${i}` }));
    expect(isBoundedCustomEngineCollection(items)).toBe(false);
  });

  it('returns false when serialized bytes exceed limit', () => {
    // Create a single item with a huge payload to exceed byte limit
    const huge = [{ id: 'custom:x', name: 'x'.repeat(MAX_CUSTOM_ENGINES_SERIALIZED_BYTES) }];
    expect(isBoundedCustomEngineCollection(huge)).toBe(false);
  });

  it('returns false for non-array input', () => {
    expect(isBoundedCustomEngineCollection(null)).toBe(false);
    expect(isBoundedCustomEngineCollection('string')).toBe(false);
    expect(isBoundedCustomEngineCollection(42)).toBe(false);
  });
});

describe('customEnginesSerializedBytes', () => {
  it('returns the UTF-8 JSON byte length', () => {
    const bytes = customEnginesSerializedBytes([{ id: 'custom:a' }]);
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify([{ id: 'custom:a' }])).length);
  });

  it('returns Infinity for non-serializable values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(customEnginesSerializedBytes(circular)).toBe(Infinity);
  });
});

describe('buildCustomEngineUrl', () => {
  it('replaces %s with the encoded query', () => {
    expect(buildCustomEngineUrl('https://example.com/search?q=%s', 'hello')).toBe('https://example.com/search?q=hello');
  });

  it('encodes spaces', () => {
    expect(buildCustomEngineUrl('https://example.com/search?q=%s', 'hello world')).toBe('https://example.com/search?q=hello%20world');
  });

  it('encodes CJK characters', () => {
    expect(buildCustomEngineUrl('https://example.com/search?q=%s', '中文搜索')).toBe('https://example.com/search?q=%E4%B8%AD%E6%96%87%E6%90%9C%E7%B4%A2');
  });

  it('encodes special characters like & and =', () => {
    expect(buildCustomEngineUrl('https://example.com/search?q=%s', 'a&b=c')).toBe('https://example.com/search?q=a%26b%3Dc');
  });

  it('handles %s in the path', () => {
    expect(buildCustomEngineUrl('http://foo.bar/%s', 'test')).toBe('http://foo.bar/test');
  });
});

describe('findDuplicateCustomEngineUrls', () => {
  it('returns empty for no duplicates', () => {
    const defs: CustomEngineDefinition[] = [
      { id: 'custom:a', name: 'A', urlTemplate: 'https://a.com/%s' },
      { id: 'custom:b', name: 'B', urlTemplate: 'https://b.com/%s' },
    ];
    expect(findDuplicateCustomEngineUrls(defs)).toEqual([]);
  });

  it('groups duplicate urlTemplates correctly', () => {
    const defs: CustomEngineDefinition[] = [
      { id: 'custom:a', name: 'A', urlTemplate: 'https://same.com/%s' },
      { id: 'custom:b', name: 'B', urlTemplate: 'https://other.com/%s' },
      { id: 'custom:c', name: 'C', urlTemplate: 'https://same.com/%s' },
    ];
    expect(findDuplicateCustomEngineUrls(defs)).toEqual([
      { urlTemplate: 'https://same.com/%s', ids: ['custom:a', 'custom:c'] },
    ]);
  });

  it('returns empty for an empty list', () => {
    expect(findDuplicateCustomEngineUrls([])).toEqual([]);
  });
});

describe('sanitizeOpenNewTabUrl', () => {
  it('accepts http and https URLs', () => {
    expect(sanitizeOpenNewTabUrl('http://example.com/')).toBe('http://example.com/');
    expect(sanitizeOpenNewTabUrl('https://example.com/?q=%s')).toBe('https://example.com/?q=%s');
  });

  it('returns the parsed url.href rather than the raw input', () => {
    // Scheme/host canonicalize to lowercase; navigation must use the same serialization.
    expect(sanitizeOpenNewTabUrl('HTTPS://EXAMPLE.COM/')).toBe('https://example.com/');
    expect(sanitizeOpenNewTabUrl('https://example.com/')).toBe(new URL('https://example.com/').href);
  });

  it('rejects privileged and non-http schemes', () => {
    expect(sanitizeOpenNewTabUrl('chrome://extensions')).toBeNull();
    expect(sanitizeOpenNewTabUrl('chrome-extension://abc/options.html')).toBeNull();
    expect(sanitizeOpenNewTabUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeOpenNewTabUrl('data:text/html,x')).toBeNull();
    expect(sanitizeOpenNewTabUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeOpenNewTabUrl('view-source:https://x.com')).toBeNull();
  });

  it('rejects URLs with embedded credentials', () => {
    expect(sanitizeOpenNewTabUrl('http://user:pass@host/')).toBeNull();
  });

  it('rejects unparseable and over-length input', () => {
    expect(sanitizeOpenNewTabUrl('not a url')).toBeNull();
    expect(sanitizeOpenNewTabUrl(`https://example.com/${'a'.repeat(MAX_CUSTOM_ENGINE_URL_LENGTH + 4096)}`)).toBeNull();
  });
});
