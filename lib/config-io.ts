// 配置导入/导出（仅 config 域，不含缓存池）。
//
// 设计：
// - 导出由 worker 组装 payload（worker 本就是 key 的唯一读者），精确读 config 键，
//   不读 searchCacheEntry 池；payload 含明文 key（BYOK 数据归用户，文件归用户所有）。
// - 导入走校验 + 合并语义：providerKeys 仅填空（不覆盖已有 key），prefs 显式包含才覆盖。
// - 所有 storage IO 走精确键，绝不 get(null)。
//
// 安全（R7）：本模块只在 worker 上下文调用（由 gateway handler 触发），不进入页面代码。

import type { BarPositionPref, LocalePref, ThemePref } from './storage';
import { PROVIDER_INSTANCES_KEY } from './storage';
import {
  ACTIVE_KEY,
  ACTIVE_SOURCE_KEY,
  KEYS_KEY,
  LOCALE_KEY,
  MAX_RESULTS_KEY,
  SOURCE_HIDDEN_KEY,
  SOURCE_ORDER_KEY,
  SITE_ENGINES_KEY,
  CUSTOM_ENGINES_KEY,
  THEME_KEY,
  GROUP_CONFIG_KEY,
  BAR_POSITION_KEY,
  AI_AUTO_ENTER_KEY,
  clampMaxResults,
  withProviderKeysMutation,
  withSourceMutation,
} from './storage';
import { allProviders } from './providers/registry';
import type { ProviderId } from './providers/types';
import type { EngineId } from './engines/types';
import { allKnownSourceIds, isEngineId, isKnownSiteEngineId, isKnownCustomEngineId, isProviderId, normalizeSourceHidden, normalizeSourceOrder, resolveEffectiveActiveSource, visibleUsableSource, type SourceId } from './sources';
import type { GroupConfig } from './source-groups';
import { normalizeGroupConfig } from './source-groups';
import { CURRENT_SCHEMA_VERSION } from './schema';
import type { SiteEngineDefinition } from './site-engines';
import { isBoundedSiteEngineCollection, isSiteEngineId, normalizeSiteEngineDefinitions } from './site-engines';
import type { ProviderInstance } from './provider-instances';
import { isBoundedProviderInstanceCollection, isProviderInstanceId, normalizeProviderInstances } from './provider-instances';
import type { CustomEngineDefinition } from './custom-engines';
import { isBoundedCustomEngineCollection, isCustomEngineId, normalizeCustomEngineDefinitions } from './custom-engines';
import { isRegisteredAiEngineId } from './ai-engines/registry';

const KNOWN_PROVIDER_IDS = new Set<ProviderId>(allProviders().map((p) => p.id));
const THEME_VALUES = new Set<ThemePref>(['auto', 'light', 'dark']);
const LOCALE_VALUES = new Set<LocalePref>(['auto', 'zh_CN', 'en']);
const BAR_POSITION_VALUES = new Set<BarPositionPref>(['auto', 'top', 'inline', 'bottom']);
const DEFAULT_ENGINE_ID: EngineId = 'google';
const MAX_IMPORT_BYTES = 256 * 1024;
/** 导入可接受的最旧 schema 版本（v3 遗留，无 siteEngines/groupConfig）。与 CURRENT_SCHEMA_VERSION 构成连续支持区间。 */
const MIN_SUPPORTED_SCHEMA_VERSION = 3;

/** 导出文件结构。schemaVersion 用 number（非字面量），避免版本升级后类型过度约束。 */
export interface ConfigExport {
  schemaVersion: number;
  exportedAt: number;
  appVersion: string;
  providerKeys: Record<string, string>;
  activeProvider: ProviderId | null;
  activeSource: SourceId | null;
  themePref: ThemePref;
  localePref: LocalePref;
  serpBarPosition?: BarPositionPref;
  /** AI engine 自动回车开关（默认 true）。 */
  aiAutoEnter?: boolean;
  sourceOrder?: SourceId[];
  sourceHidden?: SourceId[];
  /** Absent in legacy v3 exports; absence preserves local Site Engines. */
  siteEngines?: SiteEngineDefinition[];
  /** Absent in legacy exports; absence preserves local Custom Engines. */
  customEngines?: CustomEngineDefinition[];
  /** Absent in legacy exports; absence preserves local Provider Instances. */
  providerInstances?: ProviderInstance[];
  /** 每个 provider 的搜索结果条数（仅含已显式设置的 id）。 */
  providerMaxResults?: Partial<Record<ProviderId, number>>;
  /** 来源分组与顶层布局（导入文件可选；缺失则保留本地配置）。 */
  groupConfig?: GroupConfig;
}

