import type { EngineId } from '../engines/types';
import type { ProviderId } from '../providers/types';
import { allProviders } from '../providers/registry';
import type { SourceId } from '../sources';
import type { AggregateSourceDefinition } from '../sources';
import { visibleUsableSource } from '../sources';
import type { SiteInstanceDefinition } from '../site-instances';
import type { CustomEngineDefinition } from '../custom-engines';
import type { ProviderInstance } from '../provider-instances';
import type { AggregateInstanceId, AggregateInstance } from '../aggregate-instances';
import { normalizeAggregateInstances } from '../aggregate-instances';
import type { AggregateEligibility } from '../aggregate/eligibility';
import { resolveAggregateEligibility } from '../aggregate/eligibility';
import { normalizeRerankConfig } from '../aggregate/rerank-client';

export const DEFAULT_ENGINE_ID: EngineId = 'google';

export function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}

/** Normalizes a proposal rather than persisting a switcher with no usable item. */
export function ensureVisibleUsable(hidden: SourceId[], order: SourceId[], keys: unknown, definitions: readonly SiteInstanceDefinition[], customDefinitions: readonly CustomEngineDefinition[] = [], instances: readonly ProviderInstance[] = [], aggregateSources: readonly AggregateSourceDefinition[] = []): SourceId[] {
  const keyMap = (keys ?? {}) as Record<string, string>;
  if (visibleUsableSource(order, hidden, keyMap, definitions, customDefinitions, instances, aggregateSources)) return hidden;
  const fallback = visibleUsableSource(order, [], keyMap, definitions, customDefinitions, instances, aggregateSources);
  return fallback ? hidden.filter((id) => id !== fallback) : hidden;
}

/** 聚合投影（KTD5）：持久层 normalize 用全量定义集（instances），可用性解析用 eligibility 投影（sources）。 */
export interface AggregateProjection {
  /** 全部已定义聚合实例——normalize/持久层定义集，与 eligibility 无关（KTD4 Oracle F2 分层铁律）。 */
  instances: AggregateInstance[];
  /** per-instance eligibility（validMembers 收敛为数量，供快照脱敏字段使用）。 */
  eligibility: Record<AggregateInstanceId, { eligible: boolean; validMembers: number }>;
  /** allSources / 可用性解析的投影输入（eligible 标志已按当前 keys/instances/rerank 计算）。 */
  sources: AggregateSourceDefinition[];
  /** 已配置 key 的 provider id 集合（单点计算：与 snapshot.configuredProviderIds 同源，消除第二份派生）。 */
  configuredProviderIds: ProviderId[];
}

/**
 * 从 storage 原始值构建聚合投影（KTD5）：单点计算 eligibility（快照边界原则），
 * 调用方只需把同一 get 结果里的两键原样传入。eligibility 输入 = 当前 provider keys +
 * 当前 provider 实例 + 当前 rerank 配置——与 snapshot 的 configuredProviderIds 同源。
 */
export function buildAggregateProjection(
  rawInstances: unknown,
  rawRerank: unknown,
  keys: Record<string, string>,
  providerInstances: readonly ProviderInstance[],
): AggregateProjection {
  const instances = normalizeAggregateInstances(rawInstances);
  const rerankConfig = normalizeRerankConfig(rawRerank);
  const configuredProviderIds = allProviders().filter((p) => keys[p.id]).map((p) => p.id);
  const eligibility: Record<AggregateInstanceId, { eligible: boolean; validMembers: number }> = {};
  const sources: AggregateSourceDefinition[] = [];
  for (const instance of instances) {
    const result: AggregateEligibility = resolveAggregateEligibility(instance, { configuredProviderIds, providerInstances, rerankConfig });
    eligibility[instance.id] = { eligible: result.eligible, validMembers: result.validMembers.length };
    sources.push({ id: instance.id, name: instance.name, eligible: result.eligible });
  }
  return { instances, eligibility, sources, configuredProviderIds };
}
