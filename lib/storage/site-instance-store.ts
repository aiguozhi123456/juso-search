import { normalizeSourceHidden, normalizeSourceOrder, visibleUsableSource } from '../sources';
import type { SiteInstanceDefinition, SiteInstanceId } from '../site-instances';
import {
  findDuplicateSiteInstanceScopes,
  MAX_SITE_INSTANCES,
  MAX_INSTANCES_SERIALIZED_BYTES,
  normalizeSiteInstanceDefinition,
  normalizeSiteInstanceDefinitions,
  siteInstancesSerializedBytes,
} from '../site-instances';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import { normalizeAggregateInstances } from '../aggregate-instances';
import { isProviderInstanceId, normalizeProviderInstances } from '../provider-instances';
import { ACTIVE_KEY, ACTIVE_SOURCE_KEY, AGGREGATE_INSTANCES_KEY, CUSTOM_ENGINES_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY, RERANK_CONFIG_KEY, SITE_INSTANCES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, buildAggregateProjection, ensureVisibleUsable, isKnownProvider } from './shared';
import { withSourceMutation } from './source-graph-store';

export async function getSiteInstanceDefinitions(): Promise<SiteInstanceDefinition[]> {
  const got = await browser.storage.local.get(SITE_INSTANCES_KEY);
  return normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
}

export async function createSiteInstanceDefinition(value: unknown): Promise<SiteInstanceDefinition> {
  return withSourceMutation(async () => {
    // 红线（source-graph-new-type-threading-data-loss）：聚合定义集必须穿透每次 order/hidden 重写，
    // 否则任意 site 变更都会剥落 agg id（L2 前科）。
    const got = await browser.storage.local.get([SITE_INSTANCES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY]);
    const definitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    const definition = normalizeSiteInstanceDefinition(value);
    if (!definition || definitions.length >= MAX_SITE_INSTANCES || definitions.some((item) => item.id === definition.id) || findDuplicateSiteInstanceScopes([...definitions, definition]).length) throw new Error('invalid_site_instance');
    const next = [...definitions, definition];
    // Reject writes that would exceed the persisted collection byte budget without
    // wiping an existing oversized payload still held in chrome.storage.local.
    if (siteInstancesSerializedBytes(next) > MAX_INSTANCES_SERIALIZED_BYTES) throw new Error('invalid_site_instance');
    await browser.storage.local.set({ [SITE_INSTANCES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next, customDefinitions, instances, aggregateInstances), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next, customDefinitions, instances, aggregateInstances) });
    return definition;
  });
}

export async function updateSiteInstanceDefinition(id: SiteInstanceId, value: unknown): Promise<SiteInstanceDefinition> {
  return withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_INSTANCES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY]);
    const definitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    const index = definitions.findIndex((item) => item.id === id);
    const definition = normalizeSiteInstanceDefinition(value);
    if (index < 0 || !definition || definition.id !== id || findDuplicateSiteInstanceScopes(definitions.map((item, i) => i === index ? definition : item)).length) throw new Error('invalid_site_instance');
    const next = definitions.map((item, i) => (i === index ? definition : item));
    if (siteInstancesSerializedBytes(next) > MAX_INSTANCES_SERIALIZED_BYTES) throw new Error('invalid_site_instance');
    await browser.storage.local.set({ [SITE_INSTANCES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next, customDefinitions, instances, aggregateInstances), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next, customDefinitions, instances, aggregateInstances) });
    return definition;
  });
}

export async function deleteSiteInstanceDefinition(id: SiteInstanceId): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_INSTANCES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY, RERANK_CONFIG_KEY]);
    const definitions = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]).filter((item) => item.id !== id);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions, customDefinitions, instances, aggregateInstances);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const { sources: aggregateSources } = buildAggregateProjection(got[AGGREGATE_INSTANCES_KEY], got[RERANK_CONFIG_KEY], keys, instances);
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], definitions, customDefinitions, instances, aggregateInstances), order, keys, definitions, customDefinitions, instances, aggregateSources);
    const set: Record<string, unknown> = { [SITE_INSTANCES_KEY]: definitions, [SOURCE_ORDER_KEY]: order, [SOURCE_HIDDEN_KEY]: hidden };
    if (got[ACTIVE_SOURCE_KEY] === id) {
      const fallback = visibleUsableSource(order, hidden, keys, definitions, customDefinitions, instances, aggregateSources);
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
