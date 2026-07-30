import type { EngineId } from './engines/types';
import type { NormalizedSearchResponse, ProviderId } from './providers/types';
import { allProviders } from './providers/registry';
import type { SourceId } from './sources';
import { allKnownSourceIds, isEngineId, normalizeSourceHidden, normalizeSourceOrder } from './sources';
import type { SiteEngineDefinition, SiteEngineId } from './site-engines';
import type { GroupConfig } from './source-groups';
import { normalizeGroupConfig, defaultGroupConfig } from './source-groups';
import {
  findDuplicateSiteEngineScopes,
  MAX_SITE_ENGINES,
  MAX_SITE_ENGINES_SERIALIZED_BYTES,
  normalizeSiteEngineDefinition,
  normalizeSiteEngineDefinitions,
  siteEnginesSerializedBytes,
} from './site-engines';
import {
  SEARCH_CACHE_CAP,
  SEARCH_CACHE_INDEX_KEY,
  buildSearchCacheEntry,
  buildSearchCacheSummary,
  emptySearchCacheIndex,
  isSearchCacheIndex,
  makeSearchCacheKey,
  searchCacheEntryKey,
  type SearchCacheEntry,
  type SearchCacheIndex,
  type SearchCacheSummary,
} from './search-cache';

// BYOK key 仅存 chrome.storage.local（R7 信任底线）。
// ⚠️ getKey 只应由 background service worker 调用；
//   搜索页/设置页不应直接读 key，仅由 worker 代理调 provider API。
// ⚠️ 优先用精确键（string | string[]）调用 browser.storage.local.get，
//   不要 get(null)——后者每次读全库（含 50 个 searchCacheEntry，~1MB），
//   在 MV3 worker 频繁唤醒下是显著开销，也违背 key 卫生（把敏感键读入单一 record）。

export const KEYS_KEY = 'providerKeys'; // Record<ProviderId, string>
export const ACTIVE_KEY = 'activeProvider'; // ProviderId | null
export const ACTIVE_SOURCE_KEY = 'activeSource'; // SourceId | null
export const THEME_KEY = 'themePref'; // ThemePref
export const LOCALE_KEY = 'localePref'; // LocalePref
export const STYLE_KEY = 'stylePref'; // StylePref (UI 风格维度：经典 / 彩色)
export const SOURCE_ORDER_KEY = 'sourceOrder'; // SourceId[]
export const SOURCE_HIDDEN_KEY = 'sourceHidden'; // SourceId[]
export const SITE_ENGINES_KEY = 'siteEngines'; // SiteEngineDefinition[]
export const GROUP_CONFIG_KEY = 'groupConfig'; // GroupConfig（分组定义 + 顶层混合 layout + 赋值）
export const MAX_RESULTS_KEY = 'providerMaxResults'; // Record<ProviderId, number>
// Agent Bridge 门控（默认 false）：上架合规——engine-search 抓 Google/Bing/Baidu 属 scraping 风险，
// 必须用户显式开启。仅读各自键，不 get(null)（与 theme/locale 同样的 key 卫生）。
export const AGENT_BRIDGE_ENABLED_KEY = 'agentBridgeEnabled'; // boolean（stored === true 才 true）
export const ENGINE_SEARCH_ENABLED_KEY = 'engineSearchEnabled'; // boolean
export const BAR_POSITION_KEY = 'serpBarPosition'; // BarPositionPref (快切栏栏位：auto / top / bottom)

export type ThemePref = 'auto' | 'light' | 'dark';
export type LocalePref = 'auto' | 'zh_CN' | 'en';
export type StylePref = 'classic' | 'colorful';
export type BarPositionPref = 'auto' | 'top' | 'bottom';
let searchCacheMutationQueue: Promise<unknown> = Promise.resolve();
// providerKeys 的读改写串行队列：setKey/clearKey/mergeImport 共用，避免并发写丢失。
let providerKeysMutationQueue: Promise<unknown> = Promise.resolve();
// sourceOrder 的读改写串行队列：setSourceOrder/mergeImport 共用，避免导入覆盖较新的移动。
let sourceMutationQueue: Promise<unknown> = Promise.resolve();
// providerMaxResults 的读改写串行队列：setProviderMaxResults/clearProviderMaxResults/mergeImport 共用，避免并发写丢失。
let providerMaxResultsMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 providerKeys 的读改写（setKey / clearKey / mergeImport），防止并发写覆盖。 */
export function withProviderKeysMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerKeysMutationQueue.then(mutation, mutation);
  providerKeysMutationQueue = run.catch(() => undefined);
  return run;
}

