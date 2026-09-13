import { describe, expect, it } from 'vitest';
import { resolveAggregateEligibility } from '@/lib/aggregate/eligibility';
import type { AggregateMemberId } from '@/lib/aggregate/types';
import { allEngines } from '@/lib/engines/registry';
import type { ProviderInstance } from '@/lib/provider-instances';

const RERANK_OK = { endpoint: 'http://127.0.0.1:8000/v1/rerank' };

const EXA_INSTANCE: ProviderInstance = { id: 'inst:exa:abc123', baseProviderId: 'exa', name: 'Exa 实例', options: {} };

function resolve(members: readonly string[], input: Partial<Parameters<typeof resolveAggregateEligibility>[1]> = {}) {
  return resolveAggregateEligibility(
    // 测试需要喂入形态非法的成员 id（防御校验路径），此处收宽为 string[]。
    { members: members as AggregateMemberId[] },
    {
      configuredProviderIds: input.configuredProviderIds ?? [],
      providerInstances: input.providerInstances ?? [],
      // 'rerankConfig' in input 区分「显式传 undefined/null」与「缺省用已配置样本」。
      rerankConfig: 'rerankConfig' in input ? (input.rerankConfig ?? null) : RERANK_OK,
    },
  );
}

describe('resolveAggregateEligibility (KTD5/R1)', () => {
  it('is ineligible when rerank is not configured, even with valid members (R3)', () => {
    expect(resolve(['google'], { rerankConfig: null })).toEqual({ eligible: false, validMembers: ['google'] });
    expect(resolve(['google'], { rerankConfig: undefined })).toEqual({ eligible: false, validMembers: ['google'] });
    expect(resolve(['google'], { rerankConfig: { endpoint: '' } })).toEqual({ eligible: false, validMembers: ['google'] });
    expect(resolve(['google'], { rerankConfig: { endpoint: '   ' } })).toEqual({ eligible: false, validMembers: ['google'] });
  });

  it('is ineligible with zero valid members, even with rerank configured', () => {
    expect(resolve([], {})).toEqual({ eligible: false, validMembers: [] });
    expect(resolve(['tavily'], { configuredProviderIds: [] })).toEqual({ eligible: false, validMembers: [] });
    expect(resolve(['no-such-member'], {})).toEqual({ eligible: false, validMembers: [] });
  });

  it('accepts a single-member instance (AE10: 单源 + rerank 合法)', () => {
    expect(resolve(['google'], {})).toEqual({ eligible: true, validMembers: ['google'] });
    expect(resolve(['tavily'], { configuredProviderIds: ['tavily'] })).toEqual({ eligible: true, validMembers: ['tavily'] });
  });

  it('treats every registry engine as a valid member (extractor-registry derived, no hand-written list)', () => {
    for (const engine of allEngines()) {
      const out = resolve([engine.id], {});
      expect(out.validMembers).toEqual([engine.id]);
      expect(out.eligible).toBe(true);
    }
  });

  it('rejects ids that are not provider/provider-instance/engine members', () => {
    expect(resolve(['ai:grok'], {})).toEqual({ eligible: false, validMembers: [] });
    expect(resolve(['agg:other'], {})).toEqual({ eligible: false, validMembers: [] });
    expect(resolve(['unknown-engine'], {})).toEqual({ eligible: false, validMembers: [] });
  });

  it('resolves provider instance members via the instance list + base provider configuration', () => {
    expect(resolve(['inst:exa:abc123'], { configuredProviderIds: ['exa'], providerInstances: [EXA_INSTANCE] }))
      .toEqual({ eligible: true, validMembers: ['inst:exa:abc123'] });
    // 实例存在但 base provider 未配 key → 无效。
    expect(resolve(['inst:exa:abc123'], { configuredProviderIds: [], providerInstances: [EXA_INSTANCE] }))
      .toEqual({ eligible: false, validMembers: [] });
    // base provider 已配 key 但实例定义不存在 → 无效。
    expect(resolve(['inst:exa:missing'], { configuredProviderIds: ['exa'], providerInstances: [EXA_INSTANCE] }))
      .toEqual({ eligible: false, validMembers: [] });
  });

  it('keeps the instance member storage order in validMembers', () => {
    const out = resolve(['google', 'inst:exa:abc123', 'brave'], {
      configuredProviderIds: ['brave', 'exa'],
      providerInstances: [EXA_INSTANCE],
    });
    expect(out.validMembers).toEqual(['google', 'inst:exa:abc123', 'brave']);
    expect(out.eligible).toBe(true);
  });

  it('never leaks key material from its input into the output', () => {
    const out = resolve(['tavily'], { configuredProviderIds: ['tavily'] });
    expect(JSON.stringify(out)).not.toContain('sk-');
  });
});
