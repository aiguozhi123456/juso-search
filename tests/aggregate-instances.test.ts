import { describe, expect, it } from 'vitest';
import {
  aggregateInstancesSerializedBytes,
  clampAggregateTopN,
  isAggregateInstanceId,
  isBoundedAggregateInstanceCollection,
  MAX_AGGREGATE_INSTANCE_NAME_LENGTH,
  MAX_AGGREGATE_INSTANCES,
  MAX_AGGREGATE_SERIALIZED_BYTES,
  normalizeAggregateInstance,
  normalizeAggregateInstances,
  type AggregateInstance,
} from '@/lib/aggregate-instances';

function makeInstance(index: number, overrides: Record<string, unknown> = {}): AggregateInstance {
  return {
    id: `agg:inst-${index}`,
    name: `聚合 ${index}`,
    members: ['tavily', 'google'],
    topN: 20,
    ...overrides,
  } as AggregateInstance;
}

describe('isAggregateInstanceId (KTD18 guard)', () => {
  it('accepts valid agg ids (token rules同 inst:/site:)', () => {
    expect(isAggregateInstanceId('agg:abc123')).toBe(true);
    expect(isAggregateInstanceId('agg:A-b_9')).toBe(true);
    expect(isAggregateInstanceId(`agg:${'a'.repeat(128)}`)).toBe(true);
  });

  it('rejects wrong prefixes and malformed tokens', () => {
    expect(isAggregateInstanceId('site:abc123')).toBe(false);
    expect(isAggregateInstanceId('inst:exa:abc')).toBe(false);
    expect(isAggregateInstanceId('ag:abc')).toBe(false);
    expect(isAggregateInstanceId('aggregate:abc')).toBe(false);
    expect(isAggregateInstanceId('')).toBe(false);
    expect(isAggregateInstanceId('agg:')).toBe(false);
    expect(isAggregateInstanceId('agg:bad char')).toBe(false);
    expect(isAggregateInstanceId('agg:abc:def')).toBe(false);
    expect(isAggregateInstanceId(`agg:${'a'.repeat(129)}`)).toBe(false);
  });
});

describe('normalizeAggregateInstance (KTD18)', () => {
  it('normalizes a valid record and materializes a clamped topN', () => {
    expect(normalizeAggregateInstance(makeInstance(1, { topN: 12 }))).toEqual(makeInstance(1, { topN: 12 }));
  });

  it.each([null, undefined, 42, 'agg:x', [], ['agg:x']])('rejects garbage value %o', (value) => {
    expect(normalizeAggregateInstance(value)).toBeNull();
  });

  it('rejects an id whose token part violates the token rules (id-token 不一致拒)', () => {
    expect(normalizeAggregateInstance(makeInstance(1, { id: 'agg:' }))).toBeNull();
    expect(normalizeAggregateInstance(makeInstance(1, { id: 'agg:bad char' }))).toBeNull();
    expect(normalizeAggregateInstance(makeInstance(1, { id: 'site:inst-1' }))).toBeNull();
    expect(normalizeAggregateInstance(makeInstance(1, { id: 'nope' }))).toBeNull();
  });

  it('trims names and rejects empty or over-length names (KTD18: name trim ≤40 非空)', () => {
    expect(normalizeAggregateInstance(makeInstance(1, { name: '  全家桶  ' })))
      .toEqual(makeInstance(1, { name: '全家桶' }));
    expect(normalizeAggregateInstance(makeInstance(1, { name: '   ' }))).toBeNull();
    expect(normalizeAggregateInstance(makeInstance(1, { name: 'n'.repeat(MAX_AGGREGATE_INSTANCE_NAME_LENGTH) })))
      .toEqual(makeInstance(1, { name: 'n'.repeat(MAX_AGGREGATE_INSTANCE_NAME_LENGTH) }));
    expect(normalizeAggregateInstance(makeInstance(1, { name: 'n'.repeat(MAX_AGGREGATE_INSTANCE_NAME_LENGTH + 1) }))).toBeNull();
  });

  it('validates member shape, dedupes first-seen, and keeps a valid mix', () => {
    expect(normalizeAggregateInstance(makeInstance(1, { members: ['tavily', 'junk', 'inst:exa:x', 'tavily', 'google'] })))
      .toEqual(makeInstance(1, { members: ['tavily', 'inst:exa:x', 'google'] }));
    // 形状校验只认 provider / provider 实例 / engine；AI engine 不是成员类型（仅形状层，语义在 eligibility）。
    expect(normalizeAggregateInstance(makeInstance(1, { members: ['ai:grok'] }))?.members).toEqual([]);
  });

  it('accepts an empty members array (存储合法，恒 ineligible → 隐藏，不因语义回写存储)', () => {
    const instance = normalizeAggregateInstance(makeInstance(1, { members: [] }));
    expect(instance).toEqual(makeInstance(1, { members: [] }));
    expect(normalizeAggregateInstance(makeInstance(1, { members: 'tavily' }))).toBeNull();
  });

  it('clamps topN into [5, 20] with default 20 (KTD18 钳位)', () => {
    expect(normalizeAggregateInstance(makeInstance(1, { topN: 3 }))?.topN).toBe(5);
    expect(normalizeAggregateInstance(makeInstance(1, { topN: 25 }))?.topN).toBe(20);
    expect(normalizeAggregateInstance(makeInstance(1))?.topN).toBe(20);
    expect(normalizeAggregateInstance(makeInstance(1, { topN: '12' }))?.topN).toBe(20);
    expect(clampAggregateTopN(7)).toBe(7);
    expect(clampAggregateTopN(7.6)).toBe(8);
    expect(clampAggregateTopN(-1)).toBe(5);
    expect(clampAggregateTopN(undefined)).toBe(20);
  });
});