/** 串行化 source graph 写入（order / hidden / definitions / active source），保持调用顺序。 */
export function withSourceMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = sourceMutationQueue.then(mutation, mutation);
  sourceMutationQueue = run.catch(() => undefined);
  return run;
}

/** 串行化 providerMaxResults 的读改写（set / clear / mergeImport），防止并发写覆盖。 */
export function withProviderMaxResultsMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerMaxResultsMutationQueue.then(mutation, mutation);
  providerMaxResultsMutationQueue = run.catch(() => undefined);
  return run;
}

async function readKeys(): Promise<Record<string, string>> {
  const got = await browser.storage.local.get(KEYS_KEY);
  return (got[KEYS_KEY] ?? {}) as Record<string, string>;
}

function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}

const DEFAULT_ENGINE_ID: EngineId = 'google';

export async function getConfiguredProviderIds(): Promise<ProviderId[]> {
  const keys = await readKeys();
  return allProviders().filter((p) => keys[p.id]).map((p) => p.id);
}

/** 返回某 provider 的 key，未配置则 null。仅 worker 调用。 */
export async function getKey(id: ProviderId): Promise<string | null> {
  const keys = await readKeys();
  return keys[id] ?? null;
}

export async function setKey(id: ProviderId, key: string): Promise<void> {
  await withProviderKeysMutation(async () => {
    const keys = await readKeys();
    keys[id] = key;
    await browser.storage.local.set({ [KEYS_KEY]: keys });
  });
}

export async function clearKey(id: ProviderId): Promise<void> {
  // Always acquire source before provider keys when an operation touches both;
  // mergeImport follows this same order.
  await withSourceMutation(() => withProviderKeysMutation(async () => {
    const got = await browser.storage.local.get([KEYS_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, MAX_RESULTS_KEY]);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    delete keys[id];
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions);
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], definitions), order, keys, definitions);
    // 同步清除该 provider 的 maxResults，避免删除 key 后残留孤立设置，
    // 用户重新配置 key 时旧 maxResults 不会静默复用。
    const maxMap = (got[MAX_RESULTS_KEY] && typeof got[MAX_RESULTS_KEY] === 'object' && !Array.isArray(got[MAX_RESULTS_KEY])
      ? got[MAX_RESULTS_KEY] as Record<string, unknown>
      : {});
    const maxChanged = id in maxMap;
    if (maxChanged) delete maxMap[id];
    const setObj: Record<string, unknown> = { [KEYS_KEY]: keys, [SOURCE_HIDDEN_KEY]: hidden };
    if (maxChanged) setObj[MAX_RESULTS_KEY] = maxMap;
    await browser.storage.local.set(setObj);
  }));
}

// === 搜索结果条数（per-provider maxResults）===
// 非敏感配置（与 key 不同），但仍走 worker 代理以保持单一配置入口。
// 缺省（未显式设置）由各适配器兜底（REST 适配器 ?? 8，jina ?? 5）。

/** 合法 maxResults 区间：1–20。超出则 clamp。 */
export const MAX_RESULTS_MIN = 1;
export const MAX_RESULTS_MAX = 20;

export function clampMaxResults(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < MAX_RESULTS_MIN) return MAX_RESULTS_MIN;
  if (i > MAX_RESULTS_MAX) return MAX_RESULTS_MAX;
  return i;
}

async function readMaxResultsMap(): Promise<Record<string, number>> {
  const got = await browser.storage.local.get(MAX_RESULTS_KEY);
  const raw = got[MAX_RESULTS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(map)) {
    if (isKnownProvider(id)) {
      const clamped = clampMaxResults(n);
      if (clamped !== null) out[id] = clamped;
    }
  }
  return out;
}

