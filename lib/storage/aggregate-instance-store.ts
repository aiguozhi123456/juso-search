// 聚合实例 CRUD（aggregate-search-rerank plan KTD10/KTD18）——机械镜像 provider-instance-store。
//
// 双队列锁序（instance-crud-cross-queue-lock-order.md:39, :74-77）：create/update/delete 一律
// withSourceMutation(() => withAggregateInstancesMutation(...))，先取 source 队列、再取实例队列，
// 与 mergeImport（持 source 队列整写实例数组）串行化，避免并发 lost-update。
//
// ⚠️ 与 provider 实例的显式分歧（KTD18，对照 docs/solutions/architecture-patterns/
// provider-instance-multi-config-model.md:176-180）：无独苗保护（允许删光）、无懒 backfill、
// 无自动创建——activeSource 恒为显式实例 id；删光后聚合组整体消失，AE9 清零路径合法。
//
// Lane C 接线完成：normalizeSourceOrder/normalizeSourceHidden（lib/sources.ts）已接受聚合定义集
// 参数（KTD4/F2：定义集 = 全部已定义实例，与 eligibility 无关），order/hidden 写路径已折叠回
// normalize 直调；eligibility 仅作用于可用性解析（visibleUsableSource 回退，KTD5）。
//
// 聚合级缓存失效（KTD9）在 gateway/cache 车道处理，不在此处（同 provider store 的 IU4/IU6 分工）。

import type { SourceId } from '../sources';
import { normalizeSourceHidden, normalizeSourceOrder, visibleUsableSource } from '../sources';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import { normalizeProviderInstances } from '../provider-instances';
import { normalizeSiteInstanceDefinitions } from '../site-instances';
import type { AggregateInstance, AggregateInstanceId, AggregateMemberId } from '../aggregate-instances';
import {
  aggregateInstancesSerializedBytes,
  MAX_AGGREGATE_INSTANCES,
  MAX_AGGREGATE_SERIALIZED_BYTES,
  newAggregateInstanceId,
  normalizeAggregateInstance,
  normalizeAggregateInstances,
} from '../aggregate-instances';
import type { RerankConfig } from '../aggregate/types';
import { normalizeRerankConfig } from '../aggregate/rerank-client';
import { AGGREGATE_INSTANCES_KEY, ACTIVE_SOURCE_KEY, CUSTOM_ENGINES_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY, RERANK_CONFIG_KEY, SITE_INSTANCES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, buildAggregateProjection } from './shared';
import { withSourceMutation } from './source-graph-store';

// aggregateInstances 的读改写串行队列：create/update/delete/setAggregateInstances 共用，避免并发写丢失。
let aggregateInstancesMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 aggregateInstances 的读改写（create / update / delete），防止并发写覆盖。 */
export function withAggregateInstancesMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = aggregateInstancesMutationQueue.then(mutation, mutation);
  aggregateInstancesMutationQueue = run.catch(() => undefined);
  return run;
}

// === Aggregate Instance CRUD ===
// 实例是快切栏一等 source（agg: 前缀属 SourceId 语义域；sources.ts union 扩展是 Lane C 的事），
// 这里只负责持久化定义；聚合级缓存清理在 gateway/cache（KTD9）处理，不在此处。

export async function getAggregateInstances(): Promise<AggregateInstance[]> {
  const got = await browser.storage.local.get(AGGREGATE_INSTANCES_KEY);
  return normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
}

export async function setAggregateInstances(list: AggregateInstance[]): Promise<void> {
  await withAggregateInstancesMutation(async () => {
    await browser.storage.local.set({ [AGGREGATE_INSTANCES_KEY]: normalizeAggregateInstances(list) });
  });
}

export async function createAggregateInstance(input: { name: string; members: AggregateMemberId[]; topN?: number }): Promise<AggregateInstance> {
  // 同时改写实例集合与 sourceOrder：按 delete 的既定次序先取 source 队列、再取实例队列，
  // 避免与 mergeImport（持 source 队列整写实例数组）并发覆盖。
  return withSourceMutation(() => withAggregateInstancesMutation(async () => {
    // 红线（source-graph-new-type-threading-data-loss）：重写 sourceOrder 必须携带全部四类动态定义集。
    const got = await browser.storage.local.get([AGGREGATE_INSTANCES_KEY, SOURCE_ORDER_KEY, SITE_INSTANCES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    const instances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    const instance = normalizeAggregateInstance({ id: newAggregateInstanceId(), name: input.name, members: input.members, topN: input.topN });
    // 空白起步（R2）：成员清单由调用方给到 ≥1 个有效成员才可保存（UI/worker 门槛）；
    // store 只做形状归一，0 成员实例形状合法（存储后恒 ineligible → 隐藏）。
    if (!instance || instances.length >= MAX_AGGREGATE_INSTANCES || instances.some((item) => item.id === instance.id)) {
      throw new Error('invalid_aggregate_instance');
    }
    const next = [...instances, instance];
    // Reject writes that would exceed the persisted collection byte budget without
    // wiping an existing oversized payload still held in chrome.storage.local.
    if (aggregateInstancesSerializedBytes(next) > MAX_AGGREGATE_SERIALIZED_BYTES) throw new Error('invalid_aggregate_instance');
    // 镜像 site-instance/provider-instance 的 create：新实例 id 进 sourceOrder（实例是一等 source，
    // IU7/KTD4）。定义集含新实例 → normalize 补尾语义自动把新 id 追加到尾部（含同集合其他聚合 id）。
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]), normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]), normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]), next);
    await browser.storage.local.set({ [AGGREGATE_INSTANCES_KEY]: next, [SOURCE_ORDER_KEY]: order });
    return instance;
  }));
}

