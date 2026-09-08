import type { ProviderId } from '../providers/types';
import { allProviders } from '../providers/registry';
import type { SourceId } from '../sources';
import { allKnownSourceIds, normalizeSourceHidden, normalizeSourceOrder, resolveEffectiveActiveSource } from '../sources';
import type { SiteInstanceDefinition } from '../site-instances';
import { normalizeSiteInstanceDefinitions } from '../site-instances';
import type { CustomEngineDefinition } from '../custom-engines';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import type { ProviderInstance } from '../provider-instances';
import { normalizeProviderInstances } from '../provider-instances';
import type { GroupConfig } from '../source-groups';
import { normalizeGroupConfig, defaultGroupConfig } from '../source-groups';
import { ACTIVE_KEY, ACTIVE_SOURCE_KEY, AI_AUTO_ENTER_KEY, CUSTOM_ENGINES_KEY, FLAT_LAYOUT_FEW_SOURCES_KEY, GROUP_CONFIG_KEY, KEYS_KEY, MAX_RESULTS_KEY, PROVIDER_INSTANCES_KEY, SITE_INSTANCES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, ensureVisibleUsable, isKnownProvider } from './shared';
import { readMaxResultsMapFrom } from './max-results-store';

/** One coherent exact-key view for UI configuration replies. */
export async function getProviderConfigSnapshot(): Promise<{ configuredProviderIds: ProviderId[]; activeProviderId: ProviderId | null; activeSourceId: SourceId; sourceOrder: SourceId[]; sourceHidden: SourceId[]; siteInstances: SiteInstanceDefinition[]; customEngines: CustomEngineDefinition[]; providerInstances: ProviderInstance[]; providerMaxResults: Partial<Record<ProviderId, number>>; groupConfig: GroupConfig; aiAutoEnter: boolean; flatLayoutFewSources: boolean }> {
  const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_INSTANCES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY, AI_AUTO_ENTER_KEY, FLAT_LAYOUT_FEW_SOURCES_KEY]);
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
  const siteInstances = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
  const customEngines = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const providerInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const configuredProviderIds = allProviders().filter((p) => keys[p.id]).map((p) => p.id);
  const activeProviderId = isKnownProvider(got[ACTIVE_KEY]) && keys[got[ACTIVE_KEY]] ? got[ACTIVE_KEY] : configuredProviderIds[0] ?? null;
  const sourceOrder = normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteInstances, customEngines, providerInstances);
  const sourceHidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteInstances, customEngines, providerInstances), sourceOrder, keys, siteInstances, customEngines, providerInstances);
  const providerMaxResults = await readMaxResultsMapFrom(got[MAX_RESULTS_KEY]);
  const groupConfig = got[GROUP_CONFIG_KEY] && typeof got[GROUP_CONFIG_KEY] === 'object'
    ? normalizeGroupConfig(got[GROUP_CONFIG_KEY], allKnownSourceIds(siteInstances, customEngines, providerInstances))
    : defaultGroupConfig(allKnownSourceIds(siteInstances, customEngines, providerInstances));
  // activeSource 可能是实例 id；ProviderConfigReply.activeSourceId 仍为 SourceId（IU7 才把
  // ProviderInstanceId 并入 SourceId），resolveEffectiveActiveSource 已并入 SourceId 联合。
  const storedSource = typeof got[ACTIVE_SOURCE_KEY] === 'string' ? got[ACTIVE_SOURCE_KEY] as SourceId : null;
  const activeFallback = typeof got[ACTIVE_KEY] === 'string' ? got[ACTIVE_KEY] as SourceId : null;
  return { configuredProviderIds, activeProviderId, activeSourceId: resolveEffectiveActiveSource(storedSource ?? activeFallback, keys, siteInstances, customEngines, providerInstances) ?? DEFAULT_ENGINE_ID, sourceOrder, sourceHidden, siteInstances, customEngines, providerInstances, providerMaxResults, groupConfig, aiAutoEnter: got[AI_AUTO_ENTER_KEY] !== false, flatLayoutFewSources: got[FLAT_LAYOUT_FEW_SOURCES_KEY] !== false };
}