/** worker 端组装导出 payload。精确读 config 键，不读缓存池。 */
export async function buildExportPayload(): Promise<ConfigExport> {
  const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY, THEME_KEY, LOCALE_KEY, BAR_POSITION_KEY, AI_AUTO_ENTER_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY]);
  const siteEngines = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
  const customEngines = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const providerInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;
  const providerKeys = normalizeProviderKeys(keys);
  const activeRaw = got[ACTIVE_KEY];
  const active = KNOWN_PROVIDER_IDS.has(activeRaw as ProviderId) ? (activeRaw as ProviderId) : null;
  const activeSource = resolveEffectiveActiveSource(
    (typeof got[ACTIVE_SOURCE_KEY] === 'string' ? got[ACTIVE_SOURCE_KEY] as SourceId : null) ?? active,
    providerKeys,
    siteEngines,
    customEngines,
    providerInstances,
  ) ?? DEFAULT_ENGINE_ID;
  const theme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
  const locale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
  const barPosition = BAR_POSITION_VALUES.has(got[BAR_POSITION_KEY] as BarPositionPref) ? (got[BAR_POSITION_KEY] as BarPositionPref) : 'auto';
  const knownSourceIds = allKnownSourceIds(siteEngines, customEngines, providerInstances);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion: getAppVersion(),
    providerKeys,
    activeProvider: active,
    activeSource,
    themePref: theme,
    localePref: locale,
    serpBarPosition: barPosition,
    aiAutoEnter: got[AI_AUTO_ENTER_KEY] !== false,
    sourceOrder: normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteEngines, customEngines, providerInstances),
    sourceHidden: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteEngines, customEngines, providerInstances),
    siteEngines,
    customEngines,
    providerInstances,
    providerMaxResults: normalizeMaxResultsMap(got[MAX_RESULTS_KEY]),
    groupConfig: got[GROUP_CONFIG_KEY] && typeof got[GROUP_CONFIG_KEY] === 'object'
      ? normalizeGroupConfig(got[GROUP_CONFIG_KEY], knownSourceIds)
      : undefined,
  };
}

function getAppVersion(): string {
  const manifest = browser.runtime.getManifest();
  return manifest?.version ?? '0.0.0';
}

// === 导入校验 ===

export type ParseResult =
  | { ok: true; value: ConfigExport }
  | { ok: false; error: string };

/**
 * 校验导入文件原始内容。严格：schemaVersion 必须落在 [MIN_SUPPORTED_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION] 区间，providerKeys 的 id 必须全已知、
 * 值必须是 string，activeProvider 必须是已知 id 或 null，prefs 必须是合法枚举值。
 * 任何不合规都返回 ok:false（不抛异常），调用方负责把 error 转为面向用户的消息。
 */