describe('normalizeAggregateInstances bounds (KTD18)', () => {
  it('returns [] for non-arrays', () => {
    expect(normalizeAggregateInstances(null)).toEqual([]);
    expect(normalizeAggregateInstances({ id: 'agg:x' })).toEqual([]);
    expect(normalizeAggregateInstances('agg:x')).toEqual([]);
  });

  it('normalizes a valid mix and drops invalid records', () => {
    const raw = [makeInstance(1), null, 'junk', makeInstance(2)];
    expect(normalizeAggregateInstances(raw)).toEqual([makeInstance(1), makeInstance(2)]);
  });

  it('dedupes repeated ids first-seen wins', () => {
    const first = makeInstance(1, { name: 'First' });
    const second = makeInstance(1, { name: 'Second' });
    const normalized = normalizeAggregateInstances([first, second, makeInstance(2)]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toEqual(first);
    expect(normalized.map((i) => i.name)).toEqual(['First', '聚合 2']);
  });

  it('caps length without returning empty and keeps first-seen order', () => {
    const raw = Array.from({ length: MAX_AGGREGATE_INSTANCES + 5 }, (_, i) => makeInstance(i));
    const normalized = normalizeAggregateInstances(raw);
    expect(normalized).toHaveLength(MAX_AGGREGATE_INSTANCES);
    expect(normalized[0]?.id).toBe('agg:inst-0');
    expect(normalized[MAX_AGGREGATE_INSTANCES - 1]?.id).toBe(`agg:inst-${MAX_AGGREGATE_INSTANCES - 1}`);
  });

  it('does not wipe a collection that exceeds the serialized byte budget (trusted 保留)', () => {
    const pad = 'x'.repeat(40);
    const oversized = Array.from({ length: MAX_AGGREGATE_INSTANCES }, (_, i) => ({
      id: `agg:big${i}`,
      name: pad,
      members: ['tavily'],
      topN: 20,
      junk: 'J'.repeat(5000),
    }));
    expect(aggregateInstancesSerializedBytes(oversized)).toBeGreaterThan(MAX_AGGREGATE_SERIALIZED_BYTES);
    expect(isBoundedAggregateInstanceCollection(oversized)).toBe(false);
    const normalized = normalizeAggregateInstances(oversized);
    expect(normalized.length).toBeGreaterThan(0);
    expect(normalized.length).toBeLessThanOrEqual(MAX_AGGREGATE_INSTANCES);
    expect(normalized[0]?.id).toBe('agg:big0');
    expect(normalized[0]).not.toHaveProperty('junk');
  });

  it('isBoundedAggregateInstanceCollection rejects oversize untrusted import payloads', () => {
    const overCount = Array.from({ length: MAX_AGGREGATE_INSTANCES + 1 }, (_, i) => makeInstance(i));
    expect(isBoundedAggregateInstanceCollection(overCount)).toBe(false);
    expect(isBoundedAggregateInstanceCollection([makeInstance(0)])).toBe(true);
    const overBytes = Array.from({ length: 10 }, (_, i) => ({
      id: `agg:big${i}`,
      name: 'Big',
      members: [],
      topN: 20,
      padding: 'p'.repeat(20000),
    }));
    expect(overBytes.length).toBeLessThanOrEqual(MAX_AGGREGATE_INSTANCES);
    expect(aggregateInstancesSerializedBytes(overBytes)).toBeGreaterThan(MAX_AGGREGATE_SERIALIZED_BYTES);
    expect(isBoundedAggregateInstanceCollection(overBytes)).toBe(false);
    expect(isBoundedAggregateInstanceCollection(null)).toBe(false);
    expect(isBoundedAggregateInstanceCollection({})).toBe(false);
  });
});

describe('aggregateInstancesSerializedBytes', () => {
  it('measures the UTF-8 JSON byte length of a collection', () => {
    const one = [makeInstance(1)];
    const two = [makeInstance(1), makeInstance(2)];
    expect(aggregateInstancesSerializedBytes(one)).toBeGreaterThan(0);
    expect(aggregateInstancesSerializedBytes(two)).toBeGreaterThan(aggregateInstancesSerializedBytes(one));
  });

  it('returns Infinity when the value cannot be stringified', () => {
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;
    expect(aggregateInstancesSerializedBytes(circular)).toBe(Infinity);
  });
});
