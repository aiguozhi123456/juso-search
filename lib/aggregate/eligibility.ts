// 聚合实例 eligibility 纯函数（aggregate-search-rerank plan KTD5/R1）。
//
// 可见性隐式轴（per-instance）= ≥1 个有效成员 且 rerank endpoint 已配置（单源 + rerank 是
// 合法用法，AE10）。显式隐藏轴照常按实例 id 生效，与本函数无关。
//
// ⚠️ eligibility 仅作用于投影（allSources 不投影 ineligible）与可用性解析/回退；
// normalize/持久层（order/hidden 剥落）的定义集 = 全部已定义实例，与 eligibility 无关
// （KTD4 分层铁律：eligibility 抖动期间重写 order/hidden 不得剥落 agg id）。

import type { EngineId } from '../engines/types';
import { allEngines } from '../engines/registry';
import { getEngineExtractor } from '../engines/extractors/registry';
import type { ProviderId } from '../providers/types';
import type { ProviderInstance } from '../provider-instances';
import type { AggregateMemberId } from './types';
import type { RerankConfig } from './types';
import { isRerankConfigured } from './rerank-client';
import type { AggregateInstance } from '../aggregate-instances';

/**
 * 引擎能力从 extractor registry 派生（engine-capability-is-per-registry-not-per-id-union 教训：
 * 能力按 registry 而非 id union），新增/删除 extractor 无需改本清单。
 * 当前 `extractors` 是覆盖闭合 `EngineId` 联合的满表，故下面的 `!= null` 在生产里不筛掉任何
 * engine——它保留在此是为了让派生式对 registry 变稀疏（如按引擎标注能力）仍然成立，而不是靠
 * 某个引擎"恰好"没有 extractor。网关侧的 `unsupported-engine` 分支同理只在这类漂移下可达。
 * 每次调用即时求值（成本 = 一次 9 项 registry 遍历，可忽略）：不缓存快照，registry 状态变化
 * 即时反映到所有调用方（eligibility 判定与 gateway 扇出校验，Lane F）。
 */
function extractorCapableEngineIdSet(): ReadonlySet<EngineId> {
  return new Set(
    allEngines()
      .map((engine) => engine.id)
      .filter((id) => getEngineExtractor(id) != null),
  );
}

/**
 * 引擎成员候选清单（R9/KTD15③）：从 extractor registry 派生，不手写、不按 EngineId union 推断。
 * Options 聚合编辑器「传统引擎」节（Lane E）与 gateway 的 engine 扇出校验（Lane F）共用此单一
 * 派生源——registry 增删 extractor 时清单自动跟随，两处永不漂移。
 * 判据注释：KTD15（不走 engineSearchEnabled 门控，用户显式勾选即 opt-in；
 * 见 docs/solutions/architecture-patterns/engine-extraction-for-user-initiated-aggregate.md）。
 */
export function extractorCapableEngineIds(): EngineId[] {
  return [...extractorCapableEngineIdSet()];
}

export interface AggregateEligibilityInput {
  /** 已配置 key 的 provider id 集合（worker 边界产出；本函数只读，不触 key 值）。 */
  configuredProviderIds: readonly ProviderId[];
  providerInstances: readonly ProviderInstance[];
  rerankConfig: RerankConfig | null | undefined;
}

export interface AggregateEligibility {
  eligible: boolean;
  /** 语义有效的成员（保持实例 members 的存储序）；eligible = rerank 已配置 且 本数组非空。 */
  validMembers: AggregateMemberId[];
}

/**
 * 解析聚合实例的 eligibility（KTD5）。纯函数：
 * - rerank endpoint 未配置 → eligible=false（R3：全部聚合实例不可见 + 搜索报 keyMissing）；
 * - provider 成员：base provider 已配 key 才有效；
 * - provider 实例成员：实例定义存在 且 base provider 已配 key 才有效；
 * - engine 成员：按 extractor registry 存在性恒有效（AE10：单成员实例合法可见可用）。
 */
export function resolveAggregateEligibility(
  instance: Pick<AggregateInstance, 'members'>,
  input: AggregateEligibilityInput,
): AggregateEligibility {
  const configured = new Set<ProviderId>(input.configuredProviderIds);
  const instancesById = new Map(input.providerInstances.map((providerInstance) => [providerInstance.id, providerInstance]));
  const extractorCapable = extractorCapableEngineIdSet();
  const validMembers: AggregateMemberId[] = [];
  for (const member of instance.members) {
    // engine 成员：按 extractor registry 存在性恒有效（勾选即用，KTD15/R9；不走 engineSearchEnabled 门控）。
    if (extractorCapable.has(member as EngineId)) {
      validMembers.push(member);
      continue;
    }
    // provider 实例成员：实例定义存在 且 base provider 已配 key。
    const providerInstance = instancesById.get(member as ProviderInstance['id']);
    if (providerInstance) {
      if (configured.has(providerInstance.baseProviderId)) validMembers.push(member);
      continue;
    }
    // 裸 provider 成员：已配 key 才有效。
    if (configured.has(member as ProviderId)) validMembers.push(member);
  }
  return {
    eligible: isRerankConfigured(input.rerankConfig) && validMembers.length > 0,
    validMembers,
  };
}