export function parseImportPayload(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_format' };
  }
  const obj = raw as Record<string, unknown>;
  if (serializedSize(raw) > MAX_IMPORT_BYTES) return { ok: false, error: 'import_too_large' };
  // 接受连续支持区间 [MIN_SUPPORTED_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION]：下限 3 是最旧的遗留版本
  // （无 siteEngines/groupConfig），上限随 CURRENT_SCHEMA_VERSION 演进。用区间而非硬编码版本列表，
  // 避免下次 bump 后静默拒绝当前版本的备份（如 v6→v7 时拒绝仍有效的 v6 备份）。
  const schemaVersion = obj.schemaVersion;
  if (typeof schemaVersion !== 'number' || schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION || schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: 'schema_version_mismatch' };
  }
  // 旧备份(v<8)的 'top' 语义为内联引擎锚点插入；v8 起 'top' 重定义为固定覆盖顶栏。
  // 导入旧备份时 remap 'top'→'inline'，保持旧备份语义不变（与新 'top' 覆盖语义区分）。
  if (schemaVersion < 8 && obj.serpBarPosition === 'top') obj.serpBarPosition = 'inline';
  const pk = obj.providerKeys;
  if (!pk || typeof pk !== 'object' || Array.isArray(pk)) {
    return { ok: false, error: 'invalid_provider_keys' };
  }
  const providerKeys: Record<string, string> = {};
  for (const [id, k] of Object.entries(pk as Record<string, unknown>)) {
    if (!KNOWN_PROVIDER_IDS.has(id as ProviderId)) return { ok: false, error: 'unknown_provider' };
    if (typeof k !== 'string' || k.length === 0) return { ok: false, error: 'invalid_key_value' };
    providerKeys[id] = k;
  }
  const active = obj.activeProvider;
  if (active !== null && !KNOWN_PROVIDER_IDS.has(active as ProviderId)) {
    return { ok: false, error: 'invalid_active_provider' };
  }
  const isLegacyV3 = obj.schemaVersion === 3;
  if (!isLegacyV3 && !isBoundedSiteEngineCollection(obj.siteEngines)) return { ok: false, error: 'invalid_site_engines' };
  const siteEngines = isLegacyV3 ? undefined : normalizeSiteEngineDefinitions(obj.siteEngines);
  if (!isLegacyV3 && (!siteEngines || !Array.isArray(obj.siteEngines) || siteEngines.length !== obj.siteEngines.length)) return { ok: false, error: 'invalid_site_engines' };
  const hasCustomEngines = Object.prototype.hasOwnProperty.call(obj, 'customEngines');
  let customEngines: CustomEngineDefinition[] | undefined;
  if (hasCustomEngines) {
    if (!isBoundedCustomEngineCollection(obj.customEngines)) return { ok: false, error: 'invalid_custom_engines' };
    customEngines = normalizeCustomEngineDefinitions(obj.customEngines);
    if (!Array.isArray(obj.customEngines) || customEngines.length !== obj.customEngines.length) return { ok: false, error: 'invalid_custom_engines' };
  }
  // Provider Instances 是新增字段：缺失（legacy/部分导出）保留本地实例；存在时必须整体合法且受预算约束。
  const hasProviderInstances = Object.prototype.hasOwnProperty.call(obj, 'providerInstances');
  let providerInstances: ProviderInstance[] | undefined;
  if (hasProviderInstances) {
    if (!isBoundedProviderInstanceCollection(obj.providerInstances)) return { ok: false, error: 'invalid_provider_instances' };
    providerInstances = normalizeProviderInstances(obj.providerInstances);
    if (!Array.isArray(obj.providerInstances) || providerInstances.length !== obj.providerInstances.length) return { ok: false, error: 'invalid_provider_instances' };
  }
  const activeSource = obj.activeSource;
  if (activeSource !== undefined && activeSource !== null && !isKnownSource(activeSource, siteEngines, customEngines, providerInstances, isLegacyV3)) return { ok: false, error: 'invalid_active_source' };
  const theme = obj.themePref;
  if (!THEME_VALUES.has(theme as ThemePref)) return { ok: false, error: 'invalid_theme' };
  const locale = obj.localePref;
  if (!LOCALE_VALUES.has(locale as LocalePref)) return { ok: false, error: 'invalid_locale' };
  const hasBarPosition = Object.prototype.hasOwnProperty.call(obj, 'serpBarPosition');
  const barPosition = obj.serpBarPosition;
  if (hasBarPosition && !BAR_POSITION_VALUES.has(barPosition as BarPositionPref)) return { ok: false, error: 'invalid_bar_position' };
  const hasAiAutoEnter = Object.prototype.hasOwnProperty.call(obj, 'aiAutoEnter');
  const aiAutoEnter = obj.aiAutoEnter;
  if (hasAiAutoEnter && typeof aiAutoEnter !== 'boolean') return { ok: false, error: 'invalid_ai_auto_enter' };
  const hasSourceOrder = Object.prototype.hasOwnProperty.call(obj, 'sourceOrder');
  const sourceOrder = obj.sourceOrder;
  if (hasSourceOrder) {
    if (!Array.isArray(sourceOrder)) return { ok: false, error: 'invalid_source_order' };
    const seen = new Set<SourceId>();
    for (const sourceId of sourceOrder) {
      if (!isKnownSource(sourceId, siteEngines, customEngines, providerInstances, isLegacyV3) || seen.has(sourceId)) return { ok: false, error: 'invalid_source_order' };
      seen.add(sourceId);
    }
  }
  const hasSourceHidden = Object.prototype.hasOwnProperty.call(obj, 'sourceHidden');
  const sourceHidden = obj.sourceHidden;
  if (hasSourceHidden) {
    if (!Array.isArray(sourceHidden)) return { ok: false, error: 'invalid_source_hidden' };
    const seenHidden = new Set<SourceId>();
    for (const sourceId of sourceHidden) {
      if (!isKnownSource(sourceId, siteEngines, customEngines, providerInstances, isLegacyV3) || seenHidden.has(sourceId)) return { ok: false, error: 'invalid_source_hidden' };
      seenHidden.add(sourceId);
    }
  }
  const hasMaxResults = Object.prototype.hasOwnProperty.call(obj, 'providerMaxResults');
  const providerMaxResults = hasMaxResults ? normalizeMaxResultsMap(obj.providerMaxResults) : undefined;
  const hasGroupConfig = Object.prototype.hasOwnProperty.call(obj, 'groupConfig');
  let groupConfig: GroupConfig | undefined;
  if (hasGroupConfig) {
    // normalizeGroupConfig 容错：非法结构会被规整为默认配置，不阻断导入。
    groupConfig = normalizeGroupConfig(obj.groupConfig, allKnownSourceIds(siteEngines ?? [], customEngines ?? [], providerInstances ?? []));
  }
  return {
    ok: true,
    value: {
      schemaVersion,
      exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
      providerKeys,
      activeProvider: active as ProviderId | null,
      activeSource: activeSource === undefined ? active as ProviderId | null : activeSource as SourceId | null,
      themePref: theme as ThemePref,
      localePref: locale as LocalePref,
      serpBarPosition: hasBarPosition ? barPosition as BarPositionPref : undefined,
      aiAutoEnter: hasAiAutoEnter ? aiAutoEnter as boolean : undefined,
      sourceOrder: hasSourceOrder ? normalizeSourceOrder(sourceOrder, siteEngines, customEngines, providerInstances) : undefined,
      sourceHidden: hasSourceHidden ? normalizeSourceHidden(sourceHidden, siteEngines, customEngines, providerInstances) : undefined,
      siteEngines,
      customEngines,
      providerInstances,
      providerMaxResults,
      groupConfig,
    },
  };
}

