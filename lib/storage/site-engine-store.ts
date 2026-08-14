import { normalizeSourceHidden, normalizeSourceOrder, visibleUsableSource } from '../sources';
import type { SiteEngineDefinition, SiteEngineId } from '../site-engines';
import {
  findDuplicateSiteEngineScopes,
  MAX_SITE_ENGINES,
  MAX_SITE_ENGINES_SERIALIZED_BYTES,
  normalizeSiteEngineDefinition,
  normalizeSiteEngineDefinitions,
  siteEnginesSerializedBytes,
} from '../site-engines';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import { isProviderInstanceId, normalizeProviderInstances } from '../provider-instances';
import { ACTIVE_KEY, ACTIVE_SOURCE_KEY, CUSTOM_ENGINES_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY, SITE_ENGINES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, ensureVisibleUsable, isKnownProvider } from './shared';
import { withSourceMutation } from './source-graph-store';

export async function getSiteEngineDefinitions(): Promise<SiteEngineDefinition[]> {
  const got = await browser.storage.local.get(SITE_ENGINES_KEY);
  return normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
}

export async function createSiteEngineDefinition(value: unknown): Promise<SiteEngineDefinition> {
  return withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const definition = normalizeSiteEngineDefinition(value);
    if (!definition || definitions.length >= MAX_SITE_ENGINES || definitions.some((item) => item.id === definition.id) || findDuplicateSiteEngineScopes([...definitions, definition]).length) throw new Error('invalid_site_engine');
    const next = [...definitions, definition];
    // Reject writes that would exceed the persisted collection byte budget without
    // wiping an existing oversized payload still held in chrome.storage.local.
    if (siteEnginesSerializedBytes(next) > MAX_SITE_ENGINES_SERIALIZED_BYTES) throw new Error('invalid_site_engine');
    await browser.storage.local.set({ [SITE_ENGINES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next, customDefinitions, instances), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next, customDefinitions, instances) });
    return definition;
  });
}

export async function updateSiteEngineDefinition(id: SiteEngineId, value: unknown): Promise<SiteEngineDefinition> {
  return withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const index = definitions.findIndex((item) => item.id === id);
    const definition = normalizeSiteEngineDefinition(value);
    if (index < 0 || !definition || definition.id !== id || findDuplicateSiteEngineScopes(definitions.map((item, i) => i === index ? definition : item)).length) throw new Error('invalid_site_engine');
    const next = definitions.map((item, i) => (i === index ? definition : item));
    if (siteEnginesSerializedBytes(next) > MAX_SITE_ENGINES_SERIALIZED_BYTES) throw new Error('invalid_site_engine');
    await browser.storage.local.set({ [SITE_ENGINES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next, customDefinitions, instances), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next, customDefinitions, instances) });
    return definition;
  });
}

export async function deleteSiteEngineDefinition(id: SiteEngineId): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]).filter((item) => item.id !== id);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions, customDefinitions, instances);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], definitions, customDefinitions, instances), order, keys, definitions, customDefinitions, instances);
    const set: Record<string, unknown> = { [SITE_ENGINES_KEY]: definitions, [SOURCE_ORDER_KEY]: order, [SOURCE_HIDDEN_KEY]: hidden };
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
  });
}