/** 返回某 provider 的 maxResults；未配置则 null（由调用方走适配器默认）。 */
export async function getProviderMaxResults(id: ProviderId): Promise<number | null> {
  const map = await readMaxResultsMap();
  return map[id] ?? null;
}

/** 设置某 provider 的 maxResults（clamp 到 1–20）。 */
export async function setProviderMaxResults(id: ProviderId, maxResults: number): Promise<void> {
  const clamped = clampMaxResults(maxResults);
  if (clamped === null) throw new Error('invalid_max_results');
  await withProviderMaxResultsMutation(async () => {
    const got = await browser.storage.local.get(MAX_RESULTS_KEY);
    const map = (got[MAX_RESULTS_KEY] && typeof got[MAX_RESULTS_KEY] === 'object' && !Array.isArray(got[MAX_RESULTS_KEY])
      ? got[MAX_RESULTS_KEY] as Record<string, unknown>
      : {});
    map[id] = clamped;
    await browser.storage.local.set({ [MAX_RESULTS_KEY]: map });
  });
}

/** 清除某 provider 的 maxResults（恢复适配器默认）。 */
export async function clearProviderMaxResults(id: ProviderId): Promise<void> {
  await withProviderMaxResultsMutation(async () => {
    const got = await browser.storage.local.get(MAX_RESULTS_KEY);
    const map = (got[MAX_RESULTS_KEY] && typeof got[MAX_RESULTS_KEY] === 'object' && !Array.isArray(got[MAX_RESULTS_KEY])
      ? got[MAX_RESULTS_KEY] as Record<string, unknown>
      : {});
    if (!(id in map)) return; // 本就未设置，no-op
    delete map[id];
    await browser.storage.local.set({ [MAX_RESULTS_KEY]: map });
  });
}

/** 返回全部已配置的 maxResults 映射（仅含已知 provider、已 clamp）。 */
export async function getAllProviderMaxResults(): Promise<Partial<Record<ProviderId, number>>> {
  return readMaxResultsMap();
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

export async function getActiveSourceId(): Promise<SourceId> {
  const got = await browser.storage.local.get([ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY, SITE_ENGINES_KEY]);
  return effectiveActiveSource(got[ACTIVE_SOURCE_KEY], got[ACTIVE_KEY], got[KEYS_KEY], normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]));
}

function effectiveActiveSource(storedSource: unknown, storedProvider: unknown, rawKeys: unknown, definitions: readonly SiteEngineDefinition[]): SourceId {
  const keys = (rawKeys ?? {}) as Record<string, string>;
  if (typeof storedSource === 'string') {
    if (isEngineId(storedSource)) return storedSource;
    if (definitions.some((definition) => definition.id === storedSource)) return storedSource as SiteEngineId;
    if (isKnownProvider(storedSource) && keys[storedSource]) return storedSource;
  }
  if (isKnownProvider(storedProvider) && keys[storedProvider]) return storedProvider;
  return allProviders().find((p) => keys[p.id])?.id ?? DEFAULT_ENGINE_ID;
}

export async function setActiveSourceId(id: SourceId | null): Promise<void> {
  await withSourceMutation(async () => { await browser.storage.local.set({ [ACTIVE_SOURCE_KEY]: id }); });
}

/** Validates and commits a source selection against one queued storage snapshot. */
export async function selectActiveSourceId(id: SourceId): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([KEYS_KEY, SITE_ENGINES_KEY]);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    if (isKnownProvider(id)) {
      if (!keys[id]) throw new Error('invalid_source');
      await browser.storage.local.set({ [ACTIVE_KEY]: id, [ACTIVE_SOURCE_KEY]: id });
      return;
    }
    if (!isEngineId(id) && !definitions.some((definition) => definition.id === id)) throw new Error('invalid_source');
    await browser.storage.local.set({ [ACTIVE_SOURCE_KEY]: id });
  });
}

/** 主题偏好：auto（跟随系统，默认）/ light / dark。
 *  仅读 THEME_KEY，不 get(null)，避免把 BYOK providerKeys 读入页面内存（R7 信任底线）。 */