// === 导入合并 ===

export interface ImportReport {
  /** 写入的 provider id（当前空槽被导入 key 填上的）。 */
  written: ProviderId[];
  /** 跳过的 provider id（当前已有 key，导入 key 未覆盖）。 */
  skipped: ProviderId[];
  /** 是否覆盖了 activeProvider（仅当 applyPrefs 且当前值不同）。 */
  activeProviderOverridden: boolean;
  /** 是否覆盖了 activeSource。 */
  activeSourceOverridden: boolean;
  /** 是否覆盖了 themePref。 */
  themePrefOverridden: boolean;
  /** 是否覆盖了 localePref。 */
  localePrefOverridden: boolean;
  /** 是否覆盖了 serpBarPosition。 */
  serpBarPositionOverridden: boolean;
  /** 是否覆盖了 aiAutoEnter。 */
  aiAutoEnterOverridden: boolean;
  /** 是否覆盖了 sourceOrder。 */
  sourceOrderOverridden: boolean;
  /** 是否覆盖了 sourceHidden。 */
  sourceHiddenOverridden: boolean;
  /** 是否覆盖了 Site Engine definitions。 */
  siteEnginesOverridden: boolean;
  /** 是否覆盖了 Custom Engine definitions。 */
  customEnginesOverridden: boolean;
  /** 是否覆盖了 Provider Instance definitions。 */
  providerInstancesOverridden: boolean;
  /** 是否覆盖了 providerMaxResults。 */
  providerMaxResultsOverridden: boolean;
  /** 是否覆盖了 groupConfig（来源分组与顶层布局）。 */
  groupConfigOverridden: boolean;
}

/** 单个 pref 的预览 diff：from 当前值 -> to 导入值（仅当两者不同时为 diff）。 */
export interface PrefDiff {
  key: 'activeProvider' | 'activeSource' | 'themePref' | 'localePref' | 'serpBarPosition' | 'aiAutoEnter' | 'sourceOrder' | 'sourceHidden' | 'siteEngines' | 'customEngines' | 'providerInstances' | 'providerMaxResults' | 'groupConfig';
  from: string | null;
  to: string | null;
}

/** previewImport 的返回：dry-run，不写 storage。供 UI 展示 diff + 确认。 */
export interface ImportPreview {
  /** 将被填空的 provider id（当前无 key，导入会写入）。 */
  written: ProviderId[];
  /** 跳过的 provider id（当前已有 key，导入不覆盖）。 */
  skipped: ProviderId[];
  /** prefs 的实际 diff（仅包含 from !== to 的项）。空 = 无 pref 变更。 */
  prefDiffs: PrefDiff[];
}

/**
 * 预览导入效果（dry-run）。不写 storage。
 * 调用方先 parseImportPayload 校验通过，再调用此函数展示 diff。
 * 当 prefDiffs 非空时，UI 应弹出确认对话框；用户确认后调 mergeImport(payload, { applyPrefs: true })。
 */
