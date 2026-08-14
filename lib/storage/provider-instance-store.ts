import type { ProviderId } from '../providers/types';
import { normalizeSourceHidden, normalizeSourceOrder, visibleUsableSource } from '../sources';
import { normalizeSiteEngineDefinitions } from '../site-engines';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import type { ProviderInstance, ProviderInstanceId } from '../provider-instances';
import {
  isProviderInstanceId,
  MAX_PROVIDER_INSTANCES,
  MAX_INSTANCES_SERIALIZED_BYTES,
  normalizeProviderInstance,
  normalizeProviderInstances,
  providerInstancesSerializedBytes,
} from '../provider-instances';
import { ACTIVE_KEY, ACTIVE_SOURCE_KEY, CUSTOM_ENGINES_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY, SITE_ENGINES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, ensureVisibleUsable, isKnownProvider } from './shared';
import { withSourceMutation } from './source-graph-store';

// providerInstances 的读改写串行队列：create/update/deleteProviderInstance 共用，避免并发写丢失。
let providerInstancesMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 providerInstances 的读改写（create / update / delete），防止并发写覆盖。 */
export function withProviderInstancesMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerInstancesMutationQueue.then(mutation, mutation);
  providerInstancesMutationQueue = run.catch(() => undefined);
  return run;
}

// === Provider Instance CRUD ===
// 实例是快切栏一等公民（SourceId 边界，IU7 并入），这里只负责持久化定义；
// 实例级缓存清理在 IU4/IU6（gateway/cache）处理，不在此处。

export async function getProviderInstances(): Promise<ProviderInstance[]> {
  const got = await browser.storage.local.get(PROVIDER_INSTANCES_KEY);
  return normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
}

export async function setProviderInstances(list: ProviderInstance[]): Promise<void> {
  await withProviderInstancesMutation(async () => {
    await browser.storage.local.set({ [PROVIDER_INSTANCES_KEY]: normalizeProviderInstances(list) });
  });
}