export async function getThemePref(): Promise<ThemePref> {
  const got = await browser.storage.local.get(THEME_KEY);
  const stored = got[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  await browser.storage.local.set({ [THEME_KEY]: pref });
}

/** UI 语言偏好：auto（跟随浏览器 UI 语言，默认）/ zh_CN / en。
 *  仅读 LOCALE_KEY，不 get(null)（与 themePref 同样的 key 卫生原则）。 */
export async function getLocalePref(): Promise<LocalePref> {
  const got = await browser.storage.local.get(LOCALE_KEY);
  const stored = got[LOCALE_KEY];
  return stored === 'zh_CN' || stored === 'en' ? stored : 'auto';
}

export async function setLocalePref(pref: LocalePref): Promise<void> {
  await browser.storage.local.set({ [LOCALE_KEY]: pref });
}

/** UI 风格偏好：classic（朱砂经典，默认）/ colorful（分布式多色）。
 *  与 themePref 同样的 key 卫生：仅读自身键，不 get(null)。 */
export async function getStylePref(): Promise<StylePref> {
  const got = await browser.storage.local.get(STYLE_KEY);
  const stored = got[STYLE_KEY];
  return stored === 'colorful' ? 'colorful' : 'classic';
}

export async function setStylePref(pref: StylePref): Promise<void> {
  await browser.storage.local.set({ [STYLE_KEY]: pref });
}

/** 快切栏栏位偏好：auto（窄屏自动底栏，默认）/ top / bottom。
 *  与 stylePref 同样的 key 卫生：仅读自身键，不 get(null)。 */
export async function getBarPositionPref(): Promise<BarPositionPref> {
  const got = await browser.storage.local.get(BAR_POSITION_KEY);
  const stored = got[BAR_POSITION_KEY];
  return stored === 'top' || stored === 'bottom' ? stored : 'auto';
}

export async function setBarPositionPref(pref: BarPositionPref): Promise<void> {
  await browser.storage.local.set({ [BAR_POSITION_KEY]: pref });
}

/** Agent Bridge 总开关：默认 false，stored === true 才 true。
 *  控制整个 Agent Bridge（search / list-providers / engine-search 三 action）。 */
export async function getAgentBridgeEnabled(): Promise<boolean> {
  const got = await browser.storage.local.get(AGENT_BRIDGE_ENABLED_KEY);
  return got[AGENT_BRIDGE_ENABLED_KEY] === true;
}

export async function setAgentBridgeEnabled(v: boolean): Promise<void> {
  await browser.storage.local.set({ [AGENT_BRIDGE_ENABLED_KEY]: v });
}

/** engine-search 子开关：默认 false，stored === true 才 true。
 *  仅控制 engine-search action；UI 上仅当总开关 on 时可点。 */
export async function getEngineSearchEnabled(): Promise<boolean> {
  const got = await browser.storage.local.get(ENGINE_SEARCH_ENABLED_KEY);
  return got[ENGINE_SEARCH_ENABLED_KEY] === true;
}

export async function setEngineSearchEnabled(v: boolean): Promise<void> {
  await browser.storage.local.set({ [ENGINE_SEARCH_ENABLED_KEY]: v });
}

/** 快切来源完整顺序；仅读自身键，非法值回退到完整默认顺序。 */
export async function getSourceOrder(): Promise<SourceId[]> {
  const got = await browser.storage.local.get([SOURCE_ORDER_KEY, SITE_ENGINES_KEY]);
  return normalizeSourceOrder(got[SOURCE_ORDER_KEY], normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]));
}

export async function setSourceOrder(order: SourceId[]): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get(SITE_ENGINES_KEY);
    await browser.storage.local.set({ [SOURCE_ORDER_KEY]: normalizeSourceOrder(order, normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY])) });
  });
}

/** 快切栏隐藏来源清单；仅读自身键，非法值回退到空数组。 */
export async function getSourceHidden(): Promise<SourceId[]> {
  const got = await browser.storage.local.get([SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY]);
  return normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]));
}

export async function setSourceHidden(ids: SourceId[]): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, KEYS_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const hidden = ensureVisibleUsable(normalizeSourceHidden(ids, definitions), normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions), got[KEYS_KEY], definitions);
    await browser.storage.local.set({ [SOURCE_HIDDEN_KEY]: hidden });
  });
}