export async function previewImport(payload: ConfigExport): Promise<ImportPreview> {
  const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY, THEME_KEY, LOCALE_KEY, BAR_POSITION_KEY, AI_AUTO_ENTER_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY]);
  const current = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;

  const written: ProviderId[] = [];
  const skipped: ProviderId[] = [];
  for (const id of Object.keys(payload.providerKeys)) {
    const has = !!current[id] && typeof current[id] === 'string';
    if (!has) written.push(id as ProviderId);
    else skipped.push(id as ProviderId);
  }

  const prefDiffs: PrefDiff[] = [];
  const curActive = KNOWN_PROVIDER_IDS.has(got[ACTIVE_KEY] as ProviderId) ? (got[ACTIVE_KEY] as ProviderId) : null;
  const newActive = payload.activeProvider;
  if (curActive !== newActive) {
    prefDiffs.push({ key: 'activeProvider', from: curActive, to: newActive });
  }
  const currentSites = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
  const currentCustoms = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const currentInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  if (payload.siteEngines !== undefined && !sameSiteEngines(currentSites, payload.siteEngines)) {
    prefDiffs.push({ key: 'siteEngines', from: siteEnginesSummary(currentSites), to: siteEnginesSummary(payload.siteEngines) });
  }
  if (payload.customEngines !== undefined && !sameCustomEngines(currentCustoms, payload.customEngines)) {
    prefDiffs.push({ key: 'customEngines', from: customEnginesSummary(currentCustoms), to: customEnginesSummary(payload.customEngines) });
  }
  if (payload.providerInstances !== undefined) {
    if (!sameProviderInstances(currentInstances, payload.providerInstances)) {
      prefDiffs.push({ key: 'providerInstances', from: providerInstancesSummary(currentInstances), to: providerInstancesSummary(payload.providerInstances) });
    }
  }
  const currentKeys = normalizeProviderKeys(current);
  const mergedKeys = mergeProviderKeys(currentKeys, payload.providerKeys);
  const sourcePreferences = resolveImportedSourcePreferences(payload, got, currentSites, currentCustoms, currentKeys, mergedKeys, curActive);
  if (sourcePreferences.curActiveSource !== sourcePreferences.newActiveSource) {
    prefDiffs.push({ key: 'activeSource', from: sourcePreferences.curActiveSource, to: sourcePreferences.newActiveSource });
  }
  const curTheme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
  if (curTheme !== payload.themePref) {
    prefDiffs.push({ key: 'themePref', from: curTheme, to: payload.themePref });
  }
  const curLocale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
  if (curLocale !== payload.localePref) {
    prefDiffs.push({ key: 'localePref', from: curLocale, to: payload.localePref });
  }
  const curBarPosition = BAR_POSITION_VALUES.has(got[BAR_POSITION_KEY] as BarPositionPref) ? (got[BAR_POSITION_KEY] as BarPositionPref) : 'auto';
  const newBarPosition = payload.serpBarPosition ?? 'auto';
  if (curBarPosition !== newBarPosition) {
    prefDiffs.push({ key: 'serpBarPosition', from: curBarPosition, to: newBarPosition });
  }
  const curAiAutoEnter = got[AI_AUTO_ENTER_KEY] !== false;
  const newAiAutoEnter = payload.aiAutoEnter ?? true;
  if (curAiAutoEnter !== newAiAutoEnter) {
    prefDiffs.push({ key: 'aiAutoEnter', from: String(curAiAutoEnter), to: String(newAiAutoEnter) });
  }
  if (!sameSourceOrder(sourcePreferences.curSourceOrder, sourcePreferences.newSourceOrder)) {
    prefDiffs.push({ key: 'sourceOrder', from: sourcePreferences.curSourceOrder.join(' > '), to: sourcePreferences.newSourceOrder.join(' > ') });
  }
  if (!sameSourceOrder(sourcePreferences.curSourceHidden, sourcePreferences.newSourceHidden)) {
    prefDiffs.push({ key: 'sourceHidden', from: sourcePreferences.curSourceHidden.join(' > '), to: sourcePreferences.newSourceHidden.join(' > ') });
  }
  if (payload.providerMaxResults !== undefined) {
    const curMax = normalizeMaxResultsMap(got[MAX_RESULTS_KEY]);
    if (!sameMaxResultsMap(curMax, payload.providerMaxResults)) {
      prefDiffs.push({ key: 'providerMaxResults', from: maxResultsSummary(curMax), to: maxResultsSummary(payload.providerMaxResults) });
    }
  }
  if (payload.groupConfig !== undefined) {
    const curGroupRaw = got[GROUP_CONFIG_KEY];
    const curGroup = curGroupRaw && typeof curGroupRaw === 'object'
      ? normalizeGroupConfig(curGroupRaw, allKnownSourceIds(currentSites, currentCustoms, currentInstances))
      : undefined;
    if (!sameGroupConfig(curGroup, payload.groupConfig)) {
      prefDiffs.push({ key: 'groupConfig', from: groupConfigSummary(curGroup), to: groupConfigSummary(payload.groupConfig) });
    }
  }
  return { written, skipped, prefDiffs };
}

/** groupConfig 的可读摘要（分组数 / 顶层项数 / 赋值数），用于 diff 展示。 */
function groupConfigSummary(config: GroupConfig | undefined): string {
  if (!config) return '()';
  return `(${config.groups.length}组/${config.layout.length}项/${Object.keys(config.assignments).length}赋值)`;
}

