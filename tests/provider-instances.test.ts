import { describe, expect, it } from 'vitest';
import {
  isBoundedProviderInstanceCollection,
  isProviderInstanceId,
  MAX_INSTANCES_SERIALIZED_BYTES,
  MAX_INSTANCE_NAME_LENGTH,
  MAX_PROVIDER_INSTANCES,
  normalizeProviderInstance,
  normalizeProviderInstances,
  providerInstancesSerializedBytes,
  type ProviderInstance,
} from '@/lib/provider-instances';

function makeInstance(index: number, options: Record<string, unknown> = {}): ProviderInstance {
  return {
    id: `inst:exa:${index}`,
    baseProviderId: 'exa',
    name: `Instance ${index}`,
    options,
  };
}

describe('isProviderInstanceId', () => {
  it('accepts valid ids for every known provider', () => {
    expect(isProviderInstanceId('inst:exa:abc123')).toBe(true);
    expect(isProviderInstanceId('inst:tavily:abc123')).toBe(true);
    expect(isProviderInstanceId('inst:stepfun-plan:abc123')).toBe(true);
    expect(isProviderInstanceId('inst:doubao-global:abc123')).toBe(true);
    expect(isProviderInstanceId('inst:parallel:abc123')).toBe(true);
  });

  it('rejects wrong prefixes', () => {
    expect(isProviderInstanceId('site:exa:abc')).toBe(false);
    expect(isProviderInstanceId('exa:abc')).toBe(false);
    expect(isProviderInstanceId(':exa:abc')).toBe(false);
    expect(isProviderInstanceId('')).toBe(false);
  });

  it('rejects an unknown base provider', () => {
    expect(isProviderInstanceId('inst:unknown:abc')).toBe(false);
  });

  it('rejects bad tokens', () => {
    expect(isProviderInstanceId('inst:exa:')).toBe(false);
    expect(isProviderInstanceId('inst:exa:bad char!')).toBe(false);
    expect(isProviderInstanceId('inst:exa: has space')).toBe(false);
  });

  it('rejects wrong part counts', () => {
    expect(isProviderInstanceId('inst:exa')).toBe(false);
    expect(isProviderInstanceId('inst:exa:abc:extra')).toBe(false);
  });
});

describe('normalizeProviderInstance', () => {
  const valid: ProviderInstance = {
    id: 'inst:exa:abc123',
    baseProviderId: 'exa',
    name: 'AI 研究',
    options: { category: 'publication' },
  };

  it('normalizes a valid record', () => {
    expect(normalizeProviderInstance(valid)).toEqual(valid);
  });

  it.each([null, undefined, 42, 'inst:exa:abc', [], ['inst:exa:abc']])('rejects garbage value %o', (value) => {
    expect(normalizeProviderInstance(value)).toBeNull();
  });

  it('trims names and rejects empty or over-length names', () => {
    expect(normalizeProviderInstance({ ...valid, name: '  AI 研究  ' })).toEqual({ ...valid, name: 'AI 研究' });
    expect(normalizeProviderInstance({ ...valid, name: '   ' })).toBeNull();
    expect(normalizeProviderInstance({ ...valid, name: 'n'.repeat(MAX_INSTANCE_NAME_LENGTH) }))
      .toEqual({ ...valid, name: 'n'.repeat(MAX_INSTANCE_NAME_LENGTH) });
    expect(normalizeProviderInstance({ ...valid, name: 'n'.repeat(MAX_INSTANCE_NAME_LENGTH + 1) })).toBeNull();
  });

  it('rejects non-object options', () => {
    expect(normalizeProviderInstance({ ...valid, options: 'publication' })).toBeNull();
    expect(normalizeProviderInstance({ ...valid, options: 7 })).toBeNull();
    expect(normalizeProviderInstance({ ...valid, options: null })).toBeNull();
  });

  it('rejects array options', () => {
    expect(normalizeProviderInstance({ ...valid, options: ['publication'] })).toBeNull();
  });

  it('accepts arbitrary plain-object options as-is', () => {
    const options = { category: 'news', includeDomains: ['arxiv.org'], nested: { a: 1 } };
    expect(normalizeProviderInstance({ ...valid, options })).toEqual({ ...valid, options });
  });

  it('rejects a baseProviderId that disagrees with the id', () => {
    expect(normalizeProviderInstance({ ...valid, baseProviderId: 'tavily' })).toBeNull();
  });

  it('rejects an unknown baseProviderId', () => {
    expect(normalizeProviderInstance({ ...valid, baseProviderId: 'unknown' })).toBeNull();
  });

  it('rejects an invalid id', () => {
    expect(normalizeProviderInstance({ ...valid, id: 'inst:unknown:abc' })).toBeNull();
    expect(normalizeProviderInstance({ ...valid, id: 'site:exa:abc' })).toBeNull();
    expect(normalizeProviderInstance({ ...valid, id: 'inst:exa:' })).toBeNull();
  });
});