// === 来源分组与顶层布局 ===
// 分组只是布局层：不改变 source 的显隐与底层顺序（sourceOrder/sourceHidden 仍各自负责），
// 仅在其之上叠加「哪些 source 置顶平铺 / 哪些收进分组」的布局信息。
// 已知 source id 集合由 lib/sources.ts 的 allKnownSourceIds 统一计算（provider + engine + site-engine），
// 避免各调用方各自硬编码 engine 列表导致漂移。

export async function getGroupConfig(): Promise<GroupConfig> {
  const got = await browser.storage.local.get([GROUP_CONFIG_KEY, SITE_ENGINES_KEY]);
  const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
  const raw = got[GROUP_CONFIG_KEY];
  // 缺失/非法 → 回退默认分组配置（开箱即分组，所有 source 按类型入组）。
  if (!raw || typeof raw !== 'object') return defaultGroupConfig(allKnownSourceIds(definitions));
  return normalizeGroupConfig(raw, allKnownSourceIds(definitions));
}

export async function setGroupConfig(config: GroupConfig): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get(SITE_ENGINES_KEY);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const normalized = normalizeGroupConfig(config, allKnownSourceIds(definitions));
    await browser.storage.local.set({ [GROUP_CONFIG_KEY]: normalized });
  });
}

export async function getSiteEngineDefinitions(): Promise<SiteEngineDefinition[]> {
  const got = await browser.storage.local.get(SITE_ENGINES_KEY);
  return normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
}

export async function createSiteEngineDefinition(value: unknown): Promise<SiteEngineDefinition> {
  return withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const definition = normalizeSiteEngineDefinition(value);
    if (!definition || definitions.length >= MAX_SITE_ENGINES || definitions.some((item) => item.id === definition.id) || findDuplicateSiteEngineScopes([...definitions, definition]).length) throw new Error('invalid_site_engine');
    const next = [...definitions, definition];
    // Reject writes that would exceed the persisted collection byte budget without
    // wiping an existing oversized payload still held in chrome.storage.local.
    if (siteEnginesSerializedBytes(next) > MAX_SITE_ENGINES_SERIALIZED_BYTES) throw new Error('invalid_site_engine');
    await browser.storage.local.set({ [SITE_ENGINES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next) });
    return definition;
  });
}

export async function updateSiteEngineDefinition(id: SiteEngineId, value: unknown): Promise<SiteEngineDefinition> {
  return withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const index = definitions.findIndex((item) => item.id === id);
    const definition = normalizeSiteEngineDefinition(value);
    if (index < 0 || !definition || definition.id !== id || findDuplicateSiteEngineScopes(definitions.map((item, i) => i === index ? definition : item)).length) throw new Error('invalid_site_engine');
    const next = definitions.map((item, i) => (i === index ? definition : item));
    if (siteEnginesSerializedBytes(next) > MAX_SITE_ENGINES_SERIALIZED_BYTES) throw new Error('invalid_site_engine');
    await browser.storage.local.set({ [SITE_ENGINES_KEY]: next, [SOURCE_ORDER_KEY]: normalizeSourceOrder(got[SOURCE_ORDER_KEY], next), [SOURCE_HIDDEN_KEY]: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], next) });
    return definition;
  });
}

export async function deleteSiteEngineDefinition(id: SiteEngineId): Promise<void> {
  await withSourceMutation(async () => {
    const got = await browser.storage.local.get([SITE_ENGINES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, ACTIVE_SOURCE_KEY, ACTIVE_KEY, KEYS_KEY]);
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]).filter((item) => item.id !== id);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], definitions), order, keys, definitions);
    const set: Record<string, unknown> = { [SITE_ENGINES_KEY]: definitions, [SOURCE_ORDER_KEY]: order, [SOURCE_HIDDEN_KEY]: hidden };
    if (got[ACTIVE_SOURCE_KEY] === id) {
      const fallback = visibleUsableSource(order, hidden, keys, definitions);
      set[ACTIVE_SOURCE_KEY] = fallback ?? DEFAULT_ENGINE_ID;
      if (fallback && isKnownProvider(fallback)) set[ACTIVE_KEY] = fallback;
    }
    await browser.storage.local.set(set);
  });
}