/** 比较 groupConfig 是否等价（结构化比较）。 */
function sameGroupConfig(a: GroupConfig | undefined, b: GroupConfig): boolean {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 合并导入 payload 到 storage。合并语义：
 * - providerKeys：仅填空。导入 key 只写入当前没有 key 的 provider 槽位；既有 key 不覆盖、不删除。
 * - prefs：仅当 applyPrefs=true 时覆盖（用户在 preview 确认后传入）；默认 false = 不动 prefs。
 *
 * 推荐流程：previewImport → UI 展示 diff → 用户确认 → mergeImport(payload, { applyPrefs: true })。
 * 精确键 IO：先 get(KEYS_KEY) 判空，再单次 set 写回合并后的 keys（+ 可选 prefs）。
 * 调用方负责先 parseImportPayload 校验通过，再传入。
 */
export async function mergeImport(
  payload: ConfigExport,
  opts: { applyPrefs?: boolean } = {},
): Promise<ImportReport> {
  const applyPrefs = opts.applyPrefs === true;
  // 串行化 providerKeys 的读改写，防止与 setKey/clearKey 并发写丢失。
  return withSourceMutation(() => withProviderKeysMutation(async () => {
const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY, THEME_KEY, LOCALE_KEY, BAR_POSITION_KEY, AI_AUTO_ENTER_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY]);
    const current = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;

    const written: ProviderId[] = [];
    const skipped: ProviderId[] = [];
    const mergedKeys: Record<string, string> = {};
    // 保留当前所有合法 key
    for (const [id, k] of Object.entries(current)) {
      if (KNOWN_PROVIDER_IDS.has(id as ProviderId) && typeof k === 'string') {
        mergedKeys[id] = k;
      }
    }
    // 填空：导入的 key 只写入当前没有的槽位
    for (const [id, k] of Object.entries(payload.providerKeys)) {
      if (!mergedKeys[id]) {
        mergedKeys[id] = k;
        written.push(id as ProviderId);
      } else {
        skipped.push(id as ProviderId);
      }
    }

    const setObj: Record<string, unknown> = { [KEYS_KEY]: mergedKeys };

    // prefs 覆盖：仅当 applyPrefs=true 时写入。默认 false 保护用户显式 prefs 不被默认值覆盖。
    let activeOverridden = false;
    let activeSourceOverridden = false;
    let themeOverridden = false;
    let localeOverridden = false;
    let barPositionOverridden = false;
    let aiAutoEnterOverridden = false;
    let sourceOrderOverridden = false;
    let sourceHiddenOverridden = false;
    let siteEnginesOverridden = false;
    let customEnginesOverridden = false;
    let providerInstancesOverridden = false;
    let providerMaxResultsOverridden = false;
    let groupConfigOverridden = false;
    if (applyPrefs) {
      const currentSites = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
      const currentCustoms = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
      const currentInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
      const importedInstances = payload.providerInstances ?? currentInstances;
      const curActive = KNOWN_PROVIDER_IDS.has(got[ACTIVE_KEY] as ProviderId) ? (got[ACTIVE_KEY] as ProviderId) : null;
      const sourcePreferences = resolveImportedSourcePreferences(payload, got, currentSites, currentCustoms, normalizeProviderKeys(current), mergedKeys, curActive);
      const { importedSites, importedCustoms, curActiveSource, newActiveSource, curSourceOrder, newSourceOrder, curSourceHidden, newSourceHidden } = sourcePreferences;
      if (payload.siteEngines !== undefined && !sameSiteEngines(currentSites, importedSites)) { setObj[SITE_ENGINES_KEY] = importedSites; siteEnginesOverridden = true; }
      if (payload.customEngines !== undefined && !sameCustomEngines(currentCustoms, importedCustoms)) { setObj[CUSTOM_ENGINES_KEY] = importedCustoms; customEnginesOverridden = true; }
      // 整数组覆盖（pref 语义，同 siteEngines）：导入文件显式包含 providerInstances 时整体替换。
      if (payload.providerInstances !== undefined && !sameProviderInstances(currentInstances, payload.providerInstances)) { setObj[PROVIDER_INSTANCES_KEY] = payload.providerInstances; providerInstancesOverridden = true; }
      if (curActive !== payload.activeProvider) {
        setObj[ACTIVE_KEY] = payload.activeProvider;
        activeOverridden = true;
      }
      if (curActiveSource !== newActiveSource) {
        setObj[ACTIVE_SOURCE_KEY] = newActiveSource;
        activeSourceOverridden = true;
      }
      const curTheme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
      if (curTheme !== payload.themePref) {
        setObj[THEME_KEY] = payload.themePref;
        themeOverridden = true;
      }
      const curLocale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
      if (curLocale !== payload.localePref) {
        setObj[LOCALE_KEY] = payload.localePref;
        localeOverridden = true;
      }
      const curBarPosition = BAR_POSITION_VALUES.has(got[BAR_POSITION_KEY] as BarPositionPref) ? (got[BAR_POSITION_KEY] as BarPositionPref) : 'auto';
      const newBarPosition = payload.serpBarPosition ?? 'auto';
      if (curBarPosition !== newBarPosition) {
        setObj[BAR_POSITION_KEY] = newBarPosition;
        barPositionOverridden = true;
      }
      const curAiAutoEnter = got[AI_AUTO_ENTER_KEY] !== false;
      const newAiAutoEnter = payload.aiAutoEnter ?? true;
      if (curAiAutoEnter !== newAiAutoEnter) {
        setObj[AI_AUTO_ENTER_KEY] = newAiAutoEnter;
        aiAutoEnterOverridden = true;
      }
      if (!sameSourceOrder(curSourceOrder, newSourceOrder)) {
        setObj[SOURCE_ORDER_KEY] = newSourceOrder;
        sourceOrderOverridden = true;
      }
      if (!sameSourceOrder(curSourceHidden, newSourceHidden)) {
        setObj[SOURCE_HIDDEN_KEY] = newSourceHidden;
        sourceHiddenOverridden = true;
      }
      if (payload.providerMaxResults !== undefined) {
        const curMax = normalizeMaxResultsMap(got[MAX_RESULTS_KEY]);
        if (!sameMaxResultsMap(curMax, payload.providerMaxResults)) {
          setObj[MAX_RESULTS_KEY] = payload.providerMaxResults;
          providerMaxResultsOverridden = true;
        }
      }
      if (payload.groupConfig !== undefined) {
        const curGroupRaw = got[GROUP_CONFIG_KEY];
        const curGroup = curGroupRaw && typeof curGroupRaw === 'object'
          ? normalizeGroupConfig(curGroupRaw, allKnownSourceIds(currentSites, currentCustoms, currentInstances))
          : undefined;
        // 用导入的 site/custom engines 视角重新规范化导入的 groupConfig，确保赋值合法。
        const newGroup = normalizeGroupConfig(payload.groupConfig, allKnownSourceIds(importedSites, importedCustoms, importedInstances));
        if (!sameGroupConfig(curGroup, newGroup)) {
          setObj[GROUP_CONFIG_KEY] = newGroup;
          groupConfigOverridden = true;
        }
      }
    }
    await browser.storage.local.set(setObj);

    return {
      written,
      skipped,
      activeProviderOverridden: activeOverridden,
      activeSourceOverridden,
      themePrefOverridden: themeOverridden,
      localePrefOverridden: localeOverridden,
      serpBarPositionOverridden: barPositionOverridden,
      aiAutoEnterOverridden,
      sourceOrderOverridden,
      sourceHiddenOverridden,
      siteEnginesOverridden,
      customEnginesOverridden,
      providerInstancesOverridden,
      providerMaxResultsOverridden,
      groupConfigOverridden,
    };
  }));
}

