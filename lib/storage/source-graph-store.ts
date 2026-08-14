import type { ProviderId } from '../providers/types';
import { allProviders } from '../providers/registry';
import type { SourceId } from '../sources';
import { allKnownSourceIds, isEngineId, normalizeSourceHidden, normalizeSourceOrder, resolveEffectiveActiveSource } from '../sources';
import { isRegisteredAiEngineId } from '../ai-engines/registry';
import { normalizeSiteEngineDefinitions } from '../site-engines';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import type { ProviderInstanceId } from '../provider-instances';
import { isProviderInstanceId, normalizeProviderInstances } from '../provider-instances';
import type { GroupConfig } from '../source-groups';
import { normalizeGroupConfig, defaultGroupConfig } from '../source-groups';
import { ACTIVE_KEY, ACTIVE_SOURCE_KEY, CUSTOM_ENGINES_KEY, GROUP_CONFIG_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY, SITE_ENGINES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY } from './keys';
import { DEFAULT_ENGINE_ID, ensureVisibleUsable, isKnownProvider } from './shared';

// sourceOrder 的读改写串行队列：setSourceOrder/mergeImport 共用，避免导入覆盖较新的移动。
let sourceMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 source graph 写入（order / hidden / definitions / active source），保持调用顺序。 */
export function withSourceMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = sourceMutationQueue.then(mutation, mutation);
  sourceMutationQueue = run.catch(() => undefined);
  return run;
}

/**
 * 有效激活 provider：显式选择优先（须为已知 provider）；否则回退到首个已配 key 的 provider；
 * 都没有则 null。切换只影响后续查询（R3）。
 */
export async function getActiveProviderId(): Promise<ProviderId | null> {
  const got = await browser.storage.local.get([ACTIVE_KEY, KEYS_KEY]);
  const stored = got[ACTIVE_KEY];
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
  if (isKnownProvider(stored) && keys[stored]) return stored;
  return allProviders().find((p) => keys[p.id])?.id ?? null;
}

export async function setActiveProviderId(id: ProviderId | null): Promise<void> {
  await browser.storage.local.set({ [ACTIVE_KEY]: id });
}

export async function setActiveProviderAndSourceId(id: ProviderId): Promise<void> {
  await withSourceMutation(async () => {
    await browser.storage.local.set({ [ACTIVE_KEY]: id, [ACTIVE_SOURCE_KEY]: id });
  });
}

// 实例 id 属 SourceId 边界（IU7 将把 ProviderInstanceId 并入 SourceId 联合），
// 在 IU7 落地前 storage 层用本地联合承载「当前激活源可能是实例」这一事实。
type EffectiveSourceId = SourceId | ProviderInstanceId;

export async function getActiveSourceId(): Promise<EffectiveSourceId> {
  const got = await browser.storage.local.get([ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
  const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
  const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const stored = typeof got[ACTIVE_SOURCE_KEY] === 'string' ? got[ACTIVE_SOURCE_KEY] as SourceId : null;
  const activeFallback = typeof got[ACTIVE_KEY] === 'string' ? got[ACTIVE_KEY] as SourceId : null;
  return resolveEffectiveActiveSource(stored ?? activeFallback, keys, definitions, customDefinitions, instances) ?? DEFAULT_ENGINE_ID;
}

export async function setActiveSourceId(id: SourceId | null): Promise<void> {
  await withSourceMutation(async () => { await browser.storage.local.set({ [ACTIVE_SOURCE_KEY]: id }); });
}

/** Validates and commits a source selection against one queued storage snapshot. */
export async function selectActiveSourceId(id: EffectiveSourceId): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([KEYS_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    if (isKnownProvider(id)) {
      if (!keys[id]) throw new Error('invalid_source');
      await browser.storage.local.set({ [ACTIVE_KEY]: id, [ACTIVE_SOURCE_KEY]: id });
      return;
    }
    if (isProviderInstanceId(id)) {
      const instance = instances.find((item) => item.id === id);
      // 实例可用性同 base provider：base provider 未配 key 则拒绝选中（投影层也会过滤）。
      if (!instance || !keys[instance.baseProviderId]) throw new Error('invalid_source');
      // 双写：把 base provider 写入 activeProvider，保证 provider-only 回退路径（getActiveProviderId）仍可用。
      await browser.storage.local.set({ [ACTIVE_KEY]: instance.baseProviderId, [ACTIVE_SOURCE_KEY]: id });
      return;
    }
    if (!isEngineId(id) && !isRegisteredAiEngineId(id) && !definitions.some((definition) => definition.id === id) && !customDefinitions.some((definition) => definition.id === id)) throw new Error('invalid_source');
    await browser.storage.local.set({ [ACTIVE_SOURCE_KEY]: id });
  });
}

/** 快切来源完整顺序；仅读自身键，非法值回退到完整默认顺序。 */
export async function getSourceOrder(): Promise<SourceId[]> {
  const got = await browser.storage.local.get([SOURCE_ORDER_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
  return normalizeSourceOrder(got[SOURCE_ORDER_KEY], normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]), normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]), normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]));
}

export async function setSourceOrder(order: SourceId[]): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    await browser.storage.local.set({ [SOURCE_ORDER_KEY]: normalizeSourceOrder(order, normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]), normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]), normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY])) });
  });
}

/** 快切栏隐藏来源清单；仅读自身键，非法值回退到空数组。 */
export async function getSourceHidden(): Promise<SourceId[]> {
  const got = await browser.storage.local.get([SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
  return normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]), normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]), normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]));
}

export async function setSourceHidden(ids: SourceId[]): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, SOURCE_ORDER_KEY, KEYS_KEY, PROVIDER_INSTANCES_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const hidden = ensureVisibleUsable(normalizeSourceHidden(ids, definitions, customDefinitions, instances), normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions, customDefinitions, instances), (got[KEYS_KEY] ?? {}) as Record<string, string>, definitions, customDefinitions, instances);
    await browser.storage.local.set({ [SOURCE_HIDDEN_KEY]: hidden });
  });
}

// === 来源分组与顶层布局 ===
// 分组只是布局层：不改变 source 的显隐与底层顺序（sourceOrder/sourceHidden 仍各自负责），
// 仅在其之上叠加「哪些 source 置顶平铺 / 哪些收进分组」的布局信息。
// 已知 source id 集合由 lib/sources.ts 的 allKnownSourceIds 统一计算（provider + engine + site-engine），
// 避免各调用方各自硬编码 engine 列表导致漂移。

export async function getGroupConfig(): Promise<GroupConfig> {
  const got = await browser.storage.local.get([GROUP_CONFIG_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
  const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
  const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const raw = got[GROUP_CONFIG_KEY];
  // 缺失/非法 → 回退默认分组配置（开箱即分组，所有 source 按类型入组）。
  if (!raw || typeof raw !== 'object') return defaultGroupConfig(allKnownSourceIds(definitions, customDefinitions, instances));
  return normalizeGroupConfig(raw, allKnownSourceIds(definitions, customDefinitions, instances));
}

export async function setGroupConfig(config: GroupConfig): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const normalized = normalizeGroupConfig(config, allKnownSourceIds(definitions, customDefinitions, instances));
    await browser.storage.local.set({ [GROUP_CONFIG_KEY]: normalized });
  });
}
