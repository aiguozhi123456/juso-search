import { normalizeSourceHidden, normalizeSourceOrder, visibleUsableSource } from '../sources';
import { normalizeSiteInstanceDefinitions } from '../site-instances';
import type { CustomEngineDefinition, CustomEngineId } from '../custom-engines';
import {
  findDuplicateCustomEngineUrls,
  MAX_CUSTOM_ENGINES,
  MAX_CUSTOM_ENGINES_SERIALIZED_BYTES,
  normalizeCustomEngineDefinition,
  normalizeCustomEngineDefinitions,
  customEnginesSerializedBytes,
} from '../custom-engines';
import { isProviderInstanceId, normalizeProviderInstances } from '../provider-instances';
import { normalizeAggregateInstances } from '../aggregate-instances';
import { ACTIVE_KEY, ACTIVE_SOURCE_KEY, AGGREGATE_INSTANCES_KEY, CUSTOM_ENGINES_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY, RERANK_CONFIG_KEY, SITE_INSTANCES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, buildAggregateProjection, ensureVisibleUsable, isKnownProvider } from './shared';
import { withSourceMutation } from './source-graph-store';

// === Custom Engine CRUD ===

export async function getCustomEngineDefinitions(): Promise<CustomEngineDefinition[]> {
  const got = await browser.storage.local.get(CUSTOM_ENGINES_KEY);
  return normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
}

export async function createCustomEngineDefinition(data: { id: CustomEngineId; name: string; urlTemplate: string }): Promise<CustomEngineDefinition> {
  return withSourceMutation(async () => {
    // 红线（source-graph-new-type-threading-data-loss）：聚合定义集穿透每次 order/hidden 重写。
    const got = await browser.storage.local.get([CUSTOM_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_INSTANCES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY]);
    const definitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const definition = normalizeCustomEngineDefinition(data);
    if (!definition || definitions.length >= MAX_CUSTOM_ENGINES || definitions.some((item) => item.id === definition.id) || findDuplicateCustomEngineUrls([...definitions, definition]).length) throw new Error('invalid_custom_engine');
    const next = [...definitions, definition];
    if (customEnginesSerializedBytes(next) > MAX_CUSTOM_ENGINES_SERIALIZED_BYTES) throw new Error('invalid_custom_engine');
    const siteDefinitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    await browser.storage.local.set({ [CUSTOM_ENGINES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteDefinitions, next, instances, aggregateInstances), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteDefinitions, next, instances, aggregateInstances) });
    return definition;
  });
}

export async function updateCustomEngineDefinition(id: CustomEngineId, data: { name: string; urlTemplate: string }): Promise<CustomEngineDefinition> {
  return withSourceMutation(async () => {
    const got = await browser.storage.local.get([CUSTOM_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_INSTANCES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY]);
    const definitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const index = definitions.findIndex((item) => item.id === id);
    const definition = normalizeCustomEngineDefinition({ ...data, id });
    if (index < 0 || !definition || findDuplicateCustomEngineUrls(definitions.map((item, i) => i === index ? definition : item)).length) throw new Error('invalid_custom_engine');
    const next = definitions.map((item, i) => (i === index ? definition : item));
    if (customEnginesSerializedBytes(next) > MAX_CUSTOM_ENGINES_SERIALIZED_BYTES) throw new Error('invalid_custom_engine');
    const siteDefinitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    await browser.storage.local.set({ [CUSTOM_ENGINES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteDefinitions, next, instances, aggregateInstances), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteDefinitions, next, instances, aggregateInstances) });
    return definition;
  });
}

export async function deleteCustomEngineDefinition(id: CustomEngineId): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([CUSTOM_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY, SITE_INSTANCES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY, RERANK_CONFIG_KEY]);
    const definitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]).filter((item) => item.id !== id);
    const siteDefinitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteDefinitions, definitions, instances, aggregateInstances);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const { sources: aggregateSources } = buildAggregateProjection(got[AGGREGATE_INSTANCES_KEY], got[RERANK_CONFIG_KEY], keys, instances);
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteDefinitions, definitions, instances, aggregateInstances), order, keys, siteDefinitions, definitions, instances, aggregateSources);
    const set: Record<string, unknown> = { [CUSTOM_ENGINES_KEY]: definitions, [SOURCE_ORDER_KEY]: order, [SOURCE_HIDDEN_KEY]: hidden };
    if (got[ACTIVE_SOURCE_KEY] === id) {
      const fallback = visibleUsableSource(order, hidden, keys, siteDefinitions, definitions, instances, aggregateSources);
      set[ACTIVE_SOURCE_KEY] = fallback ?? DEFAULT_ENGINE_ID;
      if (fallback && isKnownProvider(fallback)) set[ACTIVE_KEY] = fallback;
      else if (fallback && isProviderInstanceId(fallback)) {
        const inst = instances.find((i) => i.id === fallback);
        if (inst) set[ACTIVE_KEY] = inst.baseProviderId;
      }
      // 聚合无 base provider——fallback 为 agg id 时不双写 activeProvider（KTD5 显式分歧）。
    }
    await browser.storage.local.set(set);
  });
}