export async function createProviderInstance(baseProviderId: ProviderId, name: string, options: Record<string, unknown>): Promise<ProviderInstance> {
  // 同时改写实例集合与 sourceOrder：按 deleteProviderInstance/clearKey 的既定次序
  // 先取 source 队列、再取实例队列，避免与 mergeImport（持 source 队列整写实例数组）并发覆盖。
  return withSourceMutation(() => withProviderInstancesMutation(async () => {
    const got = await browser.storage.local.get([PROVIDER_INSTANCES_KEY, SOURCE_ORDER_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const instance = normalizeProviderInstance({ id: `inst:${baseProviderId}:${crypto.randomUUID()}` as ProviderInstanceId, baseProviderId, name, options });
    if (!instance || instances.length >= MAX_PROVIDER_INSTANCES || instances.some((item) => item.id === instance.id)) throw new Error('invalid_provider_instance');
    const next = [...instances, instance];
    // Reject writes that would exceed the persisted collection byte budget without
    // wiping an existing oversized payload still held in chrome.storage.local.
    if (providerInstancesSerializedBytes(next) > MAX_INSTANCES_SERIALIZED_BYTES) throw new Error('invalid_provider_instance');
    // 镜像 site-engine/custom-engine 的 create：把新实例 id 追加到 sourceOrder 尾部，
    // 否则新实例不在 sourceOrder 中，无法被排序/隐藏（IU7 实例是一等 source）。
    const siteDefinitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    await browser.storage.local.set({ [PROVIDER_INSTANCES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteDefinitions, customDefinitions, next) });
    return instance;
  }));
}

/** 统一实例模型（KTD5）：为 base provider 原子地补齐默认实例——读-判-建全部在实例变更队列内，
 *  消除并发 save key 时双双读到空列表而重复创建默认实例的竞态。已有实例则 no-op。
 *  options 固定为空对象（全部走适配器默认）。
 *  同时改写实例集合与 sourceOrder：与 createProviderInstance 同序先取 source 队列、再取实例队列，
 *  避免与 mergeImport（持 source 队列整写实例数组）并发覆盖。 */
export async function ensureDefaultInstance(baseProviderId: ProviderId, name: string): Promise<void> {
  await withSourceMutation(() => withProviderInstancesMutation(async () => {
    const got = await browser.storage.local.get([PROVIDER_INSTANCES_KEY, SOURCE_ORDER_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    if (instances.some((instance) => instance.baseProviderId === baseProviderId)) return;
    const instance = normalizeProviderInstance({ id: `inst:${baseProviderId}:${crypto.randomUUID()}` as ProviderInstanceId, baseProviderId, name, options: {} });
    if (!instance || instances.length >= MAX_PROVIDER_INSTANCES) throw new Error('invalid_provider_instance');
    const next = [...instances, instance];
    // Reject writes that would exceed the persisted collection byte budget without
    // wiping an existing oversized payload still held in chrome.storage.local.
    if (providerInstancesSerializedBytes(next) > MAX_INSTANCES_SERIALIZED_BYTES) throw new Error('invalid_provider_instance');
    // 镜像 createProviderInstance：把新实例 id 追加到 sourceOrder 尾部。
    const siteDefinitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    await browser.storage.local.set({ [PROVIDER_INSTANCES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteDefinitions, customDefinitions, next) });
  }));
}

export async function updateProviderInstance(id: ProviderInstanceId, patch: { name?: string; options?: Record<string, unknown> }): Promise<ProviderInstance | null> {
  // 整数组读-改-写实例集合：按 create/ensure/delete 同序先取 source 队列、再取实例队列，
  // 与 mergeImport（持 source 队列整写实例数组）串行化，避免并发 lost-update。
  return withSourceMutation(() => withProviderInstancesMutation(async () => {
    const got = await browser.storage.local.get(PROVIDER_INSTANCES_KEY);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const index = instances.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = instances[index];
    // base provider 由 id 编码，patch 不可变更；name/options 走归一化（trim/bounds/plain-object）。
    const nextInstance = normalizeProviderInstance({
      id: current.id,
      baseProviderId: current.baseProviderId,
      name: patch.name ?? current.name,
      options: patch.options ?? current.options,
    });
    if (!nextInstance) throw new Error('invalid_provider_instance');
    const next = instances.map((item, i) => (i === index ? nextInstance : item));
    if (providerInstancesSerializedBytes(next) > MAX_INSTANCES_SERIALIZED_BYTES) throw new Error('invalid_provider_instance');
    await browser.storage.local.set({ [PROVIDER_INSTANCES_KEY]: next });
    return nextInstance;
  }));
}

export async function deleteProviderInstance(id: ProviderInstanceId): Promise<void> {
  // 删除同时改写源图（order/hidden/activeSource）与实例集合：按 clearKey 的既定次序
  // 先取 source 队列、再取实例队列，避免与其他源图写入（select/站点引擎 CRUD）并发覆盖。
  await withSourceMutation(() => withProviderInstancesMutation(async () => {
    const got = await browser.storage.local.get([PROVIDER_INSTANCES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY]);
    const before = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const instance = before.find((item) => item.id === id);
    if (!instance) return; // already gone
    // 统一实例模型：每个 provider 至少保留一个实例（默认实例不可删，只能隐藏）。
    const sameProviderCount = before.filter((item) => item.baseProviderId === instance.baseProviderId).length;
    if (sameProviderCount <= 1) throw new Error('cannot_delete_sole_instance');
    const instances = before.filter((item) => item.id !== id);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions, customDefinitions, instances);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], definitions, customDefinitions, instances), order, keys, definitions, customDefinitions, instances);
    const set: Record<string, unknown> = { [PROVIDER_INSTANCES_KEY]: instances, [SOURCE_ORDER_KEY]: order, [SOURCE_HIDDEN_KEY]: hidden };
    if (got[ACTIVE_SOURCE_KEY] === id) {
      const fallback = visibleUsableSource(order, hidden, keys, definitions, customDefinitions, instances);
      set[ACTIVE_SOURCE_KEY] = fallback ?? DEFAULT_ENGINE_ID;
      if (fallback && isKnownProvider(fallback)) set[ACTIVE_KEY] = fallback;
      else if (fallback && isProviderInstanceId(fallback)) {
        const inst = instances.find((i) => i.id === fallback);
        if (inst) set[ACTIVE_KEY] = inst.baseProviderId;
      }
    }
    await browser.storage.local.set(set);
  }));
}