function normalizeProviderKeys(keys: Record<string, unknown>): Record<string, string> {
  const providerKeys: Record<string, string> = {};
  for (const [id, k] of Object.entries(keys)) {
    if (KNOWN_PROVIDER_IDS.has(id as ProviderId) && typeof k === 'string') {
      providerKeys[id] = k;
    }
  }
  return providerKeys;
}

/** 把 storage 原始值规范化为 maxResults 映射：仅保留已知 provider、clamp 到 1–20。 */
function normalizeMaxResultsMap(raw: unknown): Partial<Record<ProviderId, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: Partial<Record<ProviderId, number>> = {};
  for (const [id, n] of Object.entries(map)) {
    if (KNOWN_PROVIDER_IDS.has(id as ProviderId)) {
      const clamped = clampMaxResults(n);
      if (clamped !== null) out[id as ProviderId] = clamped;
    }
  }
  return out;
}

function mergeProviderKeys(current: Record<string, string>, imported: Record<string, string>): Record<string, string> {
  const merged = { ...current };
  for (const [id, key] of Object.entries(imported)) if (!merged[id]) merged[id] = key;
  return merged;
}

/** Calculates the source graph exactly as an apply-preferences import will. */
function resolveImportedSourcePreferences(
  payload: ConfigExport,
  got: Record<string, unknown>,
  currentSites: SiteEngineDefinition[],
  currentCustoms: CustomEngineDefinition[],
  currentKeys: Record<string, string>,
  mergedKeys: Record<string, string>,
  currentActive: ProviderId | null,
) {
  // A missing collection is the v3 sentinel; unlike v4's explicit [], it
  // preserves local Site Engines and all dependent preferences.
  const importedSites = payload.siteEngines ?? currentSites;
  const importedCustoms = payload.customEngines ?? currentCustoms;
  const currentInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const importedInstances = payload.providerInstances ?? currentInstances;
  const curActiveSource = resolveEffectiveActiveSource(
    (typeof got[ACTIVE_SOURCE_KEY] === 'string' ? got[ACTIVE_SOURCE_KEY] as SourceId : null) ?? currentActive,
    currentKeys,
    currentSites,
    currentCustoms,
    currentInstances,
  ) ?? DEFAULT_ENGINE_ID;
  // Preserve the current active source when it is a dynamic id whose collection
  // is absent from the import (i.e. preserved from current storage). Each dynamic
  // type is checked independently so an older backup with siteEngines but no
  // customEngines still preserves a custom-engine active source.
  const preserveSite = payload.siteEngines === undefined && isKnownSiteEngineId(curActiveSource, currentSites);
  const preserveCustom = payload.customEngines === undefined && isKnownCustomEngineId(curActiveSource, currentCustoms);
  const preferredActiveSource = (preserveSite || preserveCustom) ? curActiveSource : payload.activeSource;
  const newActiveSource = resolveEffectiveActiveSource(
    preferredActiveSource ?? payload.activeProvider,
    mergedKeys,
    importedSites,
    importedCustoms,
    importedInstances,
  ) ?? DEFAULT_ENGINE_ID;
  const curSourceOrder = normalizeSourceOrder(got[SOURCE_ORDER_KEY], currentSites, currentCustoms, currentInstances);
  const newSourceOrder = normalizeSourceOrder(payload.sourceOrder === undefined ? got[SOURCE_ORDER_KEY] : payload.sourceOrder, importedSites, importedCustoms, importedInstances);
  const curSourceHidden = normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], currentSites, currentCustoms, currentInstances);
  const importedHidden = payload.sourceHidden === undefined ? got[SOURCE_HIDDEN_KEY] : payload.sourceHidden;
  const hiddenInput = payload.siteEngines === undefined && payload.customEngines === undefined
    ? [...(Array.isArray(importedHidden) ? importedHidden : []), ...curSourceHidden.filter((id) => isSiteEngineId(id) || isCustomEngineId(id))]
    : importedHidden;
  const newSourceHidden = ensureVisibleUsable(normalizeSourceHidden(hiddenInput, importedSites, importedCustoms, importedInstances), newSourceOrder, mergedKeys, importedSites, importedCustoms, importedInstances);
  return { importedSites, importedCustoms, curActiveSource, newActiveSource, curSourceOrder, newSourceOrder, curSourceHidden, newSourceHidden };
}