export async function updateAggregateInstance(
  id: AggregateInstanceId,
  patch: { name?: string; members?: AggregateMemberId[]; topN?: number },
): Promise<AggregateInstance | null> {
  // 整数组读-改-写实例集合：按 create/delete 同序先取 source 队列、再取实例队列，
  // 与 mergeImport（持 source 队列整写实例数组）串行化，避免并发 lost-update。
  return withSourceMutation(() => withAggregateInstancesMutation(async () => {
    const got = await browser.storage.local.get(AGGREGATE_INSTANCES_KEY);
    const instances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    const index = instances.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = instances[index];
    // id 由 create 固化，patch 不可变更；name/members/topN 走归一化（trim/bounds/形状/钳位）。
    const nextInstance = normalizeAggregateInstance({
      id: current.id,
      name: patch.name ?? current.name,
      members: patch.members ?? current.members,
      topN: patch.topN ?? current.topN,
    });
    if (!nextInstance) throw new Error('invalid_aggregate_instance');
    const next = instances.map((item, i) => (i === index ? nextInstance : item));
    if (aggregateInstancesSerializedBytes(next) > MAX_AGGREGATE_SERIALIZED_BYTES) throw new Error('invalid_aggregate_instance');
    // 改名不失效缓存；members/topN 变更仅失效该实例条目（实例 id 即缓存键，KTD9）——
    // 该精确失效由 gateway 的 update handler 编排，不在此处。
    await browser.storage.local.set({ [AGGREGATE_INSTANCES_KEY]: next });
    return nextInstance;
  }));
}

export async function deleteAggregateInstance(id: AggregateInstanceId): Promise<void> {
  // 删除同时改写源图（order/hidden/activeSource）与实例集合：按既有次序先取 source 队列、
  // 再取实例队列，避免与其他源图写入并发覆盖。
  await withSourceMutation(() => withAggregateInstancesMutation(async () => {
    const got = await browser.storage.local.get([AGGREGATE_INSTANCES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, ACTIVE_SOURCE_KEY, KEYS_KEY, SITE_INSTANCES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, RERANK_CONFIG_KEY]);
    const before = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    if (!before.some((item) => item.id === id)) return; // already gone
    // 无独苗保护、允许删光（KTD18 显式分歧）：删最后一个实例合法（AE9 清零），
    // 不抛 cannot_delete_sole_instance、不懒 backfill、不自动创建。
    const instances = before.filter((item) => item.id !== id);
    const siteDefinitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const providerInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    // 定义集 = 删除后的实例集合 → normalize 剥落被删 id、保住同集合其他聚合 id（KTD4/F2：
    // 剥落看定义集，与 eligibility 无关——即使 rerank 已未配置，兄弟实例的 order/hidden 也不动）。
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteDefinitions, customDefinitions, providerInstances, instances);
    const hidden = normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteDefinitions, customDefinitions, providerInstances, instances);
    const set: Record<string, unknown> = { [AGGREGATE_INSTANCES_KEY]: instances, [SOURCE_ORDER_KEY]: order, [SOURCE_HIDDEN_KEY]: hidden };
    if (got[ACTIVE_SOURCE_KEY] === id) {
      // activeSource 回退是派生视图的持久化点（hidden-source-still-active 教训：回退本身
      // 是派生视图，此处是被删定义强制的一次性重解析）。聚合无 base provider，**不双写
      // activeProvider**——与 provider/site 实例 delete 的显式分歧（KTD5）。
      // 回退解析受理兄弟聚合实例的 eligibility（KTD5：lane C 后 agg id 是合法可用源）。
      const { sources: aggregateSources } = buildAggregateProjection(instances, got[RERANK_CONFIG_KEY], keys, providerInstances);
      const fallback = visibleUsableSource(order as SourceId[], hidden as SourceId[], keys, siteDefinitions, customDefinitions, providerInstances, aggregateSources);
      set[ACTIVE_SOURCE_KEY] = fallback ?? DEFAULT_ENGINE_ID;
    }
    await browser.storage.local.set(set);
  }));
}

// === rerank 全局配置（KTD10） ===
// 独立键，与实例集合无共享读改写，不进实例队列；写时失效（rerankConfig 变更 → 删全部聚合
// 缓存条目）由 gateway 的 setRerankConfig handler 编排（KTD9），不在此处。
// endpoint 的 loopback 校验/规范化（KTD12）属 worker 边界（handleSetRerankConfig + config-io），
// 存储层只做形状归一。

export async function getRerankConfig(): Promise<RerankConfig> {
  const got = await browser.storage.local.get(RERANK_CONFIG_KEY);
  return normalizeRerankConfig(got[RERANK_CONFIG_KEY]);
}

export async function setRerankConfig(config: RerankConfig): Promise<void> {
  await browser.storage.local.set({ [RERANK_CONFIG_KEY]: normalizeRerankConfig(config) });
}