function visibleUsableSource(order: readonly SourceId[], hidden: readonly SourceId[], rawKeys: unknown, definitions: readonly SiteEngineDefinition[]): SourceId | undefined {
  const keys = (rawKeys ?? {}) as Record<string, string>;
  const hiddenSet = new Set(hidden);
  return order.find((source) => !hiddenSet.has(source) && (isEngineId(source) || definitions.some((item) => item.id === source) || (isKnownProvider(source) && !!keys[source])));
}

/** Normalizes a proposal rather than persisting a switcher with no usable item. */
function ensureVisibleUsable(hidden: SourceId[], order: SourceId[], keys: unknown, definitions: readonly SiteEngineDefinition[]): SourceId[] {
  if (visibleUsableSource(order, hidden, keys, definitions)) return hidden;
  const fallback = visibleUsableSource(order, [], keys, definitions);
  return fallback ? hidden.filter((id) => id !== fallback) : hidden;
}

/** One coherent exact-key view for UI configuration replies. */
export async function getProviderConfigSnapshot(): Promise<{ configuredProviderIds: ProviderId[]; activeProviderId: ProviderId | null; activeSourceId: SourceId; sourceOrder: SourceId[]; sourceHidden: SourceId[]; siteEngines: SiteEngineDefinition[]; providerMaxResults: Partial<Record<ProviderId, number>>; groupConfig: GroupConfig }> {
  const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY]);
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
  const siteEngines = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
  const configuredProviderIds = allProviders().filter((p) => keys[p.id]).map((p) => p.id);
  const activeProviderId = isKnownProvider(got[ACTIVE_KEY]) && keys[got[ACTIVE_KEY]] ? got[ACTIVE_KEY] : configuredProviderIds[0] ?? null;
  const sourceOrder = normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteEngines);
  const sourceHidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteEngines), sourceOrder, keys, siteEngines);
  const providerMaxResults = await readMaxResultsMapFrom(got[MAX_RESULTS_KEY]);
  const groupConfig = got[GROUP_CONFIG_KEY] && typeof got[GROUP_CONFIG_KEY] === 'object'
    ? normalizeGroupConfig(got[GROUP_CONFIG_KEY], allKnownSourceIds(siteEngines))
    : defaultGroupConfig(allKnownSourceIds(siteEngines));
  return { configuredProviderIds, activeProviderId, activeSourceId: effectiveActiveSource(got[ACTIVE_SOURCE_KEY], got[ACTIVE_KEY], keys, siteEngines), sourceOrder, sourceHidden, siteEngines, providerMaxResults, groupConfig };
}

/** 从已读的 storage 原始值解析 maxResults 映射（避免重复 IO，供 snapshot 复用同一份 get）。 */
function readMaxResultsMapFrom(raw: unknown): Partial<Record<ProviderId, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: Partial<Record<ProviderId, number>> = {};
  for (const [id, n] of Object.entries(map)) {
    if (isKnownProvider(id)) {
      const clamped = clampMaxResults(n);
      if (clamped !== null) out[id as ProviderId] = clamped;
    }
  }
  return out;
}

async function readSearchCacheIndex(): Promise<SearchCacheIndex> {
  const got = await browser.storage.local.get(SEARCH_CACHE_INDEX_KEY);
  const stored = got[SEARCH_CACHE_INDEX_KEY];
  return isSearchCacheIndex(stored) ? stored : emptySearchCacheIndex();
}

async function readSearchCacheEntry(id: string): Promise<SearchCacheEntry | null> {
  const got = await browser.storage.local.get(searchCacheEntryKey(id));
  return (got[searchCacheEntryKey(id)] ?? null) as SearchCacheEntry | null;
}

export async function getSearchCacheSummaries(): Promise<SearchCacheSummary[]> {
  const index = await readSearchCacheIndex();
  return index.order.map((id) => index.summaries[id]).filter(Boolean);
}