function isKnownSource(value: unknown, siteEngines: readonly SiteEngineDefinition[] = [], customEngines: readonly CustomEngineDefinition[] = [], providerInstances: readonly ProviderInstance[] = [], allowUnresolvedSite = false): value is SourceId {
  return typeof value === 'string'
    && (isProviderId(value) || isEngineId(value) || isRegisteredAiEngineId(value) || isKnownSiteEngineId(value, siteEngines) || isKnownCustomEngineId(value, customEngines) || (isProviderInstanceId(value) && providerInstances.some((instance) => instance.id === value)) || (allowUnresolvedSite && (isSiteEngineId(value) || isCustomEngineId(value))));
}

function sameSiteEngines(left: readonly SiteEngineDefinition[], right: readonly SiteEngineDefinition[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameCustomEngines(left: readonly CustomEngineDefinition[], right: readonly CustomEngineDefinition[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameProviderInstances(left: readonly ProviderInstance[], right: readonly ProviderInstance[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSourceOrder(left: SourceId[], right: SourceId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** 两份 maxResults 映射是否等价（键集与值都相同）。 */
function sameMaxResultsMap(left: Partial<Record<ProviderId, number>>, right: Partial<Record<ProviderId, number>>): boolean {
  const lk = Object.keys(left);
  const rk = Object.keys(right);
  if (lk.length !== rk.length) return false;
  return lk.every((k) => left[k as ProviderId] === right[k as ProviderId]);
}

/** maxResults 映射的紧凑摘要，供 diff 展示。 */
function maxResultsSummary(map: Partial<Record<ProviderId, number>>): string {
  return Object.entries(map).map(([id, n]) => `${id}=${n}`).join(' | ') || '—';
}

/** Deterministic compact diff value; preserves enough detail to distinguish same-sized lists. */
function siteEnginesSummary(definitions: readonly SiteEngineDefinition[]): string {
  return definitions.map((definition) => `${definition.id}:${definition.engineId}:${definition.target}:${definition.name}`).join(' | ');
}

/** Deterministic compact diff value for custom engines. */
function customEnginesSummary(definitions: readonly CustomEngineDefinition[]): string {
  return definitions.map((definition) => `${definition.id}:${definition.urlTemplate}:${definition.name}`).join(' | ');
}

/** Deterministic compact diff value for provider instances (options included to distinguish same-sized lists). */
function providerInstancesSummary(instances: readonly ProviderInstance[]): string {
  return instances.map((instance) => `${instance.id}:${instance.baseProviderId}:${instance.name}:${JSON.stringify(instance.options)}`).join(' | ');
}

function ensureVisibleUsable(hidden: SourceId[], order: SourceId[], providerKeys: Record<string, string>, sites: readonly SiteEngineDefinition[], customs: readonly CustomEngineDefinition[] = [], instances: readonly ProviderInstance[] = []): SourceId[] {
  if (visibleUsableSource(order, hidden, providerKeys, sites, customs, instances)) return hidden;
  const fallback = visibleUsableSource(order, [], providerKeys, sites, customs, instances);
  return fallback ? hidden.filter((id) => id !== fallback) : hidden;
}

function serializedSize(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch { return Infinity; }
}