describe('normalizeProviderInstances', () => {
  it('returns [] for non-arrays', () => {
    expect(normalizeProviderInstances(null)).toEqual([]);
    expect(normalizeProviderInstances({ id: 'inst:exa:1' })).toEqual([]);
    expect(normalizeProviderInstances('inst:exa:1')).toEqual([]);
  });

  it('normalizes a valid mix and drops invalid records', () => {
    const raw = [
      makeInstance(1),
      null,
      { id: 'inst:unknown:abc', baseProviderId: 'unknown', name: 'Bad', options: {} },
      'junk',
      makeInstance(2),
    ];
    expect(normalizeProviderInstances(raw)).toEqual([makeInstance(1), makeInstance(2)]);
  });

  it('dedupes repeated ids first-seen wins', () => {
    const first = { ...makeInstance(1), name: 'First' };
    const second = { ...makeInstance(1), name: 'Second' };
    const normalized = normalizeProviderInstances([first, second, makeInstance(2)]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toEqual(first);
    expect(normalized.map((i) => i.name)).toEqual(['First', 'Instance 2']);
  });
});

describe('normalizeProviderInstances bounds', () => {
  it('caps length without returning empty and keeps first-seen order', () => {
    const raw = Array.from({ length: MAX_PROVIDER_INSTANCES + 5 }, (_, i) => makeInstance(i));
    const normalized = normalizeProviderInstances(raw);
    expect(normalized).toHaveLength(MAX_PROVIDER_INSTANCES);
    expect(normalized[0]?.id).toBe('inst:exa:0');
    expect(normalized[MAX_PROVIDER_INSTANCES - 1]?.id).toBe(`inst:exa:${MAX_PROVIDER_INSTANCES - 1}`);
  });

  it('does not wipe a collection that exceeds the serialized byte budget', () => {
    // Pure valid instances stay under the byte cap at MAX_PROVIDER_INSTANCES; extra junk
    // fields simulate a bloated raw storage payload that previously triggered all-or-nothing [].
    const pad = 'x'.repeat(40);
    const oversized = Array.from({ length: MAX_PROVIDER_INSTANCES }, (_, i) => ({
      id: `inst:exa:big${i}`,
      baseProviderId: 'exa',
      name: pad,
      options: { padding: 'P'.repeat(2000) },
      junk: 'J'.repeat(2000),
    }));
    expect(providerInstancesSerializedBytes(oversized)).toBeGreaterThan(MAX_INSTANCES_SERIALIZED_BYTES);
    expect(isBoundedProviderInstanceCollection(oversized)).toBe(false);
    const normalized = normalizeProviderInstances(oversized);
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized.length).toBeLessThanOrEqual(MAX_PROVIDER_INSTANCES);
    expect(normalized[0]?.id).toBe('inst:exa:big0');
    expect(normalized[0]).not.toHaveProperty('junk');
  });

  it('isBoundedProviderInstanceCollection still rejects oversize untrusted payloads', () => {
    const overCount = Array.from({ length: MAX_PROVIDER_INSTANCES + 1 }, (_, i) => makeInstance(i));
    expect(isBoundedProviderInstanceCollection(overCount)).toBe(false);
    expect(isBoundedProviderInstanceCollection([makeInstance(0)])).toBe(true);
  });

  it('rejects an over-bytes collection even under the count cap', () => {
    const overBytes = Array.from({ length: 10 }, (_, i) => ({
      id: `inst:exa:big${i}`,
      baseProviderId: 'exa',
      name: 'Big',
      options: { padding: 'p'.repeat(20000) },
    }));
    expect(overBytes.length).toBeLessThanOrEqual(MAX_PROVIDER_INSTANCES);
    expect(providerInstancesSerializedBytes(overBytes)).toBeGreaterThan(MAX_INSTANCES_SERIALIZED_BYTES);
    expect(isBoundedProviderInstanceCollection(overBytes)).toBe(false);
  });

  it('rejects non-arrays', () => {
    expect(isBoundedProviderInstanceCollection(null)).toBe(false);
    expect(isBoundedProviderInstanceCollection({})).toBe(false);
    expect(isBoundedProviderInstanceCollection('inst:exa:1')).toBe(false);
  });
});

describe('providerInstancesSerializedBytes', () => {
  it('measures the UTF-8 JSON byte length of a collection', () => {
    const one = [makeInstance(1)];
    const two = [makeInstance(1), makeInstance(2)];
    expect(providerInstancesSerializedBytes(one)).toBeGreaterThan(0);
    expect(providerInstancesSerializedBytes(two)).toBeGreaterThan(providerInstancesSerializedBytes(one));
  });

  it('returns Infinity when the value cannot be stringified', () => {
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;
    expect(providerInstancesSerializedBytes(circular)).toBe(Infinity);
  });
});