export async function getCachedSearch(providerId: ProviderId, query: string): Promise<SearchCacheEntry | null> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    const cacheKey = makeSearchCacheKey(providerId, query);
    const id = index.byKey[cacheKey];
    if (!id) return null;
    return touchCachedSearchEntry(index, id);
  });
}

export async function getCachedSearchEntry(id: string): Promise<SearchCacheEntry | null> {
  return withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    if (!index.summaries[id]) return null;
    return touchCachedSearchEntry(index, id);
  });
}

export async function saveCachedSearch(response: NormalizedSearchResponse): Promise<SearchCacheEntry> {
  return withSearchCacheMutation(async () => saveCachedSearchUnlocked(response));
}

async function saveCachedSearchUnlocked(response: NormalizedSearchResponse): Promise<SearchCacheEntry> {
  const index = await readSearchCacheIndex();
  const entry = buildSearchCacheEntry(response);
  const oldId = index.byKey[entry.cacheKey];
  const idsToRemove = new Set<string>();
  if (oldId && oldId !== entry.id) idsToRemove.add(oldId);

  index.byKey[entry.cacheKey] = entry.id;
  index.summaries[entry.id] = buildSearchCacheSummary(entry);
  index.order = [entry.id, ...index.order.filter((id) => id !== entry.id && id !== oldId)];

  for (const id of index.order.slice(SEARCH_CACHE_CAP)) {
    idsToRemove.add(id);
    const summary = index.summaries[id];
    if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
    delete index.summaries[id];
  }
  index.order = index.order.slice(0, SEARCH_CACHE_CAP);

  await browser.storage.local.set({
    [searchCacheEntryKey(entry.id)]: entry,
    [SEARCH_CACHE_INDEX_KEY]: index,
  });
  await removeSearchCacheEntries([...idsToRemove]);
  return entry;
}

export async function deleteCachedSearch(id: string): Promise<void> {
  await withSearchCacheMutation(async () => deleteCachedSearchUnlocked(id));
}

async function deleteCachedSearchUnlocked(id: string): Promise<void> {
  const index = await readSearchCacheIndex();
  const summary = index.summaries[id];
  if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
  delete index.summaries[id];
  index.order = index.order.filter((entryId) => entryId !== id);
  await browser.storage.local.set({ [SEARCH_CACHE_INDEX_KEY]: index });
  await removeSearchCacheEntries([id]);
}

export async function clearSearchCache(): Promise<void> {
  await withSearchCacheMutation(async () => {
    const index = await readSearchCacheIndex();
    await browser.storage.local.remove([
      SEARCH_CACHE_INDEX_KEY,
      ...index.order.map(searchCacheEntryKey),
    ]);
  });
}

async function touchCachedSearchEntry(index: SearchCacheIndex, id: string): Promise<SearchCacheEntry | null> {
  const entry = await readSearchCacheEntry(id);
  if (!entry) {
    await removeStaleSearchCacheReference(index, id);
    return null;
  }
  const now = Date.now();
  entry.lastAccessedAt = now;
  const summary = buildSearchCacheSummary(entry);
  index.summaries[id] = summary;
  index.byKey[entry.cacheKey] = id;
  index.order = [id, ...index.order.filter((entryId) => entryId !== id)];
  try {
    await browser.storage.local.set({
      [searchCacheEntryKey(id)]: entry,
      [SEARCH_CACHE_INDEX_KEY]: index,
    });
  } catch {
    // LRU touch 是 best-effort：写失败时仍返回可读的缓存条目，避免命中读路径降级为 provider 调用。
  }
  return entry;
}

async function removeStaleSearchCacheReference(index: SearchCacheIndex, id: string): Promise<void> {
  const summary = index.summaries[id];
  if (summary && index.byKey[summary.cacheKey] === id) delete index.byKey[summary.cacheKey];
  delete index.summaries[id];
  index.order = index.order.filter((entryId) => entryId !== id);
  await browser.storage.local.set({ [SEARCH_CACHE_INDEX_KEY]: index });
}

async function removeSearchCacheEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await browser.storage.local.remove(ids.map(searchCacheEntryKey));
}

async function withSearchCacheMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = searchCacheMutationQueue.then(mutation, mutation);
  searchCacheMutationQueue = run.catch(() => undefined);
  return run;
}
